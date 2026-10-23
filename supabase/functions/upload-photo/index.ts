// supabase/functions/upload-photo/index.ts
//
// Stores a family member's profile photo in the public `family-photos`
// bucket at `${personId}.jpg`, overwriting any existing photo for that
// person. There's no `family_members` write involved — Avatar (components.jsx)
// looks photos up by this same deterministic path, so nothing else needs to
// know a new photo was uploaded. Only someone who can manage that person may
// replace their photo.
//
// The client always re-encodes to JPEG before calling this (see
// resizeImageForUpload in modals.jsx), so the stored filename is always
// predictable regardless of the source image format.

import { adminClient, canManage, CORS_HEADERS, json, requireProfile } from "../_shared/viewer.ts";

// Matches the slug-style ids used in data.js's FAMILY array, e.g. "arnav".
const PERSON_ID = /^[a-z][a-z0-9_-]{0,40}$/;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const supabase = adminClient();
    const auth = await requireProfile(req, supabase);
    if (auth.error) return auth.error;

    const { personId, image, mediaType } = await req.json();
    if (!personId || !PERSON_ID.test(personId)) return json({ ok: false, error: "Invalid person id" }, 400);
    if (!(await canManage(supabase, auth.viewer.profileId, personId))) {
      return json({ ok: false, error: "You can only change your own photo, or for people who've added you to their close circle." }, 403);
    }
    if (!image || !mediaType) return json({ ok: false, error: "Missing image or mediaType" }, 400);
    if (!/^image\/(jpeg|png|webp)$/.test(mediaType)) {
      return json({ ok: false, error: "Unsupported image type — use JPEG, PNG, or WebP" }, 400);
    }

    const path = `${personId}.jpg`;
    const { error } = await supabase.storage
      .from("family-photos")
      .upload(path, base64ToBytes(image), { contentType: mediaType, upsert: true });
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({ ok: true, path });
  } catch (err) {
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
