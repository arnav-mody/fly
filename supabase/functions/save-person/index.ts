// supabase/functions/save-person/index.ts
//
// Adds a new person to family_members — the only write path for creating a
// roster member or a one-trip guest (see is_guest, schema.sql). Called from
// two places: the Travelers tab ("+ Add someone", always a full profile) and
// AddTripModal's traveler picker ("+ Add someone new", either a full profile
// or a guest for just that trip). The publishable key has no insert policy
// on family_members, so this is the only path that can create one.
//
// A full profile gets a human-readable slug id (matches the existing seeded
// roster's convention — "arnav", not a UUID) so it stays recognizable if
// anyone ever looks at the raw table. A guest gets an opaque id instead:
// nothing about a one-trip guest needs to be a stable, memorable identifier,
// and two different guests could plausibly share a first+last name across
// different trips, which a slug can't disambiguate as cleanly as a random
// suffix can.

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
const NAME = /^[\p{L}\p{M}][\p{L}\p{M}'’.\- ]{0,59}$/u;

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const { firstName, lastName, isGuest, homeAirport } = await req.json();

    const first = String(firstName ?? "").trim();
    const last = String(lastName ?? "").trim();
    const errors: string[] = [];
    if (!first || !NAME.test(first)) errors.push("first name is required");
    if (!last || !NAME.test(last)) errors.push("last name is required");
    const guest = isGuest === true;
    const code = !guest && homeAirport ? String(homeAirport).trim().toUpperCase() : null;
    if (code && !IATA3.test(code)) errors.push("home airport must be a 3-letter code");
    if (errors.length) return json({ ok: false, error: errors.join("; ") }, 400);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // The same full profile submitted twice within a couple of minutes is a
    // double-submit (two taps, a retry after a slow response), not two
    // people — hand back the one just created instead of making a twin.
    // Two real people can share a name, so this only looks back briefly.
    if (!guest) {
      const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const { data: recent } = await supabase.from("family_members")
        .select("*").eq("first_name", first).eq("last_name", last).eq("is_guest", false)
        .gte("created_at", since).limit(1).maybeSingle();
      if (recent) return json({ ok: true, person: recent });
    }

    if (code) {
      await supabase.from("airports").upsert({ code }, { onConflict: "code", ignoreDuplicates: true });
    }

    // A full profile keeps the readable-slug convention the original roster
    // uses; a guest gets an opaque id since nothing needs it to be memorable
    // and two guests could share a name across different trips. Either way,
    // check for a collision (a slug fight between two real members is far
    // more plausible than a guest one) and fall back to a random suffix.
    const base = guest ? `guest-${crypto.randomUUID().slice(0, 8)}` : slugify(`${first}-${last}`) || "member";
    let id = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: existing } = await supabase.from("family_members").select("id").eq("id", id).maybeSingle();
      if (!existing) break;
      id = `${base}-${crypto.randomUUID().slice(0, 4)}`;
    }

    // Tone just needs to not obviously clash with the rest of the roster —
    // picking from how many people already exist spreads new arrivals across
    // the same 1-10 palette the seeded roster uses, without needing the
    // client to know or send anything about existing tones.
    const { count } = await supabase.from("family_members").select("id", { count: "exact", head: true });
    const tone = ((count ?? 0) % 10) + 1;

    const row = {
      id,
      first_name: first,
      last_name: last,
      home_airport: code,
      is_guest: guest,
      tone,
    };
    const { data: person, error } = await supabase.from("family_members").insert(row).select().single();
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, person });
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
