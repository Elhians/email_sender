import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const recipientSchema = z.object({
  email: z.string().email(),
  mergeData: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .default({}),
});

const campaignModeSchema = z.enum(["send_now", "schedule"]);

const createCampaignSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    subject: z.string().trim().min(1).max(200),
    htmlBody: z.string().trim().min(1),
    recipients: z.array(recipientSchema).min(1),
    mode: campaignModeSchema,
    scheduledAt: z.string().datetime().nullable(),
  })
  .superRefine((value, context) => {
    if (value.mode === "schedule" && !value.scheduledAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scheduledAt is required when mode is schedule",
        path: ["scheduledAt"],
      });
    }

    if (value.mode === "send_now" && value.scheduledAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "scheduledAt must be empty when mode is send_now",
        path: ["scheduledAt"],
      });
    }
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: corsHeaders,
      },
    );
  }

  const payload = await request.json();
  const parsed = createCampaignSchema.safeParse(payload);

  if (!parsed.success) {
    return Response.json(
      { errors: parsed.error.flatten() },
      {
        status: 400,
        headers: corsHeaders,
      },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const campaignStatus = parsed.data.mode === "schedule" ? "scheduled" : "queued";

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      title: parsed.data.title,
      subject: parsed.data.subject,
      html_body: parsed.data.htmlBody,
      status: campaignStatus,
      mode: parsed.data.mode,
      scheduled_at: parsed.data.scheduledAt,
      recipient_count: parsed.data.recipients.length,
      queued_at: parsed.data.mode === "send_now" ? new Date().toISOString() : null,
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    return Response.json(
      { error: campaignError?.message ?? "Failed to create campaign" },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const recipientRows = parsed.data.recipients.map((recipient) => ({
    campaign_id: campaign.id,
    email: recipient.email,
    merge_data: recipient.mergeData,
    status: parsed.data.mode === "send_now" ? "queued" : "pending",
  }));

  const { error: recipientError } = await supabase
    .from("campaign_recipients")
    .insert(recipientRows);

  if (recipientError) {
    return Response.json(
      { error: recipientError.message },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const { error: jobError } = await supabase.from("campaign_dispatch_jobs").insert({
    campaign_id: campaign.id,
    run_at: parsed.data.scheduledAt ?? new Date().toISOString(),
    status: parsed.data.mode === "schedule" ? "scheduled" : "queued",
  });

  if (jobError) {
    return Response.json(
      { error: jobError.message },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  return Response.json(
    { id: campaign.id },
    {
      status: 201,
      headers: corsHeaders,
    },
  );
});