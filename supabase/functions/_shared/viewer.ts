// supabase/functions/_shared/viewer.ts
//
// Who is calling, and what they're allowed to touch. Every Edge Function
// uses the secret key (it bypasses RLS), so this is the only thing standing
// between a request and the database — each function must call getViewer()
// first and check canManage() before writing anything about a person.

import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY")!;

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export type Viewer = { user: User; profileId: string | null };

// The signed-in account behind the request's access token, plus the profile
// it has claimed (null until onboarding finishes). A request carrying only
// the publishable key — i.e. nobody signed in — gets null.
export async function getViewer(req: Request, supabase: SupabaseClient): Promise<Viewer | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || token.startsWith("sb_")) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  const { data: profile } = await supabase.from("family_members").select("id").eq("user_id", data.user.id).maybeSingle();
  return { user: data.user, profileId: profile?.id ?? null };
}

// The usual guard: a signed-in account that has finished onboarding.
export async function requireProfile(req: Request, supabase: SupabaseClient) {
  const viewer = await getViewer(req, supabase);
  if (!viewer) return { error: json({ ok: false, error: "Please sign in first." }, 401) };
  if (!viewer.profileId) return { error: json({ ok: false, error: "Finish setting up your profile first." }, 403) };
  return { viewer: viewer as Viewer & { profileId: string } };
}

// Same rule as can_manage() in schema.sql (that's the source of truth):
// yourself, anyone whose close circle you're in, or a guest.
export async function canManage(supabase: SupabaseClient, viewerId: string, personId: string) {
  const { data, error } = await supabase.rpc("can_manage", { p_viewer: viewerId, p_person: personId });
  return !error && data === true;
}

export async function canManageAll(supabase: SupabaseClient, viewerId: string, personIds: string[]) {
  const results = await Promise.all(personIds.map((id) => canManage(supabase, viewerId, id)));
  return results.every(Boolean);
}

export async function canManageAny(supabase: SupabaseClient, viewerId: string, personIds: string[]) {
  const results = await Promise.all(personIds.map((id) => canManage(supabase, viewerId, id)));
  return results.some(Boolean);
}
