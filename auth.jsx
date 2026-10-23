// auth.jsx — sign-in for V2. Replaces the shared password (PasswordGate).
//
// Identity is a verified email: Supabase Auth sends a 6-digit code (or, until
// a custom email sender is connected, a sign-in link — the free plan's
// built-in sender can't use our code template). Once signed in, the session
// is remembered on that device indefinitely, so grandparents sign in once.
//
// After sign-in, social's `onboard` attaches the account to a profile: one
// set aside for this email, the one an invite was made for, or a new one
// named here. An invite link (?invite=TOKEN) is carried through sign-in —
// including the round trip through an emailed link — and used on onboarding.

const INVITE_PARAM = "invite";
const INVITE_STORE = "mg_pending_invite";

function readInviteToken() {
  const fromUrl = new URLSearchParams(location.search).get(INVITE_PARAM);
  if (fromUrl) {
    try { sessionStorage.setItem(INVITE_STORE, fromUrl); } catch (e) {}
    return fromUrl;
  }
  try { return sessionStorage.getItem(INVITE_STORE); } catch (e) { return null; }
}
function clearInviteToken() {
  try { sessionStorage.removeItem(INVITE_STORE); } catch (e) {}
  const url = new URL(location.href);
  if (url.searchParams.has(INVITE_PARAM)) {
    url.searchParams.delete(INVITE_PARAM);
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}

async function callSocial(body) {
  const { data, error } = await withTimeout(window.supabaseClient.functions.invoke("social", { body }), 20000, "Connecting");
  if (error || !data || !data.ok) throw new Error((data && data.error) || await readFunctionError(error) || "Something went wrong.");
  return data;
}

function TestBadge() {
  if (window.MG_BACKEND !== "test") return null;
  return <div className="auth__test" title="This page uses the Fly - Test database, not the family's real one.">TEST</div>;
}

// ── AuthGate ────────────────────────────────────────────────────────────────
function AuthGate({ children }) {
  const [phase, setPhase] = React.useState("checking"); // checking | signedOut | onboarding | needsName | ready
  const [inviteToken] = React.useState(readInviteToken);
  const [onboardInfo, setOnboardInfo] = React.useState(null);
  const [error, setError] = React.useState(null);
  const onboarding = React.useRef(false);
  // The account the current MG_ME belongs to. A session for any other
  // account means start over — never keep showing the previous person's
  // board or acting as them.
  const userRef = React.useRef(null);

  const onboard = React.useCallback(async (names) => {
    if (onboarding.current) return;
    onboarding.current = true;
    setError(null);
    try {
      const { data: s } = await window.supabaseClient.auth.getSession();
      const res = await callSocial({ action: "onboard", inviteToken: inviteToken || undefined, ...(names || {}) });
      if (res.needsName) { setOnboardInfo(res); setPhase("needsName"); return; }
      window.MG_ME = res.profileId;
      userRef.current = s.session?.user?.id ?? null;
      // Took over a profile someone else set up: show who has access (see
      // ClaimNotice in people.jsx).
      if (res.claimedVia === "invite" || res.claimedVia === "email") {
        try { sessionStorage.setItem("mg_claim_notice", "1"); } catch (e) {}
      }
      clearInviteToken();
      setOnboardInfo(res);
      setPhase("ready");
    } catch (err) {
      setError(String(err.message || err));
      setPhase((p) => (p === "needsName" ? p : "onboarding"));
    } finally {
      onboarding.current = false;
    }
  }, [inviteToken]);

  React.useEffect(() => {
    const auth = window.supabaseClient.auth;
    let alive = true;
    auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (data.session) { setPhase("onboarding"); onboard(); } else setPhase("signedOut");
    });
    // Any session arriving while not yet onboarded starts onboarding — a code
    // or an emailed link fires SIGNED_IN, but a restored or refreshed session
    // can arrive as TOKEN_REFRESHED / INITIAL_SESSION instead.
    const { data: sub } = auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        // Nothing of the previous person's people survives into the next sign-in.
        window.MG_ME = null;
        userRef.current = null;
        window.MGData.FAMILY.splice(0);
        setPhase("signedOut");
        return;
      }
      if (!session) return;
      if (window.MG_ME && userRef.current && session.user.id !== userRef.current) {
        // A different account arrived without a sign-out in between: unmount
        // the board (phase leaves "ready") and onboard as the new person.
        window.MG_ME = null;
        userRef.current = null;
        window.MGData.FAMILY.splice(0);
        setPhase("onboarding");
        onboard();
        return;
      }
      if (!window.MG_ME) { setPhase((p) => (p === "ready" || p === "needsName" ? p : "onboarding")); onboard(); }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [onboard]);

  if (phase === "ready") return <>{children}<TestBadge /></>;
  if (phase === "signedOut") return <><SignInScreen inviteToken={inviteToken} /><TestBadge /></>;
  if (phase === "needsName") {
    return <><NameScreen invite={onboardInfo?.invite} error={error} onSubmit={(first, last) => onboard({ firstName: first, lastName: last })} /><TestBadge /></>;
  }
  return (
    <div className="gate">
      <div className="gate__card">
        <BrandMark />
        {error
          ? <>
              <p className="gate__sub">{error}</p>
              <button className="gate__btn" onClick={() => onboard()}>Try again</button>
              <button className="auth__link" onClick={() => window.supabaseClient.auth.signOut()}>Sign out</button>
            </>
          : <p className="gate__sub"><span className="at__spinner" aria-hidden="true" /> Signing you in…</p>}
      </div>
      <TestBadge />
    </div>
  );
}

