import { createClient } from "@supabase/supabase-js";
import type { CreateCampaignInput } from "@email-sender/shared";
import { loadWebEnv } from "./env";

// ─── Client ───────────────────────────────────────────────────────────────────

function getClient() {
  const env = loadWebEnv();
  return createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
}

// ─── Public row types ─────────────────────────────────────────────────────────

export interface CampaignSummary {
  id: string;
  title: string;
  status: string;
  mode: string;
  scheduled_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
}

export interface RecipientRow {
  id: string;
  email: string;
  status: string;
  last_error: string | null;
  attempt_count: number;
  sent_at: string | null;
}

export interface CampaignDetail {
  campaign: CampaignSummary & { subject: string; html_body: string };
  recipients: RecipientRow[];
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function createCampaign(
  payload: CreateCampaignInput,
): Promise<{ id: string }> {
  const sb = getClient();
  const { data, error } = await sb.functions.invoke<{ id: string }>(
    "create-campaign",
    { body: payload },
  );
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("No campaign id returned");
  return data;
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  const sb = getClient();
  const { data, error } = await sb.functions.invoke<{
    campaigns: CampaignSummary[];
  }>("list-campaigns");
  if (error) throw new Error(error.message);
  return data?.campaigns ?? [];
}

export async function getCampaign(id: string): Promise<CampaignDetail> {
  const sb = getClient();
  const { data, error } = await sb.functions.invoke<CampaignDetail>(
    "get-campaign",
    { body: { id } },
  );
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Empty response from get-campaign");
  return data;
}

export async function cancelCampaign(id: string): Promise<void> {
  const sb = getClient();
  const { error } = await sb.functions.invoke("cancel-campaign", {
    body: { id },
  });
  if (error) throw new Error(error.message);
}
