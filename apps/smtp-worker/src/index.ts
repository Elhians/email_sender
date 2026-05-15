import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadSmtpConfig } from "./smtp.js";
import { processJob } from "./sendCampaignBatch.js";
import { loadWorkerEnv, type WorkerEnv } from "./env.js";

const thisFile = fileURLToPath(import.meta.url);
const thisDir = path.dirname(thisFile);
const rootEnvPath = path.resolve(thisDir, "../../../.env");
dotenv.config({ path: rootEnvPath });
// Fallback to default dotenv lookup when run in unusual environments.
dotenv.config();

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;

// ─── Supabase client ──────────────────────────────────────────────────────────

function makeSupabase(env: WorkerEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ─── Single poll tick ─────────────────────────────────────────────────────────

async function tick(supabase: SupabaseClient): Promise<void> {
  // Recover stale leases from crashed workers
  const { data: recovered } = await supabase.rpc("reset_stale_jobs", {
    p_timeout_minutes: 15,
  });
  if (recovered && (recovered as number) > 0) {
    console.log(`[worker] recovered ${recovered as number} stale job(s)`);
  }

  // Atomically claim the next due job
  const { data: claimed, error: claimErr } = await supabase.rpc(
    "claim_dispatch_job",
    { p_worker_id: WORKER_ID },
  );

  if (claimErr) {
    console.error("[worker] claim_dispatch_job error:", claimErr.message);
    return;
  }

  type JobRow = { id: string; campaign_id: string; status: string };
  const jobs = (claimed ?? []) as JobRow[];

  if (jobs.length === 0) {
    return; // Nothing due – quiet tick
  }

  const job = jobs[0]!;
  console.log(
    `[worker] claimed job ${job.id} for campaign ${job.campaign_id}`,
  );

  const smtpConfig = loadSmtpConfig();

  try {
    await processJob(supabase, job, smtpConfig);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[worker] unhandled error in job ${job.id}:`, msg);
    await supabase
      .from("campaign_dispatch_jobs")
      .update({ status: "failed", last_error: msg })
      .eq("id", job.id);
  }
}

// ─── Main poll loop ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const POLL_INTERVAL_MS = env.APP_POLL_INTERVAL_MS;

  console.log(
    `[worker] starting – id=${WORKER_ID} poll=${POLL_INTERVAL_MS}ms`,
  );

  const supabase = makeSupabase(env);
  const smtpConfig = loadSmtpConfig(); // Validate SMTP env at startup
  console.log(
    `[worker] SMTP config OK – ${smtpConfig.SMTP_HOST}:${smtpConfig.SMTP_PORT}`,
  );

  let running = true;

  const shutdown = () => {
    console.log("[worker] shutting down gracefully");
    running = false;
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  while (running) {
    const start = Date.now();
    try {
      await tick(supabase);
    } catch (err: unknown) {
      console.error(
        "[worker] tick error:",
        err instanceof Error ? err.message : err,
      );
    }

    // Sleep for the remainder of the interval
    const elapsed = Date.now() - start;
    const sleep = Math.max(0, POLL_INTERVAL_MS - elapsed);
    await new Promise((resolve) => setTimeout(resolve, sleep));
  }

  console.log("[worker] stopped");
}

void main().catch((err: unknown) => {
  console.error("[worker] fatal error:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
