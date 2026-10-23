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

// ── Sign-in: Google, an emailed code, or a password ────────────────────────
// Every path ends in the same Supabase account for the same email (Supabase
// links a Google sign-in to an existing account with that verified email),
// so someone can sign in by code today and by password or Google tomorrow
// without ending up with two accounts.
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Which optional sign-in methods the project has switched on — Google only
// shows once its credentials are configured in Supabase.
function useAuthProviders() {
  const [providers, setProviders] = React.useState({ google: false });
  React.useEffect(() => {
    const cfg = window.MG_SUPABASE;
    if (!cfg) return;
    fetch(`${cfg.url}/auth/v1/settings`, { headers: { apikey: cfg.key } })
      .then((r) => r.json())
      .then((s) => setProviders({ google: !!s?.external?.google }))
      .catch(() => {});
  }, []);
  return providers;
}

function friendlyAuthError(err) {
  const m = String(err?.message || err || "");
  if (/rate|limit|too many|security purposes/i.test(m)) return "Too many tries just now — wait a minute and try again.";
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. If you've only ever signed in with a code, use a code — then you can set a password on the People tab.";
  if (/expired|invalid.*(otp|token)|token.*(expired|invalid)/i.test(m)) return "That code didn't work — check it, or send a new one.";
  if (/password.*(short|least|characters)/i.test(m)) return "Passwords need at least 8 characters.";
  if (/smtp|sending|email.*(send|deliver)/i.test(m)) return "We couldn't send the email just now — try again in a minute.";
  return m || "Something went wrong — try again.";
}

function SignInScreen({ inviteToken }) {
  const providers = useAuthProviders();
  const [invite, setInvite] = React.useState(null);
  // email: pick a method · code: enter the emailed code · password: sign in
  // with one · signup: create an account with one · reset: new password via code
  const [step, setStep] = React.useState("email");
  const [codeType, setCodeType] = React.useState("email"); // what the emailed code verifies: email | signup | recovery
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [note, setNote] = React.useState(null);
  const auth = window.supabaseClient.auth;

  React.useEffect(() => {
    if (!inviteToken) return;
    callSocial({ action: "invite-info", token: inviteToken }).then(setInvite).catch(() => {});
  }, [inviteToken]);

  // Coming back from Google (or an emailed link) lands on this same page —
  // keep the invite in the address so it survives that round trip.
  const backUrl = () => {
    const back = new URL(location.origin + location.pathname);
    if (inviteToken) back.searchParams.set(INVITE_PARAM, inviteToken);
    return back.toString();
  };
  const go = (next) => { setStep(next); setError(null); setNote(null); setCode(""); };
  const run = async (fn) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (err) { setError(friendlyAuthError(err)); } finally { setBusy(false); }
  };
  const needEmail = () => {
    const addr = email.trim().toLowerCase();
    if (!EMAIL_RE.test(addr)) throw new Error("That doesn't look like an email address.");
    setEmail(addr);
    return addr;
  };

  const sendCode = () => run(async () => {
    const addr = needEmail();
    const { error: err } = await auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true, emailRedirectTo: backUrl() } });
    if (err) throw err;
    setCodeType("email"); go("code");
  });
  const signInWithPassword = () => run(async () => {
    const addr = needEmail();
    const { error: err } = await auth.signInWithPassword({ email: addr, password });
    if (err) throw err;
    // Success fires SIGNED_IN, which AuthGate picks up.
  });
  const signUp = () => run(async () => {
    const addr = needEmail();
    if (password.length < 8) throw new Error("Passwords need at least 8 characters.");
    const { data, error: err } = await auth.signUp({ email: addr, password, options: { emailRedirectTo: backUrl() } });
    if (err) throw err;
    if (data.session) return; // confirmation off: already signed in
    setCodeType("signup"); go("code");
    setNote("If this email already has an account, no code is coming — go back and use “Email me a code” instead, then set a password on the People tab.");
  });
  const sendReset = () => run(async () => {
    const addr = needEmail();
    const { error: err } = await auth.resetPasswordForEmail(addr, { redirectTo: backUrl() });
    if (err) throw err;
    setCodeType("recovery"); go("reset");
  });
  const verifyCode = () => run(async () => {
    const digits = code.replace(/\D/g, "");
    if (digits.length < 6) throw new Error("Enter the code from the email.");
    const { error: err } = await auth.verifyOtp({ email, token: digits, type: codeType });
    if (err) throw err;
  });
  const finishReset = () => run(async () => {
    const digits = code.replace(/\D/g, "");
    if (digits.length < 6) throw new Error("Enter the code from the email.");
    if (password.length < 8) throw new Error("Passwords need at least 8 characters.");
    const { error: err } = await auth.verifyOtp({ email, token: digits, type: "recovery" });
    if (err) throw err;
    const { error: upd } = await auth.updateUser({ password });
    if (upd) throw upd;
  });
  const google = () => run(async () => {
    const { error: err } = await auth.signInWithOAuth({ provider: "google", options: { redirectTo: backUrl() } });
    if (err) throw err;
  });

  const submit = (e) => {
    e.preventDefault();
    if (step === "email") sendCode();
    else if (step === "password") signInWithPassword();
    else if (step === "signup") signUp();
    else if (step === "code") verifyCode();
    else if (step === "reset") finishReset();
  };

  const who = invite?.valid && invite.inviter ? invite.inviter.first : null;
  const emailInput = (
    <input className="gate__input" type="email" inputMode="email" autoComplete="email" autoFocus={step === "email"}
           value={email} onChange={(e) => { setEmail(e.target.value); setError(null); }} placeholder="Your email" />
  );
  const passwordInput = (placeholder, autoComplete) => (
    <input className="gate__input" type="password" autoComplete={autoComplete} minLength={8}
           value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }} placeholder={placeholder} />
  );
  const codeInput = (
    <input className="gate__input auth__code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={8}
           value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} placeholder="123456" />
  );

  return (
    <div className="gate">
      <form className="gate__card auth__card" onSubmit={submit}>
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

        {step === "email" && (
          <>
            {providers.google && (
              <>
                <button type="button" className="auth__google" onClick={google} disabled={busy}>
                  <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/>
                    <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z"/>
                    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.8 6.1C6.6 42.6 14.6 48 24 48z"/>
                  </svg>
                  Continue with Google
                </button>
                <div className="auth__or"><span>or</span></div>
              </>
            )}
            {emailInput}
            <button className="gate__btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in code"}</button>
            <button type="button" className="auth__link" onClick={() => go("password")}>Use a password instead</button>
            <p className="auth__fine">No password needed — we'll email you a 6-digit code. You only do this once on each phone or computer.</p>
          </>
        )}

        {step === "password" && (
          <>
            {emailInput}
            {passwordInput("Password", "current-password")}
            <button className="gate__btn" type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
            <div className="auth__row">
              <button type="button" className="auth__link" onClick={sendReset} disabled={busy}>Forgot password?</button>
              <button type="button" className="auth__link" onClick={() => go("signup")}>Create an account</button>
            </div>
            <button type="button" className="auth__link" onClick={() => go("email")}>Email me a code instead</button>
          </>
        )}

        {step === "signup" && (
          <>
            <p className="auth__sent">Create a Fly account with a password. We'll email a code to confirm it's your address.</p>
            {emailInput}
            {passwordInput("Choose a password (8+ characters)", "new-password")}
            <button className="gate__btn" type="submit" disabled={busy}>{busy ? "Creating…" : "Create account"}</button>
            <button type="button" className="auth__link" onClick={() => go("password")}>I already have a password</button>
          </>
        )}

        {step === "code" && (
          <>
            <p className="auth__sent">We sent a code to <strong>{email}</strong>. Type it here:</p>
            {codeInput}
            <button className="gate__btn" type="submit" disabled={busy}>{busy ? "Checking…" : codeType === "signup" ? "Confirm and sign in" : "Sign in"}</button>
            {note && <p className="auth__fine">{note}</p>}
            <div className="auth__row">
              <button type="button" className="auth__link" onClick={() => go("email")}>Use a different email</button>
              {codeType === "email" && <button type="button" className="auth__link" onClick={sendCode} disabled={busy}>Send again</button>}
            </div>
          </>
        )}

        {step === "reset" && (
          <>
            <p className="auth__sent">We sent a code to <strong>{email}</strong>. Type it, then choose a new password:</p>
            {codeInput}
            {passwordInput("New password (8+ characters)", "new-password")}
            <button className="gate__btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Set password and sign in"}</button>
            <button type="button" className="auth__link" onClick={() => go("password")}>Back</button>
          </>
        )}

        {error && <div className="gate__error">{error}</div>}
      </form>
    </div>
  );
}

