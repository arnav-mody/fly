// supabase/functions/update-home/index.ts
//
// Sets a family member's home airport — editable from the Travelers tab.
// This is what suppresses the "return not logged" nudge when someone lands
// exactly where they live (see isHomeArrival in data.js), and what the
// Calendar's "away from home" detection keys off of. The publishable key
// has no write policy on family_members, so this is the only path that can
// change it.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

const PERSON_ID = /^[a-z][a-z0-9_-]{0,40}$/;
const IATA3 = /^[A-Za-z]{3}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { personId, homeAirport } = await req.json();
    if (!personId || !PERSON_ID.test(personId)) return json({ ok: false, error: "Invalid person id" }, 400);

    // Clearing it (empty string / null) is allowed — "not set yet" is a
    // valid state, same as the original defaults.
    const code = homeAirport ? String(homeAirport).trim().toUpperCase() : null;
    if (code && !IATA3.test(code)) return json({ ok: false, error: "Home airport must be a 3-letter code" }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Free-typed codes we don't already have get a bare stub row, same
    // pattern as save-flight — never blocks the save on an unrecognized code.
    if (code) {
      await supabase.from("airports").upsert({ code }, { onConflict: "code", ignoreDuplicates: true });
    }

    const { error } = await supabase.from("family_members").update({ home_airport: code }).eq("id", personId);
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, homeAirport: code });
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
