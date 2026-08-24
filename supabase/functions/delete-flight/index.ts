// supabase/functions/delete-flight/index.ts
//
// Deletes a journey the family added. Like every other write, this goes
// through an Edge Function using the secret key — the publishable key has
// no delete policy on `flights`/`flight_travelers` (see schema.sql).

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { flightId } = await req.json();
    if (!flightId || typeof flightId !== "string") {
      return json({ ok: false, error: "Missing flightId" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // flight_travelers has no ON DELETE CASCADE from flights, so this needs
    // clearing explicitly before the flight row itself can go.
    const { error: travelersErr } = await supabase.from("flight_travelers").delete().eq("flight_id", flightId);
    if (travelersErr) return json({ ok: false, error: travelersErr.message }, 500);

    const { error: statusErr } = await supabase.from("flight_status_cache").delete().eq("flight_id", flightId);
    if (statusErr) return json({ ok: false, error: statusErr.message }, 500);

    const { error: flightErr } = await supabase.from("flights").delete().eq("id", flightId);
    if (flightErr) return json({ ok: false, error: flightErr.message }, 500);

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
