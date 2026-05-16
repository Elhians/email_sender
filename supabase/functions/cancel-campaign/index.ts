import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (request: Request) => {
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

  const { id } = await request.json();

  if (!id) {
    return Response.json(
      { error: "Missing campaign id" },
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

  const now = new Date().toISOString();

  const { error: campaignError } = await supabase
    .from("campaigns")
    .update({
      status: "cancel_requested",
      cancelled_at: now,
    })
    .eq("id", id)
    .in("status", ["scheduled", "queued", "sending"]);

  if (campaignError) {
    return Response.json(
      { error: campaignError.message },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const { error: recipientError } = await supabase
    .from("campaign_recipients")
    .update({ status: "cancelled" })
    .eq("campaign_id", id)
    .in("status", ["pending", "queued"]);

  if (recipientError) {
    return Response.json(
      { error: recipientError.message },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const { error: jobError } = await supabase
    .from("campaign_dispatch_jobs")
    .update({ status: "cancelled" })
    .eq("campaign_id", id)
    .in("status", ["scheduled", "queued"]);

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
    { success: true },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
});