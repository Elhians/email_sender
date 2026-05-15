import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (request) => {
  // Accept both GET (?id=) and POST ({ id }) so functions.invoke works easily.
  let campaignId: string | null = null;
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    campaignId = body?.id ?? null;
  } else {
    const url = new URL(request.url);
    campaignId = url.searchParams.get("id");
  }

  if (!campaignId) {
    return Response.json({ error: "Missing campaign id" }, { status: 400 });
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
    return Response.json({ error: campaignError.message }, { status: 500 });
  }

  const { data: recipients, error: recipientsError } = await supabase
    .from("campaign_recipients")
    .select("id, email, status, last_error, attempt_count, sent_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: true });

  if (recipientsError) {
    return Response.json({ error: recipientsError.message }, { status: 500 });
  }

  return Response.json({ campaign, recipients: recipients ?? [] });
});
