import type { SupabaseClient } from "@supabase/supabase-js";
import { renderMergeTags } from "./mergeTags.js";
import type { SmtpConfig } from "./smtp.js";
import { createTransport } from "./smtp.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type DispatchJob = {
  id: string;
  campaign_id: string;
  status: string;
};

type Campaign = {
  id: string;
  subject: string;
  html_body: string;
  status: string;
};

type RecipientRow = {
  id: string;
  email: string;
  merge_data: Record<string, unknown>;
  attempt_count: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function failJob(
  supabase: SupabaseClient,
  jobId: string,
  reason: string,
): Promise<void> {
  console.error(`[worker] failing job ${jobId}: ${reason}`);
  await supabase
    .from("campaign_dispatch_jobs")
    .update({ status: "failed", last_error: reason })
    .eq("id", jobId);
}

async function markCampaignCancelled(
  supabase: SupabaseClient,
  campaignId: string,
  jobId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([
    supabase
      .from("campaign_recipients")
      .update({ status: "cancelled" })
      .eq("campaign_id", campaignId)
      .in("status", ["pending", "queued"]),
    supabase
      .from("campaigns")
      .update({ status: "cancelled", cancelled_at: now })
      .eq("id", campaignId),
    supabase
      .from("campaign_dispatch_jobs")
      .update({ status: "cancelled" })
      .eq("id", jobId),
  ]);
}

// ─── Main processing entry point ──────────────────────────────────────────────

export async function processJob(
  supabase: SupabaseClient,
  job: DispatchJob,
  smtpConfig: SmtpConfig,
): Promise<void> {
  // Load campaign
  const { data: campaign, error: campaignErr } = await supabase
    .from("campaigns")
    .select("id, subject, html_body, status")
    .eq("id", job.campaign_id)
    .single();

  if (campaignErr || !campaign) {
    await failJob(supabase, job.id, "Campaign not found");
    return;
  }

  const campaignTyped = campaign as Campaign;

  // Honour cancellation
  if (
    campaignTyped.status === "cancel_requested" ||
    campaignTyped.status === "cancelled"
  ) {
    await markCampaignCancelled(supabase, job.campaign_id, job.id);
    console.log(`[worker] campaign ${job.campaign_id} cancelled before send`);
    return;
  }

  // Mark campaign as sending (idempotent – only transitions from queued)
  await supabase
    .from("campaigns")
    .update({ status: "sending", started_at: new Date().toISOString() })
    .eq("id", job.campaign_id)
    .eq("status", "queued");

  const transport = createTransport(smtpConfig);

  try {
    await sendAllBatches(supabase, job, campaignTyped, smtpConfig, transport);
  } finally {
    transport.close();
  }

  // Recount to determine final state
  const { count: pendingCount } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", job.campaign_id)
    .in("status", ["pending", "queued", "sending"]);

  const allDone = (pendingCount ?? 0) === 0;

  const { count: sentCount } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", job.campaign_id)
    .eq("status", "sent");

  const { count: failedCount } = await supabase
    .from("campaign_recipients")
    .select("id", { count: "exact", head: true })
    .eq("campaign_id", job.campaign_id)
    .eq("status", "failed");

  const now = new Date().toISOString();

  // Update aggregate counts regardless
  await supabase
    .from("campaigns")
    .update({
      sent_count: sentCount ?? 0,
      failed_count: failedCount ?? 0,
      ...(allDone ? { status: "completed", completed_at: now } : {}),
    })
    .eq("id", job.campaign_id)
    .not("status", "in", '("cancelled","cancel_requested")');

  await supabase
    .from("campaign_dispatch_jobs")
    .update({ status: "completed" })
    .eq("id", job.id);

  console.log(
    `[worker] job ${job.id} done – sent=${sentCount ?? 0} failed=${failedCount ?? 0}`,
  );
}

// ─── Batch send loop ──────────────────────────────────────────────────────────

async function sendAllBatches(
  supabase: SupabaseClient,
  job: DispatchJob,
  campaign: Campaign,
  smtpConfig: SmtpConfig,
  transport: ReturnType<typeof createTransport>,
): Promise<void> {
  while (true) {
    // Re-check cancellation before each batch
    const { data: check } = await supabase
      .from("campaigns")
      .select("status")
      .eq("id", job.campaign_id)
      .single();

    if (
      check?.status === "cancel_requested" ||
      check?.status === "cancelled"
    ) {
      await markCampaignCancelled(supabase, job.campaign_id, job.id);
      return;
    }

    // Atomically claim next batch
    const { data: batch, error: batchErr } = await supabase.rpc(
      "claim_recipient_batch",
      { p_campaign_id: job.campaign_id, p_batch_size: 50 },
    );

    if (batchErr) {
      console.error("[worker] claim_recipient_batch error:", batchErr.message);
      break;
    }

    const rows = (batch ?? []) as RecipientRow[];
    if (rows.length === 0) break; // No more pending recipients

    console.log(`[worker] sending batch of ${rows.length} for campaign ${job.campaign_id}`);

    await Promise.all(
      rows.map((recipient) =>
        sendToRecipient(supabase, recipient, campaign, smtpConfig, transport),
      ),
    );
  }
}

// ─── Per-recipient send ───────────────────────────────────────────────────────

async function sendToRecipient(
  supabase: SupabaseClient,
  recipient: RecipientRow,
  campaign: Campaign,
  smtpConfig: SmtpConfig,
  transport: ReturnType<typeof createTransport>,
): Promise<void> {
  const mergeData = recipient.merge_data ?? {};
  const subject = renderMergeTags(campaign.subject, mergeData);
  const html = renderMergeTags(campaign.html_body, mergeData);

  try {
    const info = await transport.sendMail({
      from: smtpConfig.SMTP_FROM,
      to: recipient.email,
      subject,
      html,
    });

    const messageId = String(info.messageId ?? "");

    await supabase
      .from("campaign_recipients")
      .update({
        status: "sent",
        smtp_message_id: messageId,
        sent_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", recipient.id);

    await supabase.from("campaign_recipient_events").insert({
      campaign_recipient_id: recipient.id,
      event_type: "sent",
      payload: { message_id: messageId },
    });

    console.log(`[worker] sent → ${recipient.email}`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown SMTP error";

    await supabase
      .from("campaign_recipients")
      .update({ status: "failed", last_error: message })
      .eq("id", recipient.id);

    await supabase.from("campaign_recipient_events").insert({
      campaign_recipient_id: recipient.id,
      event_type: "failed",
      payload: { error: message },
    });

    console.error(`[worker] failed → ${recipient.email}: ${message}`);
  }
}
