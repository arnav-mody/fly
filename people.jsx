// people.jsx — the social side of the People tab: invites, follow requests,
// and who sees what. Everything here goes through the `social` Edge
// Function (see supabase/functions/social) via callSocial (auth.jsx).

// An invite link for this same page (so a branch preview's invite leads to
// the preview, and the live site's to the live site).
const inviteUrl = (token) => `${location.origin}${location.pathname}?invite=${encodeURIComponent(token)}`;

// The phone's own share sheet (Messages, WhatsApp, email…) where there is
// one; otherwise copy to the clipboard. Returns what happened, for the UI.
async function shareLink({ url, title, text }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return "shared"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelled"; }
  }
  try { await navigator.clipboard.writeText(url); return "copied"; } catch (e) { return "show"; }
}

// How a person relates to the viewer, in a few plain words.
function relationLabel(p) {
  if (p.isMe) return "You";
  if (p.isGuest) return "Guest on a trip";
  const parts = [];
  if (p.inMyCircle && p.inTheirCircle) parts.push("Close circle — you share flight details");
  else if (p.inMyCircle) parts.push("Sees your flight details");
  else if (p.inTheirCircle) parts.push("Shares flight details with you");
  else if (p.iFollow === "accepted" && p.followsMe === "accepted") parts.push("You follow each other");
  else if (p.iFollow === "accepted") parts.push("You follow them");
  else if (p.followsMe === "accepted") parts.push("Follows you");
  if (p.iFollow === "pending") parts.push("Your request is waiting");
  if (!p.claimed) parts.push("Hasn't joined yet");
  return parts.join(" · ") || "Traveling with someone you follow";
}

