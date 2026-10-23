// supabase/functions/update-home/index.ts
//
// Sets a family member's home airport — editable from the Travelers tab.
// This is what suppresses the "return not logged" nudge when someone lands
// exactly where they live (see isHomeArrival in data.js), and what the
// Calendar's "away from home" detection keys off of. Only someone who can
// manage that person (themselves, their close circle) may change it.

import { adminClient, canManage, CORS_HEADERS, json, requireProfile } from "../_shared/viewer.ts";

const PERSON_ID = /^[a-z][a-z0-9_-]{0,40}$/;
const IATA3 = /^[A-Za-z]{3}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const supabase = adminClient();
    const auth = await requireProfile(req, supabase);
    if (auth.error) return auth.error;

    const { personId, homeAirport } = await req.json();
    if (!personId || !PERSON_ID.test(personId)) return json({ ok: false, error: "Invalid person id" }, 400);
    if (!(await canManage(supabase, auth.viewer.profileId, personId))) {
      return json({ ok: false, error: "You can only change this for yourself or people who've added you to their close circle." }, 403);
    }

    // Clearing it (empty string / null) is allowed — "not set yet" is a
    // valid state, same as the original defaults.
    const code = homeAirport ? String(homeAirport).trim().toUpperCase() : null;
    if (code && !IATA3.test(code)) return json({ ok: false, error: "Home airport must be a 3-letter code" }, 400);

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
