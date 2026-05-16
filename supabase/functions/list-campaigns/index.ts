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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { data, error } = await supabase
    .from("campaigns")
    .select("id, title, status, mode, scheduled_at, recipient_count, sent_count, failed_count, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return Response.json(
      { error: error.message },
      {
        status: 500,
        headers: corsHeaders,
      },
    );
  }

  return Response.json(
    { campaigns: data ?? [] },
    {
      status: 200,
      headers: corsHeaders,
    },
  );
});