// ── Invite ──────────────────────────────────────────────────────────────────
// `profile` set: invite that person to their own (not yet claimed) profile —
// their trips are already there waiting. Otherwise: a personal invite for
// anyone, or the viewer's reusable follow link.
function InviteModal({ open, onClose, profile }) {
  const me = window.MGData.familyById(window.MG_ME);
  const [closeCircle, setCloseCircle] = React.useState(!!profile);
  const [busy, setBusy] = React.useState(null); // "personal" | "link" | null
  const [result, setResult] = React.useState(null); // { url, outcome, kind }
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (open) { setCloseCircle(!!profile); setResult(null); setError(null); setBusy(null); }
  }, [open, profile]);

  const make = async (kind) => {
    setBusy(kind); setError(null); setResult(null);
    try {
      const res = await callSocial({ action: "create-invite", kind, profileId: kind === "personal" ? profile?.id : undefined, closeCircle: kind === "personal" && closeCircle });
      const url = inviteUrl(res.token);
      const who = me ? me.first : "Someone";
      const text = kind === "link"
        ? `Follow my travels on Fly — ${who}`
        : profile
          ? `${who} added your trips on Fly. Tap to see them, and everyone else's.`
          : `${who} invited you to Fly — see where the family's traveling.`;
      const outcome = await shareLink({ url, title: "Join me on Fly", text });
      setResult({ url, outcome, kind });
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="at">
        <header className="at__head">
          <h2 className="at__title">{profile ? `Invite ${profile.first} to Fly` : "Invite someone"}</h2>
        </header>
        <div className="at__body">
          <p className="pp__intro">
            {profile
              ? `${profile.first} signs in with their own email and lands on their profile — the trips you've already added are there. The link works once and expires in two weeks.`
              : "A personal invite connects you both as soon as they sign in. It works once and expires in two weeks."}
          </p>
          <label className="at__checkbox">
            <input type="checkbox" checked={closeCircle} onChange={(e) => setCloseCircle(e.target.checked)} />
            <span>Let them see your flight details (close circle)</span>
          </label>
          <div className="at__hint">{closeCircle ? "They'll see airline, flight number and times, and can add trips for you." : "They'll see your travel dates and cities only. You can change this later."}</div>
          <button className="at__primary" onClick={() => make("personal")} disabled={!!busy}>
            {busy === "personal" ? "Making a link…" : profile ? `Send ${profile.first} an invite` : "Send an invite"}
          </button>

          {!profile && (
            <div className="pp__link">
              <div className="pp__link-title">Your follow link</div>
              <p className="pp__intro">Share it anywhere. Anyone who uses it asks to follow you, and you approve each request on this page.</p>
              <button className="at__secondary pp__link-btn" onClick={() => make("link")} disabled={!!busy}>
                {busy === "link" ? "Getting your link…" : "Share my follow link"}
              </button>
            </div>
          )}

          {error && <div className="at__error">{error}</div>}
          {result && (
            <div className="at__parsed">
              <div className="at__parsed-mark">✓</div>
              <div>
                {result.outcome === "shared" && "Sent. "}
                {result.outcome === "copied" && "Link copied — paste it into a text or email. "}
                {(result.outcome === "show" || result.outcome === "cancelled") && "Here's the link to send: "}
                <input className="pp__url" readOnly value={result.url} onFocus={(e) => e.target.select()} />
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ── Requests ────────────────────────────────────────────────────────────────
function FollowRequests({ people, onChanged }) {
  const pending = people.filter((p) => p.followsMe === "pending");
  const [busyId, setBusyId] = React.useState(null);
  const [error, setError] = React.useState(null);
  if (!pending.length) return null;
  const respond = async (p, accept) => {
    setBusyId(p.id); setError(null);
    try { await callSocial({ action: "respond", followerId: p.id, accept }); onChanged(); }
    catch (err) { setError(String(err.message || err)); }
    finally { setBusyId(null); }
  };
  return (
    <section className="pp__requests">
      <div className="pp__requests-title">{pending.length === 1 ? "1 person wants to follow you" : `${pending.length} people want to follow you`}</div>
      {pending.map((p) => (
        <div key={p.id} className="pp__request">
          <Avatar person={p} size={36} />
          <div className="pp__request-name">{p.first} {p.last}<div className="pp__request-sub">Would see your travel dates and cities</div></div>
          <button className="at__secondary" onClick={() => respond(p, false)} disabled={busyId === p.id}>Decline</button>
          <button className="at__primary" onClick={() => respond(p, true)} disabled={busyId === p.id}>Accept</button>
        </div>
      ))}
      {error && <div className="at__error">{error}</div>}
    </section>
  );
}

// ── One person's connection controls, under their card ─────────────────────
function RelationControls({ p, onInvite, onChanged }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  if (p.isMe || p.isGuest) return <div className="pp__rel">{relationLabel(p)}</div>;
  const act = async (body) => {
    setBusy(true); setError(null);
    try { await callSocial(body); onChanged(); }
    catch (err) { setError(String(err.message || err)); }
    finally { setBusy(false); }
  };
  const connected = p.followsMe === "accepted" || p.iFollow === "accepted";
  return (
    <div className="pp__rel">
      <div>{relationLabel(p)}</div>
      <div className="pp__rel-actions">
        {connected && (
          <label className="pp__switch" title="Close circle: airline, flight number, times — and they can add trips for you">
            <input type="checkbox" checked={p.inMyCircle} disabled={busy}
                   onChange={(e) => act({ action: "set-circle", memberId: p.id, inCircle: e.target.checked })} />
            <span>Sees my flight details</span>
          </label>
        )}
        {!p.claimed && p.canManage && <button className="pp__btn" onClick={() => onInvite(p)}>Invite to Fly</button>}
        {p.claimed && !p.iFollow && <button className="pp__btn" disabled={busy} onClick={() => act({ action: "request-follow", profileId: p.id })}>Ask to follow</button>}
      </div>
      {error && <div className="at__error">{error}</div>}
    </div>
  );
}

Object.assign(window, { InviteModal, FollowRequests, RelationControls, relationLabel });
