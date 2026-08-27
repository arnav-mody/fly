// supabase/functions/save-flight/index.ts
//
// Writes a human-confirmed journey to the database. This is the only path
// that can write to `flights` / `flight_travelers` — the publishable key
// used by the browser has no insert/update policy on those tables (see
// supabase/schema.sql), by design. This function is the validation choke
// point for anything the AI parsed, or anything typed in by hand.
//
// Handles three journey modes: 'flight' (airline + IATA airport codes),
// 'train', and 'car' (both: just free-text place names, no airline/number).
// Airline/airport codes that aren't already in our small reference tables
// get a bare-bones stub row auto-created here (code only) rather than
// failing the save — see the "loosen reference-table constraints" note in
// schema.sql. Train/car place names go through the same stub mechanism,
// keyed by whatever text was typed.
//
// Pass `flightId` in the body to update an existing flight in place instead
// of inserting a new one (used by AddTripModal's edit mode) — same
// validation either way, just an update + traveler-list replace instead of
// an insert.

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
const MODES = ["flight", "train", "car"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const body = await req.json();

    // Lightweight path: retroactively link two already-saved legs into one
    // journey (see the "Connects to X — link as one trip?" prompt on the
    // board) — just sets a shared journey_id on both rows, no other field
    // touched. Kept separate from the full save path below since neither
    // row's other data needs re-validating.
    if (Array.isArray(body.linkFlightIds) && body.linkFlightIds.length === 2) {
      const [idA, idB] = body.linkFlightIds;
      if (typeof idA !== "string" || typeof idB !== "string") {
        return json({ ok: false, error: "linkFlightIds must be two flight ids" }, 400);
      }
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: rows, error: fetchErr } = await supabase
        .from("flights").select("id, journey_id").in("id", [idA, idB]);
      if (fetchErr) return json({ ok: false, error: fetchErr.message }, 500);
      if (!rows || rows.length !== 2) return json({ ok: false, error: "Couldn't find both flights to link" }, 404);
      const journeyId = rows.find((r) => r.journey_id)?.journey_id ?? crypto.randomUUID();
      const { error: updateErr } = await supabase.from("flights").update({ journey_id: journeyId }).in("id", [idA, idB]);
      if (updateErr) return json({ ok: false, error: updateErr.message }, 500);
      return json({ ok: true, journeyId });
    }

    // Lightweight path: dismiss the "return not logged" nudge on one flight
    // (see FlightCard/FlightDetailModal's Dismiss button) — just flips one
    // flag, no other field touched or re-validated.
    if (body.dismissReturn === true && typeof body.flightId === "string") {
      const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
      const { error: dismissErr } = await supabase.from("flights").update({ return_dismissed: true }).eq("id", body.flightId);
      if (dismissErr) return json({ ok: false, error: dismissErr.message }, 500);
      return json({ ok: true });
    }

    const {
      flightId, mode: rawMode, airline_code, flight_number, from_airport, to_airport,
      depart_at, arrive_at, note, source, travelerIds, journeyId,
    } = body;
    const isEdit = !!flightId && typeof flightId === "string";
    const mode = MODES.includes(rawMode) ? rawMode : "flight";
    const isFlight = mode === "flight";

    const errors: string[] = [];
    if (isFlight) {
      if (!from_airport || !IATA3.test(from_airport)) errors.push("origin must be a 3-letter airport code");
      if (!to_airport || !IATA3.test(to_airport)) errors.push("destination must be a 3-letter airport code");
      if (airline_code && !IATA2.test(airline_code)) errors.push("airline code must be 2 characters");
    } else {
      if (!from_airport || !String(from_airport).trim()) errors.push("origin is required");
      if (!to_airport || !String(to_airport).trim()) errors.push("destination is required");
    }
    if (!depart_at || isNaN(Date.parse(depart_at))) errors.push("departure date/time is invalid");
    if (!arrive_at || isNaN(Date.parse(arrive_at))) errors.push("arrival date/time is invalid");
    if (!Array.isArray(travelerIds) || travelerIds.length === 0) errors.push("at least one traveler is required");
    if (errors.length) return json({ ok: false, error: errors.join("; ") }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const fromCode = isFlight ? from_airport.toUpperCase() : String(from_airport).trim();
    const toCode   = isFlight ? to_airport.toUpperCase()   : String(to_airport).trim();
    const airlineCode = isFlight && airline_code ? airline_code.toUpperCase() : null;

    // Make sure whatever place/airline codes we're about to reference exist,
    // so the flights-table foreign keys don't reject a code we haven't seen
    // before. "ignoreDuplicates" means this never clobbers a real seeded row
    // with a blank stub — it only fills in gaps.
    await supabase.from("airports").upsert(
      [{ code: fromCode }, { code: toCode }],
      { onConflict: "code", ignoreDuplicates: true }
    );
    if (airlineCode) {
      await supabase.from("airlines").upsert(
        { code: airlineCode },
        { onConflict: "code", ignoreDuplicates: true }
      );
    }

    const row = {
      mode,
      airline_code: airlineCode,
      flight_number: isFlight && flight_number ? String(flight_number) : null,
      from_airport: fromCode,
      to_airport: toCode,
      depart_at,
      arrive_at,
      note: note || null,
      source: source || "upload",
      journey_id: journeyId || null,
    };

    const { data: flight, error: flightErr } = isEdit
      ? await supabase.from("flights").update(row).eq("id", flightId).select().single()
      : await supabase.from("flights").insert(row).select().single();

    if (flightErr) return json({ ok: false, error: flightErr.message }, 500);

    // Simplest correct way to make the traveler list match exactly what was
    // submitted: clear whatever's there (a no-op on a fresh insert) and
    // re-insert the current set, rather than diffing old vs. new.
    if (isEdit) {
      const { error: clearErr } = await supabase.from("flight_travelers").delete().eq("flight_id", flight.id);
      if (clearErr) return json({ ok: false, error: `Couldn't update travelers: ${clearErr.message}` }, 500);
    }

    const travelerRows = travelerIds.map((id: string) => ({ flight_id: flight.id, family_member_id: id }));
    const { error: travelersErr } = await supabase.from("flight_travelers").insert(travelerRows);
    if (travelersErr) {
      if (!isEdit) {
        // Don't leave an orphaned new flight with nobody attached to it.
        await supabase.from("flights").delete().eq("id", flight.id);
      }
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