// ── Set or change a password, once signed in (People tab) ──────────────────
function PasswordModal({ open, onClose }) {
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [done, setDone] = React.useState(false);
  React.useEffect(() => { if (open) { setPw(""); setPw2(""); setError(null); setDone(false); setBusy(false); } }, [open]);
  const save = async (e) => {
    e.preventDefault();
    if (pw.length < 8) { setError("Passwords need at least 8 characters."); return; }
    if (pw !== pw2) { setError("Those two don't match."); return; }
    setBusy(true); setError(null);
    const { error: err } = await window.supabaseClient.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) { setError(friendlyAuthError(err)); return; }
    setDone(true);
  };
  return (
    <Modal open={open} onClose={onClose} size="md">
      <form className="at" onSubmit={save}>
        <header className="at__head"><h2 className="at__title">Set a password</h2></header>
        <div className="at__body">
          {done ? (
            <div className="at__parsed"><div className="at__parsed-mark">✓</div><div>Done. You can now sign in with your email and this password — codes and Google still work too.</div></div>
          ) : (
            <>
              <p className="pp__intro">Optional. Codes by email keep working either way.</p>
              <label className="at__field at__field--full"><span>New password</span>
                <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="8+ characters" autoFocus />
              </label>
              <label className="at__field at__field--full"><span>Type it again</span>
                <input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
              </label>
              {error && <div className="at__error">{error}</div>}
            </>
          )}
          <div className="at__actions">
            <button type="button" className="at__secondary" onClick={onClose}>{done ? "Close" : "Cancel"}</button>
            {!done && <button className="at__primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>}
          </div>
        </div>
      </form>
    </Modal>
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

Object.assign(window, { AuthGate, callSocial, PasswordModal });
