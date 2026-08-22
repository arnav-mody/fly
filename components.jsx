// components.jsx — atomic UI for the Mody-Gandhi Travel Tracker.
// Avatars, status pills, countdown timers, flight cards. Bigger composed views
// (board, modals) live in app.jsx + modals.jsx.

// data.js declared FAMILY, FLIGHTS, AIRLINES, AIRPORTS, flightStatus,
// familyById, airline, airport, NOW at the global scope already — Babel
// scripts share lex scope, so re-destructuring here would be a redeclaration
// error. Just reference them by bare name.

// ── time helpers ────────────────────────────────────────────────────────────
function pad2(n) { return String(n).padStart(2, "0"); }
function fmtTime(d) {
  // 24h time HH:MM for the boarding-pass aesthetic
  return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
}
function fmtDateShort(d) {
  return d.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
function fmtDateLong(d) {
  return d.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
function fmtDuration(ms) {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${pad2(m)}m`;
}

// ── useNow ──────────────────────────────────────────────────────────────────
// A "live" now that ticks once a second, tracking real wall-clock time — used
// to judge every real flight's status/countdown against today, not a fixed
// prototype date.
function useNow() {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ── Avatar ──────────────────────────────────────────────────────────────────
// Real photo when one's been uploaded (see TravelersView's upload control,
// which stores it at a deterministic `${person.id}.jpg` path in the public
// `family-photos` bucket — no explicit URL to manage, we just try it and
// fall back to a monogram + per-person hue if nothing's there yet).
// `person.photo` is an escape hatch to point at some other hosted URL instead.
function Avatar({ person, size = 40, ring = false }) {
  const [photoFailed, setPhotoFailed] = React.useState(false);
  if (!person) return null;
  const initials = (person.first[0] + person.last[0]).toUpperCase();
  const hue = (35 + (person.tone - 1) * 31) % 360;
  const bg  = `oklch(78% 0.06 ${hue})`;
  const fg  = `oklch(28% 0.07 ${hue})`;
  const photoUrl = person.photo || (window.supabaseClient
    ? window.supabaseClient.storage.from("family-photos").getPublicUrl(`${person.id}.jpg`).data.publicUrl
    : null);
  const showPhoto = photoUrl && !photoFailed;
  return (
    <div className="avatar" data-ring={ring ? "1" : "0"}
         style={{
           width: size, height: size,
           background: showPhoto ? undefined : bg, color: fg,
           fontSize: size * 0.4,
         }}
         title={person.first + " " + person.last}>
      {showPhoto
        ? <img src={photoUrl} alt="" width={size} height={size} onError={() => setPhotoFailed(true)} />
        : <span>{initials}</span>}
    </div>
  );
}

// AvatarStack — overlapping avatars for multi-traveler flights.
function AvatarStack({ ids, size = 32 }) {
  return (
    <div className="avatar-stack" style={{ "--av-size": `${size}px` }}>
      {ids.map((id) => {
        const p = familyById(id);
        return p ? <Avatar key={id} person={p} size={size} /> : null;
      })}
    </div>
  );
}

// ── StatusPill ──────────────────────────────────────────────────────────────
function StatusPill({ status, mode = "flight" }) {
  const labels = {
    airborne:  { txt: mode === "flight" ? "In the air" : "Traveling", cls: "pill--air" },
    boarding:  { txt: "Taking off soon",  cls: "pill--soon" },
    scheduled: { txt: "Upcoming",         cls: "pill--up" },
    landed:    { txt: mode === "flight" ? "Landed" : "Arrived", cls: "pill--landed" },
    past:      { txt: "Past trip",        cls: "pill--past" },
  };
  const l = labels[status] ?? labels.scheduled;
  return (
    <span className={`pill ${l.cls}`}>
      <span className="pill__dot" />
      {l.txt}
    </span>
  );
}

// ── Countdown ───────────────────────────────────────────────────────────────
// Big editorial countdown used in the hero and the imminent-departure cards.
function Countdown({ target, label, dramatic = false, now }) {
  const diff = target.getTime() - now.getTime();
  const negative = diff < 0;
  const abs = Math.abs(diff);
  const totalSec = Math.floor(abs / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const showDays = d > 0;
  const showSec  = d === 0 && h < 6; // only show seconds when it's close
  return (
    <div className={`countdown ${dramatic ? "countdown--big" : ""}`}>
      {label && <div className="countdown__label">{label}</div>}
      <div className="countdown__digits">
        {showDays && (
          <>
            <CDUnit n={d} u="d" />
            <CDSep />
          </>
        )}
        <CDUnit n={h} u="h" />
        <CDSep />
        <CDUnit n={m} u="m" />
        {showSec && (
          <>
            <CDSep />
            <CDUnit n={s} u="s" />
          </>
        )}
      </div>
      {negative && <div className="countdown__neg">already departed</div>}
    </div>
  );
}
// Each digit gets its own React key that includes its value, so when a digit
// changes, React remounts just that tile — replaying the .cd-flap CSS
// animation for a split-flap-board tick, with no JS timers involved.
function CDUnit({ n, u }) {
  const digits = pad2(n).split("");
  return (
    <span className="cd-unit">
      <span className="cd-num">
        {digits.map((ch, i) => <span key={i + ch} className="cd-flap">{ch}</span>)}
      </span>
      <span className="cd-u">{u}</span>
    </span>
  );
}
function CDSep() {
  return <span className="cd-sep" aria-hidden="true">·</span>;
}

// ── Progress bar (in-flight) ────────────────────────────────────────────────
function FlightProgress({ flight, now }) {
  const dep = flight.depart.getTime();
  const arr = flight.arrive.getTime();
  const total = arr - dep;
  const elapsed = now.getTime() - dep;
  const t = Math.max(0, Math.min(1, elapsed / total));
  return (
    <div className="fprog">
      <div className="fprog__rail">
        <div className="fprog__fill" style={{ width: `${t * 100}%` }} />
        <span className="fprog__plane" style={{ left: `${t * 100}%` }}>✈</span>
      </div>
      <div className="fprog__times">
        <span>{flight.from} · {fmtTime(flight.depart)}</span>
        <span className="fprog__remain">
          {fmtDuration(arr - now.getTime())} to landing
        </span>
        <span>{fmtTime(flight.arrive)} · {flight.to}</span>
      </div>
    </div>
  );
}

// ── BoardingPassStrip ───────────────────────────────────────────────────────
// The technical-detail row that appears on flight cards — flight #, time,
// gate, seat — set in monospace so it reads like a real boarding pass.
function BoardingPassStrip({ flight, dense = false }) {
  const mode = modeOf(flight);
  const al = airline(flight.airline);
  const from = airport(flight.from);
  const to   = airport(flight.to);
  const dur  = fmtDuration(flight.arrive - flight.depart);
  return (
    <div className={`bp-strip ${dense ? "bp-strip--dense" : ""}`}>
      <div className="bp-strip__col">
        <div className="bp-strip__lbl">{mode === "flight" ? "Flight" : modeMeta(flight).label}</div>
        <div className="bp-strip__val">
          {mode === "flight"
            ? <><span className="bp-airline" style={{ ["--ac"]: al.color }}>{flight.airline}</span>{flight.number}</>
            : <span aria-hidden="true">{modeMeta(flight).icon}</span>}
        </div>
      </div>
      <div className="bp-strip__col">
        <div className="bp-strip__lbl">Depart {from.tz}</div>
        <div className="bp-strip__val">{fmtTime(flight.depart)}</div>
      </div>
      <div className="bp-strip__col">
        <div className="bp-strip__lbl">Arrive {to.tz}</div>
        <div className="bp-strip__val">{fmtTime(flight.arrive)}</div>
      </div>
      <div className="bp-strip__col">
        <div className="bp-strip__lbl">Duration</div>
        <div className="bp-strip__val">{dur}</div>
      </div>
      {flight.seat && !dense && (
        <div className="bp-strip__col">
          <div className="bp-strip__lbl">Seat</div>
          <div className="bp-strip__val">{flight.seat}</div>
        </div>
      )}
    </div>
  );
}

// ── FlightCard ──────────────────────────────────────────────────────────────
// The everyday card — appears in "Taking off soon", "This week", "Just landed"
// rails. Click → opens the flight detail modal.
function FlightCard({ flight, onOpen, now, accent }) {
  const status = flightStatus(flight, now);
  const mode = modeOf(flight);
  const isFlight = mode === "flight";
  const from = { ...airport(flight.from), code: flight.from };
  const to   = { ...airport(flight.to),   code: flight.to };
  const travelers = flight.travelers.map(familyById).filter(Boolean);

  // Lead text varies by status — Grandpa cares about the moment of takeoff
  // and the moment of landing more than the abstract route.
  let lead;
  if (status === "boarding") {
    const diff = flight.depart - now;
    lead = (
      <>
        <span className="card__lead-name">{travelers[0]?.first}</span>
        <span className="card__lead-verb"> takes off in </span>
        <span className="card__lead-time">{fmtDuration(diff)}</span>
      </>
    );
  } else if (status === "airborne") {
    lead = (
      <>
        <span className="card__lead-name">{travelers[0]?.first}</span>
        <span className="card__lead-verb">{isFlight ? " is in the air" : " is traveling"}</span>
      </>
    );
  } else if (status === "landed") {
    const diff = now - flight.arrive;
    lead = (
      <>
        <span className="card__lead-name">{travelers[0]?.first}</span>
        <span className="card__lead-verb">{isFlight ? " landed " : " arrived "}</span>
        <span className="card__lead-time">{fmtDuration(diff)} ago</span>
      </>
    );
  } else {
    // scheduled / upcoming
    const diff = flight.depart - now;
    const days = Math.floor(diff / 86400000);
    lead = (
      <>
        <span className="card__lead-name">{travelers[0]?.first}</span>
        <span className="card__lead-verb"> flies in </span>
        <span className="card__lead-time">{days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"}`}</span>
      </>
    );
  }

  return (
    <article className={`card card--${status}`} onClick={() => onOpen(flight)} data-comment-anchor={`card-${flight.id}`}>
      <div className="card__top">
        <AvatarStack ids={flight.travelers} size={32} />
        <StatusPill status={status} mode={mode} />
      </div>
      <div className="card__lead">{lead}</div>
      <div className="card__cities">
        <span className="card__city">
          <span className="card__city-code">{isFlight ? flight.from : ""}</span>
          <span className="card__city-name">{from.city}</span>
        </span>
        {isFlight ? (
          <RouteRibbon
            from={from} to={to}
            progress={flight.progress ?? 0}
            status={status}
          />
        ) : (
          <span className="mode-connector" aria-hidden="true">{modeMeta(flight).icon}</span>
        )}
        <span className="card__city">
          <span className="card__city-code">{isFlight ? flight.to : ""}</span>
          <span className="card__city-name">{to.city}</span>
        </span>
      </div>
      <BoardingPassStrip flight={flight} dense />
      {flight.note && travelers.length === 1 && (
        <div className="card__note">"{flight.note.length > 80 ? flight.note.slice(0, 80) + "…" : flight.note}"</div>
      )}
      {isFlight && (
        <a
          className="fa-link card__fa"
          href={flightAwareUrl(flight)}
          target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          Track on FlightAware <span className="fa-link__arrow">↗</span>
        </a>
      )}
    </article>
  );
}

// ── Section header ──────────────────────────────────────────────────────────
function SectionHead({ kicker, title, sub, count }) {
  return (
    <div className="sect-head">
      <div className="sect-head__kicker">{kicker}</div>
      <h2 className="sect-head__title">
        {title}
        {count != null && <span className="sect-head__count">{count}</span>}
      </h2>
      {sub && <div className="sect-head__sub">{sub}</div>}
    </div>
  );
}

// ── Pull-quote / empty state ────────────────────────────────────────────────
function EmptyRow({ text }) {
  return <div className="empty-row">{text}</div>;
}

Object.assign(window, {
  fmtTime, fmtDateShort, fmtDateLong, fmtDuration, pad2,
  useNow, Avatar, AvatarStack, StatusPill, Countdown,
  FlightProgress, BoardingPassStrip, FlightCard, SectionHead, EmptyRow,
});