// ── Sign-in: email, then the code ──────────────────────────────────────────
function SignInScreen({ inviteToken }) {
  const [invite, setInvite] = React.useState(null);
  const [email, setEmail] = React.useState("");
  const [step, setStep] = React.useState("email"); // email | code
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    if (!inviteToken) return;
    callSocial({ action: "invite-info", token: inviteToken }).then(setInvite).catch(() => {});
  }, [inviteToken]);

  const sendCode = async (e) => {
    e && e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) { setError("That doesn't look like an email address."); return; }
    setBusy(true); setError(null);
    // Coming back from an emailed link lands on this same page — keep the
    // invite in the address so it survives that round trip.
    const back = new URL(location.origin + location.pathname);
    if (inviteToken) back.searchParams.set(INVITE_PARAM, inviteToken);
    const { error: err } = await window.supabaseClient.auth.signInWithOtp({
      email: addr, options: { shouldCreateUser: true, emailRedirectTo: back.toString() },
    });
    setBusy(false);
    if (err) {
      setError(/rate|limit|too many/i.test(err.message)
        ? "Too many sign-in emails just now — wait a few minutes and try again."
        : err.message);
      return;
    }
    setEmail(addr);
    setStep("code");
  };

  const verify = async (e) => {
    e && e.preventDefault();
    const digits = code.replace(/\D/g, "");
    if (digits.length < 6) { setError("Enter the code from the email."); return; }
    setBusy(true); setError(null);
    const { error: err } = await window.supabaseClient.auth.verifyOtp({ email, token: digits, type: "email" });
    setBusy(false);
    if (err) setError(/expired|invalid/i.test(err.message) ? "That code didn't work — check it, or send a new one." : err.message);
    // Success fires SIGNED_IN, which AuthGate picks up.
  };

  const who = invite?.valid && invite.inviter ? invite.inviter.first : null;
  return (
    <div className="gate">
      <form className="gate__card auth__card" onSubmit={step === "email" ? sendCode : verify}>
        <BrandMark />
        {who ? (
          <>
            <h1 className="gate__title">{who} invited you to Fly</h1>
            <p className="gate__sub">
              {invite.profile
                ? `Sign in to see ${invite.profile.first}'s travel — and everyone else's — in one place.`
                : invite.kind === "link"
                  ? `Sign in to follow ${who}'s travels. ${who} will approve your request.`
                  : `Sign in to see where ${who} and the family are headed.`}
            </p>
          </>
        ) : (
          <>
            <h1 className="gate__title">Fly</h1>
            <p className="gate__sub">{invite && !invite.valid ? invite.reason : "Where your people are going to be."}</p>
          </>
        )}

        {step === "email" ? (
          <>
            <input className="gate__input" type="email" inputMode="email" autoComplete="email" autoFocus
                   value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="Your email" />
            {error && <div className="gate__error">{error}</div>}
            <button className="gate__btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in code"}</button>
            <p className="auth__fine">No password. We'll email you a code (or a link) — you only need to do this once on each phone or computer.</p>
          </>
        ) : (
          <>
            <p className="auth__sent">Sent to <strong>{email}</strong>. Tap the link in that email, or type the code here:</p>
            <input className="gate__input auth__code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={8}
                   value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} placeholder="123456" />
            {error && <div className="gate__error">{error}</div>}
            <button className="gate__btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Sign in"}</button>
            <div className="auth__row">
              <button type="button" className="auth__link" onClick={() => { setStep("email"); setCode(""); setError(null); }}>Use a different email</button>
              <button type="button" className="auth__link" onClick={() => sendCode()} disabled={busy}>Send again</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// ── First sign-in for someone nobody set up a profile for ──────────────────
function NameScreen({ invite, error, onSubmit }) {
  const [first, setFirst] = React.useState("");
  const [last, setLast] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { if (error) setBusy(false); }, [error]);
  return (
    <div className="gate">
      <form className="gate__card auth__card" onSubmit={(e) => { e.preventDefault(); if (first.trim() && last.trim()) { setBusy(true); onSubmit(first.trim(), last.trim()); } }}>
        <BrandMark />
        <h1 className="gate__title">Welcome to Fly</h1>
        <p className="gate__sub">{invite?.inviter ? `${invite.inviter} will see you by this name.` : "How should your people see you?"}</p>
        <div className="auth__names">
          <input className="gate__input" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="First name" autoComplete="given-name" autoFocus />
          <input className="gate__input" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Last name" autoComplete="family-name" />
        </div>
        {error && <div className="gate__error">{error}</div>}
        <button className="gate__btn" type="submit" disabled={busy || !first.trim() || !last.trim()}>{busy ? "Setting up…" : "Continue"}</button>
        <button type="button" className="auth__link" onClick={() => window.supabaseClient.auth.signOut()}>Not you? Sign out</button>
      </form>
    </div>
  );
}

Object.assign(window, { AuthGate, callSocial });
