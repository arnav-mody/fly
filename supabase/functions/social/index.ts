// supabase/functions/social/index.ts
//
// Everything about who's connected to whom, one function with an `action`:
//
//   invite-info     (no sign-in)  what an invite link is, for the sign-in screen
//   onboard         (signed in)   attach the account to a profile + use an invite
//   create-invite   (profile)     a personal invite, or your reusable follow link
//   respond         (profile)     accept or decline someone's follow request
//   request-follow  (profile)     ask to follow someone
//   unfollow        (profile)     stop following someone
//   remove-follower (profile)     stop someone following you
//   set-circle      (profile)     add/remove someone from your close circle
//
// Identity is the verified email on the account (Supabase Auth), never the
// invite link: however many invites someone gets, signing in with the same
// email lands on the same account, and each invite just adds a connection.

import { adminClient, canManage, CORS_HEADERS, getViewer, json, requireProfile } from "../_shared/viewer.ts";
import { createProfile, validateName } from "../_shared/profiles.ts";

const PERSONAL_INVITE_DAYS = 14;
const PERSON_ID = /^[a-z][a-z0-9_-]{0,60}$/;
type Admin = ReturnType<typeof adminClient>;

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// An invite plus whether it can still be used, and the names to show for it.
async function loadInvite(supabase: Admin, token: unknown) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { data: invite } = await supabase.from("invites").select("*").eq("token", token).maybeSingle();
  if (!invite) return null;
  const ids = [invite.inviter_id, invite.profile_id].filter(Boolean);
  const { data: people } = await supabase.from("family_members").select("id, first_name, last_name, user_id").in("id", ids);
  const byId = Object.fromEntries((people ?? []).map((p) => [p.id, p]));
  const expired = !!invite.expires_at && new Date(invite.expires_at) < new Date();
  const used = invite.kind === "personal" && !!invite.used_at;
  const target = invite.profile_id ? byId[invite.profile_id] : null;
  return {
    invite,
    usable: !expired && !used,
    reason: expired ? "This invite has expired — ask for a new one." : used ? "This invite has already been used." : null,
    inviter: byId[invite.inviter_id] ?? null,
    target,
    targetClaimable: !!target && !target.user_id,
  };
}

async function follow(supabase: Admin, follower: string, followee: string, status: "pending" | "accepted") {
  if (follower === followee) return;
  if (status === "accepted") {
    await supabase.from("follows").upsert({ follower_id: follower, followee_id: followee, status }, { onConflict: "follower_id,followee_id" });
  } else {
    // A request never downgrades an existing accepted follow.
    await supabase.from("follows").upsert({ follower_id: follower, followee_id: followee, status }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true });
  }
}

// Use an invite on behalf of profile `me`. Personal: connected both ways on
// the spot (the inviter chose this person), plus close circle if the inviter
// asked for it. Link: a pending request the inviter approves.
async function applyInvite(supabase: Admin, loaded: NonNullable<Awaited<ReturnType<typeof loadInvite>>>, me: string, userId: string) {
  const { invite } = loaded;
  if (!loaded.usable || invite.inviter_id === me) return null;
  if (invite.kind === "personal") {
    await follow(supabase, me, invite.inviter_id, "accepted");
    await follow(supabase, invite.inviter_id, me, "accepted");
    if (invite.close_circle) {
      await supabase.from("close_circle").upsert({ owner_id: invite.inviter_id, member_id: me }, { onConflict: "owner_id,member_id", ignoreDuplicates: true });
    }
    await supabase.from("invites").update({ used_at: new Date().toISOString(), used_by: userId }).eq("token", invite.token);
    return { kind: "personal", inviter: loaded.inviter?.first_name ?? null };
  }
  await follow(supabase, me, invite.inviter_id, "pending");
  return { kind: "link", inviter: loaded.inviter?.first_name ?? null };
}

