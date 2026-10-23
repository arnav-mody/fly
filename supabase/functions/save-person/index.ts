// supabase/functions/save-person/index.ts
//
// Adds a new person to family_members on someone else's behalf — a relative
// who doesn't use the app (yet), a friend, or a one-trip guest (see
// is_guest, schema.sql). Called from the People tab ("+ Add someone", always
// a full profile) and the add-trip traveler picker (a full profile or a
// guest).
//
// `manage: true` — an explicit choice in the form, never a default the
// server assumes — puts the account adding them into the new profile's close
// circle: they can then see that person's flight details and add or change
// their trips (what you need when entering trips for a grandparent or a
// child). It never shows the new person the adder's own details. When the
// person later signs in, the People tab shows who has that access and lets
// them turn it off. (A new account naming itself goes through social's
// onboarding instead.)

import { adminClient, CORS_HEADERS, json, requireProfile } from "../_shared/viewer.ts";
import { createProfile, IATA3, validateName } from "../_shared/profiles.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const supabase = adminClient();
    const auth = await requireProfile(req, supabase);
    if (auth.error) return auth.error;
    const me = auth.viewer.profileId;

    const { firstName, lastName, isGuest, homeAirport, manage } = await req.json();
    const first = String(firstName ?? "").trim();
    const last = String(lastName ?? "").trim();
    const guest = isGuest === true;
    const errors = validateName(first, last);
    const code = !guest && homeAirport ? String(homeAirport).trim().toUpperCase() : null;
    if (code && !IATA3.test(code)) errors.push("home airport must be a 3-letter code");
    if (errors.length) return json({ ok: false, error: errors.join("; ") }, 400);

    // The same full profile submitted twice by the same person within a
    // couple of minutes is a double-submit (two taps, a retry after a slow
    // response), not two people — hand back the one just created instead of
    // making a twin. Two real people can share a name, so this only looks
    // back briefly.
    if (!guest) {
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: recent } = await supabase.from("family_members")
        .select("*").eq("first_name", first).eq("last_name", last).eq("is_guest", false).eq("created_by", me)
        .gte("created_at", since).limit(1).maybeSingle();
      if (recent) return json({ ok: true, person: recent });
    }

    const { data: person, error } = await createProfile(supabase, { first, last, guest, homeAirport: code, createdBy: me });
    if (error) return json({ ok: false, error: error.message }, 500);

    if (!guest && manage === true) {
      const { error: circleErr } = await supabase.from("close_circle").insert({ owner_id: person.id, member_id: me });
      if (circleErr) return json({ ok: false, error: `Added, but couldn't link them to you: ${circleErr.message}` }, 500);
    }

    return json({ ok: true, person });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});
