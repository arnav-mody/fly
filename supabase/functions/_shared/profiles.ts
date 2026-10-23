// supabase/functions/_shared/profiles.ts
//
// Creating a family_members row — shared by save-person (someone adding a
// relative, friend or one-trip guest) and social's onboarding (a brand-new
// account naming itself).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const NAME = /^[\p{L}\p{M}][\p{L}\p{M}'’.\- ]{0,59}$/u;
export const IATA3 = /^[A-Za-z]{3}$/;

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

export function validateName(first: string, last: string): string[] {
  const errors: string[] = [];
  if (!first || !NAME.test(first)) errors.push("first name is required");
  if (!last || !NAME.test(last)) errors.push("last name is required");
  return errors;
}

// A full profile gets a human-readable slug id (matches the original
// roster's convention — "arnav", not a UUID) so it stays recognizable if
// anyone ever looks at the raw table. A guest gets an opaque id instead:
// nothing about a one-trip guest needs to be memorable, and two guests could
// share a name across different trips. Either way, check for a collision and
// fall back to a random suffix.
export async function createProfile(
  supabase: SupabaseClient,
  opts: { first: string; last: string; guest?: boolean; homeAirport?: string | null; createdBy?: string | null; userId?: string | null },
) {
  const guest = opts.guest === true;
  const code = !guest && opts.homeAirport ? opts.homeAirport.trim().toUpperCase() : null;
  if (code) {
    await supabase.from("airports").upsert({ code }, { onConflict: "code", ignoreDuplicates: true });
  }

  const base = guest ? `guest-${crypto.randomUUID().slice(0, 8)}` : slugify(`${opts.first}-${opts.last}`) || "member";
  let id = base;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing } = await supabase.from("family_members").select("id").eq("id", id).maybeSingle();
    if (!existing) break;
    id = `${base}-${crypto.randomUUID().slice(0, 4)}`;
  }

  // Tone just needs to not obviously clash with the rest of the roster —
  // spreading new arrivals across the same 1-10 palette by count.
  const { count } = await supabase.from("family_members").select("id", { count: "exact", head: true });
  const tone = ((count ?? 0) % 10) + 1;

  return await supabase.from("family_members").insert({
    id,
    first_name: opts.first,
    last_name: opts.last,
    home_airport: code,
    is_guest: guest,
    tone,
    created_by: opts.createdBy ?? null,
    user_id: opts.userId ?? null,
  }).select().single();
}