// Claim a not-yet-claimed profile for this account. Conditional on user_id
// still being null, so two accounts can never claim the same person.
async function claim(supabase: Admin, profileId: string, userId: string) {
  const { data } = await supabase.from("family_members").update({ user_id: userId })
    .eq("id", profileId).is("user_id", null).select("id").maybeSingle();
  return data?.id ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const supabase = adminClient();
    const body = await req.json();
    const action = body.action;

    // ── Before sign-in ──────────────────────────────────────────────────────
    if (action === "invite-info") {
      const loaded = await loadInvite(supabase, body.token);
      if (!loaded) return json({ ok: true, valid: false, reason: "That invite link doesn't look right — ask for a new one." });
      return json({
        ok: true,
        valid: loaded.usable,
        reason: loaded.reason,
        kind: loaded.invite.kind,
        inviter: loaded.inviter ? { first: loaded.inviter.first_name, last: loaded.inviter.last_name } : null,
        profile: loaded.targetClaimable ? { first: loaded.target.first_name, last: loaded.target.last_name } : null,
      });
    }

    // ── Right after sign-in ─────────────────────────────────────────────────
    if (action === "onboard") {
      const viewer = await getViewer(req, supabase);
      if (!viewer) return json({ ok: false, error: "Please sign in first." }, 401);
      const loaded = body.inviteToken ? await loadInvite(supabase, body.inviteToken) : null;
      let me = viewer.profileId;
      let claimedVia: string | null = null;

      if (!me) {
        // 1. A profile someone set aside for this exact email.
        const email = (viewer.user.email ?? "").toLowerCase();
        if (email) {
          const { data: waiting } = await supabase.from("family_members").select("id")
            .ilike("claim_email", email).is("user_id", null).maybeSingle();
          if (waiting) { me = await claim(supabase, waiting.id, viewer.user.id); claimedVia = me ? "email" : null; }
        }
        // 2. The profile this invite was made for (Grandma's, history and all).
        if (!me && loaded?.usable && loaded.targetClaimable) {
          me = await claim(supabase, loaded.invite.profile_id, viewer.user.id);
          claimedVia = me ? "invite" : null;
        }
        // 3. Otherwise a brand-new profile — which needs a name first.
        if (!me) {
          const first = String(body.firstName ?? "").trim(), last = String(body.lastName ?? "").trim();
          if (!first && !last) {
            return json({ ok: true, needsName: true, invite: loaded?.usable ? { kind: loaded.invite.kind, inviter: loaded.inviter?.first_name ?? null } : null });
          }
          const errors = validateName(first, last);
          if (errors.length) return json({ ok: false, error: errors.join("; ") }, 400);
          const { data: created, error } = await createProfile(supabase, { first, last, userId: viewer.user.id });
          if (error) return json({ ok: false, error: error.message }, 500);
          me = created.id;
          claimedVia = "new";
        }
      }

      const joined = loaded ? await applyInvite(supabase, loaded, me!, viewer.user.id) : null;
      return json({ ok: true, profileId: me, claimedVia, joined, inviteProblem: loaded && !loaded.usable ? loaded.reason : null });
    }

    // ── Everything else needs a finished profile ────────────────────────────
    const auth = await requireProfile(req, supabase);
    if (auth.error) return auth.error;
    const me = auth.viewer.profileId;
    const other = body.profileId ?? body.followerId ?? body.memberId;
    if (other != null && (typeof other !== "string" || !PERSON_ID.test(other))) {
      return json({ ok: false, error: "Invalid person id" }, 400);
    }

    if (action === "create-invite") {
      if (body.kind === "link") {
        // One reusable follow link per person; reuse it rather than minting
        // a new one every time someone taps Share.
        const { data: existing } = await supabase.from("invites").select("token")
          .eq("inviter_id", me).eq("kind", "link").is("expires_at", null).limit(1).maybeSingle();
        if (existing) return json({ ok: true, token: existing.token, kind: "link" });
        const token = newToken();
        const { error } = await supabase.from("invites").insert({ token, kind: "link", inviter_id: me });
        if (error) return json({ ok: false, error: error.message }, 500);
        return json({ ok: true, token, kind: "link" });
      }
      let profileId: string | null = null;
      if (body.profileId) {
        const { data: target } = await supabase.from("family_members").select("id, user_id, is_guest").eq("id", body.profileId).maybeSingle();
        if (!target || target.is_guest) return json({ ok: false, error: "Couldn't find that person." }, 404);
        if (target.user_id) return json({ ok: false, error: "They've already signed in — follow them instead." }, 409);
        if (!(await canManage(supabase, me, target.id))) return json({ ok: false, error: "You can only invite people whose close circle you're in." }, 403);
        profileId = target.id;
      }
      const token = newToken();
      const expires = new Date(Date.now() + PERSONAL_INVITE_DAYS * 86400000).toISOString();
      const { error } = await supabase.from("invites").insert({
        token, kind: "personal", inviter_id: me, profile_id: profileId,
        close_circle: body.closeCircle === true, expires_at: expires,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, token, kind: "personal", expiresAt: expires });
    }

    if (action === "respond") {
      if (!other) return json({ ok: false, error: "Missing followerId" }, 400);
      const q = supabase.from("follows");
      const { error } = body.accept === true
        ? await q.update({ status: "accepted" }).eq("follower_id", other).eq("followee_id", me)
        : await q.delete().eq("follower_id", other).eq("followee_id", me).eq("status", "pending");
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "request-follow") {
      if (!other || other === me) return json({ ok: false, error: "Missing profileId" }, 400);
      const { data: target } = await supabase.from("family_members").select("id, user_id").eq("id", other).maybeSingle();
      if (!target?.user_id) return json({ ok: false, error: "They haven't joined yet — invite them instead." }, 409);
      await follow(supabase, me, other, "pending");
      return json({ ok: true });
    }

    if (action === "unfollow" || action === "remove-follower") {
      if (!other) return json({ ok: false, error: "Missing profileId" }, 400);
      const [follower, followee] = action === "unfollow" ? [me, other] : [other, me];
      const { error } = await supabase.from("follows").delete().eq("follower_id", follower).eq("followee_id", followee);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "set-circle") {
      if (!other || other === me) return json({ ok: false, error: "Missing memberId" }, 400);
      if (body.inCircle === true) {
        // Only people already connected to you — the circle is a level of
        // trust you grant someone you know, not a way to reach strangers.
        const { data: links } = await supabase.from("follows").select("follower_id")
          .or(`and(follower_id.eq.${me},followee_id.eq.${other}),and(follower_id.eq.${other},followee_id.eq.${me})`)
          .eq("status", "accepted").limit(1);
        if (!links?.length) return json({ ok: false, error: "Connect with them first (invite them or accept their request)." }, 409);
        const { error } = await supabase.from("close_circle").upsert({ owner_id: me, member_id: other }, { onConflict: "owner_id,member_id", ignoreDuplicates: true });
        if (error) return json({ ok: false, error: error.message }, 500);
      } else {
        const { error } = await supabase.from("close_circle").delete().eq("owner_id", me).eq("member_id", other);
        if (error) return json({ ok: false, error: error.message }, 500);
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});
