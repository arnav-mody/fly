// supabase/functions/save-flight/index.ts
//
// Writes a human-confirmed flight to the database. This is the only path
// that can write to `flights` / `flight_travelers` — the publishable key
// used by the browser has no insert/update policy on those tables (see
// supabase/schema.sql), by design. This function is the validation choke
// point for anything the AI parsed, or anything typed in by hand.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

const IATA3 = /^[A-Za-z]{3}$/;
const IATA2 = /^[A-Za-z0-9]{2}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();
    const {
      airline_code, flight_number, from_airport, to_airport,
      depart_at, arrive_at, seat, confirmation, gate, terminal,
      aircraft, note, source, imagePath, travelerIds, submittedBy,
    } = body;

    const errors: string[] = [];
    if (!flight_number) errors.push("flight number is required");
    if (!from_airport || !IATA3.test(from_airport)) errors.push("origin must be a 3-letter airport code");
    if (!to_airport || !IATA3.test(to_airport)) errors.push("destination must be a 3-letter airport code");
    if (airline_code && !IATA2.test(airline_code)) errors.push("airline code must be 2 characters");
    if (!depart_at || isNaN(Date.parse(depart_at))) errors.push("departure date/time is invalid");
    if (!arrive_at || isNaN(Date.parse(arrive_at))) errors.push("arrival date/time is invalid");
    if (!Array.isArray(travelerIds) || travelerIds.length === 0) errors.push("at least one traveler is required");
    if (errors.length) return json({ ok: false, error: errors.join("; ") }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: flight, error: flightErr } = await supabase
      .from("flights")
      .insert({
        airline_code: airline_code ? airline_code.toUpperCase() : null,
        flight_number: String(flight_number),
        from_airport: from_airport.toUpperCase(),
        to_airport: to_airport.toUpperCase(),
        depart_at,
        arrive_at,
        seat: seat || null,
        confirmation: confirmation || null,
        gate: gate || null,
        terminal: terminal || null,
        aircraft: aircraft || null,
        note: note || null,
        source: source || "upload",
        source_image_path: imagePath || null,
        submitted_by: submittedBy || null,
      })
      .select()
      .single();

    if (flightErr) return json({ ok: false, error: flightErr.message }, 500);

    const travelerRows = travelerIds.map((id: string) => ({ flight_id: flight.id, family_member_id: id }));
    const { error: travelersErr } = await supabase.from("flight_travelers").insert(travelerRows);
    if (travelersErr) {
      // Don't leave an orphaned flight with nobody attached to it.
      await supabase.from("flights").delete().eq("id", flight.id);
      return json({ ok: false, error: `Couldn't attach travelers: ${travelersErr.message}` }, 500);
    }

    return json({ ok: true, flight: { ...flight, travelers: travelerIds } });
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
