import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  if (request.method !== "GET" && request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      {
        status: 405,
        headers: corsHeaders,
      },
    );
  }

  let campaignId: string | null = null;

  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    campaignId = body?.id ?? null;
  } else {
    const url = new URL(request.url);
    campaignId = url.searchParams.get("id");
  }

  if (!campaignId) {
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

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();

  if (campaignError) {
    return Response.json(
      { error: campaignError.message },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  const { data: recipients, error: recipientsError } = await supabase
    .from("campaign_recipients")
    .select("id, email, status, last_error, attempt_count, sent_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (recipientsError) {
    return Response.json(
      { error: recipientsError.message },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  return Response.json(
    {
      campaign,
      recipients: recipients ?? [],
    },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
});