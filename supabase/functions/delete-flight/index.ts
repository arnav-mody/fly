// supabase/functions/delete-flight/index.ts
//
// Deletes a journey the family added. Like every other write, this goes
// through an Edge Function using the secret key — signed-in viewers have no
// write access to `flights`/`flight_travelers` (see schema.sql). Only
// someone who can manage every traveler on the flight may delete it, so
// nobody can remove a trip that includes a person outside their circle.

import { adminClient, canManageAll, CORS_HEADERS, json, requireProfile } from "../_shared/viewer.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const supabase = adminClient();
    const auth = await requireProfile(req, supabase);
    if (auth.error) return auth.error;

    const { flightId } = await req.json();
    if (!flightId || typeof flightId !== "string") {
      return json({ ok: false, error: "Missing flightId" }, 400);
    }

    const { data: aboard, error: aboardErr } = await supabase
      .from("flight_travelers").select("family_member_id").eq("flight_id", flightId);
    if (aboardErr) return json({ ok: false, error: aboardErr.message }, 500);
    const travelers = (aboard ?? []).map((r) => r.family_member_id);
    if (!(await canManageAll(supabase, auth.viewer.profileId, travelers))) {
      return json({ ok: false, error: "You can only delete trips for yourself or people in whose close circle you are." }, 403);
    }

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
