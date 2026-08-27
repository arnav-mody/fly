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
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
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
function StatusPill({ status, mode = "flight", label }) {
  const labels = {
    airborne:  { txt: mode === "flight" ? "In the air" : "Traveling", cls: "pill--air" },
    boarding:  { txt: "Taking off soon",  cls: "pill--soon" },
    scheduled: { txt: "Upcoming",         cls: "pill--up" },
    landed:    { txt: mode === "flight" ? "Landed" : "Arrived", cls: "pill--landed" },
    layover:   { txt: "On a layover",     cls: "pill--soon" },
    past:      { txt: "Past trip",        cls: "pill--past" },
  };
  const l = labels[status] ?? labels.scheduled;
  return (
    <span className={`pill ${l.cls}`}>
      <span className="pill__dot" />
      {label || l.txt}
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
  // Real UTC instants for the progress math (see flightRealDepart in
  // data.js) — the displayed labels below still read flight.depart/arrive
  // directly, which is deliberately the airport-local wall clock.
  const dep = flightRealDepart(flight).getTime();
  const arr = flightRealArrive(flight).getTime();
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
        <span>{airport(flight.from).city} · {fmtTime(flight.depart)}</span>
        <span className="fprog__remain">
          {fmtDuration(arr - now.getTime())} to landing
        </span>
        <span>{fmtTime(flight.arrive)} · {airport(flight.to).city}</span>
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
  // Real instants, not the naive stored digits — a route that crosses
  // timezones (almost all of them) would otherwise show a duration that's
  // off by the difference between the two airports' UTC offsets.
  const dur  = fmtDuration(flightRealArrive(flight) - flightRealDepart(flight));
  // Viewer's own local time, shown as a small second line under each — the
  // airport's own time stays primary since that's what's on the ticket.
  // Only appears when we actually know both zones and they're different
  // (see viewerTime in data.js) — silently absent otherwise, never a guess.
  // Kept short ("10:14 AM EST", not "...your time") specifically so it fits
  // in the compact card grid without truncating.
  const vDepart = window.MGData.viewerTime(flight.depart, from);
  const vArrive = window.MGData.viewerTime(flight.arrive, to);
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
        {vDepart && <div className="bp-strip__sub">{vDepart.time} {vDepart.tzAbbrev}{vDepart.dayShift !== 0 && <span className="bp-strip__dayshift">{vDepart.dayShift > 0 ? " +1d" : " −1d"}</span>}</div>}
      </div>
      <div className="bp-strip__col">
        <div className="bp-strip__lbl">Arrive {to.tz}</div>
        <div className="bp-strip__val">{fmtTime(flight.arrive)}</div>
        {vArrive && <div className="bp-strip__sub">{vArrive.time} {vArrive.tzAbbrev}{vArrive.dayShift !== 0 && <span className="bp-strip__dayshift">{vArrive.dayShift > 0 ? " +1d" : " −1d"}</span>}</div>}
      </div>
      <div className="bp-strip__col">
        <div className="bp-strip__lbl">Duration</div>
        <div className="bp-strip__val">{dur}</div>
      </div>
    </div>
  );
}

// ── card lead text ──────────────────────────────────────────────────────────
// Shared by FlightCard and JourneyCard so a connecting-flight journey reads
// exactly like a nonstop flight at every status — Grandpa cares about the
// moment of takeoff and the moment of landing more than the abstract route,
// and that shouldn't change just because there's a stop in the middle.
// "layover" has no nonstop equivalent (it only ever applies to a journey
// mid-connection) but follows the same name+verb+detail phrasing as the rest.
// `depart`/`arrive` are the naive, airport-local values (only used for the
// scheduled-date display, which is deliberately local-calendar); any math
// against `now` uses `departReal`/`arriveReal` (see flightRealDepart in
// data.js) so it reflects the actual elapsed/remaining time, not a value
// skewed by the airport's UTC offset. `travelers` is the full list — the
// headline names everyone aboard ("Nihar & Roopal"), not just the first
// person, and conjugates is/are, takes/take, flies/fly to match.
function cardLead({ status, isFlight, travelers, now, depart, arrive, departReal, arriveReal, layoverCity }) {
  const dep = departReal ?? depart, arr = arriveReal ?? arrive;
  const name = travelers.map((p) => p.first).join(" & ");
  const plural = travelers.length > 1;
  if (status === "boarding") {
    return (
      <>
        <span className="card__lead-name">{name}</span>
        <span className="card__lead-verb">{plural ? " take off in " : " takes off in "}</span>
        <span className="card__lead-time">{fmtDuration(dep - now)}</span>
      </>
    );
  }
  if (status === "airborne") {
    return (
      <>
        <span className="card__lead-name">{name}</span>
        <span className="card__lead-verb">
          {isFlight ? (plural ? " are in the air" : " is in the air") : (plural ? " are traveling" : " is traveling")}
        </span>
      </>
    );
  }
  if (status === "layover") {
    return (
      <>
        <span className="card__lead-name">{name}</span>
        <span className="card__lead-verb">{plural ? " are on a layover in " : " is on a layover in "}</span>
        <span className="card__lead-time">{layoverCity}</span>
      </>
    );
  }
  if (status === "landed") {
    return (
      <>
        <span className="card__lead-name">{name}</span>
        <span className="card__lead-verb">{isFlight ? " landed " : " arrived "}</span>
        <span className="card__lead-time">{fmtDuration(now - arr)} ago</span>
      </>
    );
  }
  // scheduled / upcoming — the actual date, not a relative countdown; the
  // countdown lives in the status pill instead (see pillLabel below) so it
  // doesn't have to fight the headline for space.
  return (
    <>
      <span className="card__lead-name">{name}</span>
      <span className="card__lead-verb">
        {isFlight ? (plural ? " fly on " : " flies on ") : (plural ? " leave on " : " leaves on ")}
      </span>
      <span className="card__lead-time">{fmtDateShort(depart)}</span>
    </>
  );
}

// A close departure is worth calling out in the status pill up top ("3 days
// to go") instead of the generic "Upcoming" — anything a week or further out
// just isn't as time-sensitive. Shared so a journey's pill reads the same way.
// `depart` should be the real instant (see cardLead above).
function scheduledPillLabel(status, depart, now) {
  if (status !== "scheduled") return undefined;
  const days = Math.floor((depart - now) / 86400000);
  if (days >= 7) return undefined;
  return days <= 0 ? "Today" : `${days} day${days === 1 ? "" : "s"} to go`;
}

// ── FlightCard ──────────────────────────────────────────────────────────────
// The everyday card — appears in "Taking off soon", "This week", "Just landed"
// rails. Click → opens the flight detail modal.
function FlightCard({ flight, onOpen, now, accent, allFlights, onAddReturn, onLinkConnection, onDismissReturn }) {
  const status = flightStatus(flight, now);
  const mode = modeOf(flight);
  const isFlight = mode === "flight";
  const from = { ...airport(flight.from), code: flight.from };
  const to   = { ...airport(flight.to),   code: flight.to };
  const travelers = flight.travelers.map(familyById).filter(Boolean);
  // Worth flagging at any stage of the trip, not just after landing — and
  // never when everyone aboard is simply arriving home (see isHomeArrival)
  // or when someone's already said this one doesn't need a return logged.
  const noReturn = allFlights && !flight.returnDismissed && !hasLoggedReturn(flight, allFlights) && !window.MGData.isHomeArrival(flight);
  // Two boarding passes logged separately that plausibly connect — offer to
  // link them into one journey card (the retroactive counterpart to ticking
  // "this is a connecting flight" during upload). Never offered once a
  // flight's already part of a journey.
  const connection = allFlights && onLinkConnection && !flight.journeyId
    ? window.MGData.findConnectionCandidate(flight, allFlights) : null;
  const connectionIsOnward = connection && window.MGData.isConnectionCandidate(flight, connection);

  const pillLabel = scheduledPillLabel(status, flightRealDepart(flight), now);
  // Airborne is the one status where FlightProgress already shows the route,
  // both cities, and both times in one bar — the ordinary cities-row ribbon
  // + boarding-pass strip right under it would just repeat all of that.
  const showProgress = status === "airborne" && isFlight;
  const arriveViewerTime = showProgress ? window.MGData.viewerTime(flight.arrive, to) : null;
  // FlightAware's per-number page shows whichever instance of that number
  // is currently live/most recent — for a flight booked far ahead, that's
  // a different day's flight, not this one. Only link once it's close
  // enough to actually be this flight, and only when we have a real
  // FlightAware URL for it (flightAwareUrl returns null for airlines
  // without a confirmed ICAO code, which the link needs to resolve at all).
  const faUrl = isFlight && flightRealDepart(flight) - now <= hours(48) ? flightAwareUrl(flight) : null;

  return (
    <article className={`card card--${status}`} onClick={() => onOpen(flight)} data-comment-anchor={`card-${flight.id}`}>
      <div className="card__top">
        <AvatarStack ids={flight.travelers} size={32} />
        <StatusPill status={status} mode={mode} label={pillLabel} />
      </div>
      <div className="card__lead">
        {cardLead({
          status, isFlight, travelers, now,
          depart: flight.depart, arrive: flight.arrive,
          departReal: flightRealDepart(flight), arriveReal: flightRealArrive(flight),
        })}
      </div>
      {showProgress ? (
        <>
          <FlightProgress flight={flight} now={now} />
          {arriveViewerTime && <div className="fprog__viewer">({arriveViewerTime.time} {arriveViewerTime.tzAbbrev})</div>}
        </>
      ) : (
        <>
          <div className="card__cities">
            <span className="card__city">
              <span className="card__city-code">{isFlight ? flight.from : ""}</span>
              <span className="card__city-name">{from.city}</span>
            </span>
            {isFlight ? (
              <RouteRibbon
                from={from} to={to}
                progress={flightProgress(flight, now)}
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
        </>
      )}
      {flight.note && travelers.length === 1 && (
        <div className="card__note">"{flight.note.length > 80 ? flight.note.slice(0, 80) + "…" : flight.note}"</div>
      )}
      {noReturn && (
        <div className="card__no-return-row">
          <button className="card__no-return" onClick={(e) => { e.stopPropagation(); onAddReturn(flight); }}>
            Return not logged — click to add
          </button>
          <button className="card__dismiss" onClick={(e) => { e.stopPropagation(); onDismissReturn(flight); }} title="Not expecting a return leg for this trip">
            Dismiss
          </button>
        </div>
      )}
      {connection && (
        <button className="card__no-return" onClick={(e) => { e.stopPropagation(); onLinkConnection(flight, connection); }}>
          {connectionIsOnward
            ? `Connects to ${airport(connection.to).city} — link as one trip?`
            : `Connects from ${airport(connection.from).city} — link as one trip?`}
        </button>
      )}
      {faUrl && (
        <a
          className="fa-link card__fa"
          href={faUrl}
          target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          Track on FlightAware <span className="fa-link__arrow">↗</span>
        </a>
      )}
    </article>
  );
}

// ── JourneyCard ─────────────────────────────────────────────────────────────
// A connecting-flight journey — two or more linked legs — reads exactly like
// a nonstop FlightCard (see cardLead above): same headline phrasing, same
// boarding-pass strip, same note/FA-link placement. The one intentional
// difference is the stopover: the route line shows a waypoint dot positioned
// by how long the layover actually is, captioned with the city name, and
// "layover" is a real status distinct from "landed"/"airborne" since neither
// of those is true while they're sitting in the connecting airport.
function JourneyCard({ item, onOpen, now }) {
  const legs = item.legs;
  const status = journeyStatus(legs, now);
  const first = legs[0], last = legs[legs.length - 1];
  const mode = modeOf(first);
  const isFlight = mode === "flight";
  const from = { ...airport(first.from), code: first.from };
  const to   = { ...airport(last.to),   code: last.to };
  const travelers = first.travelers.map(familyById).filter(Boolean);

  const layoverIdx = legs.findIndex((l, i) => i < legs.length - 1 && now >= flightRealArrive(l) && now < flightRealDepart(legs[i + 1]));
  const layoverCity = layoverIdx >= 0 ? airport(legs[layoverIdx].to).city : null;
  const airborneLeg = legs.find((l) => flightStatus(l, now) === "airborne");
  const faLeg = airborneLeg || first;
  const faUrl = isFlight && flightRealDepart(faLeg) - now <= hours(48) ? flightAwareUrl(faLeg) : null;

  const pillLabel = scheduledPillLabel(status, flightRealDepart(first), now);
  const journeyFlight = { ...item.summary, id: item.id, legs, journeyId: item.id };
  const stripFlight = { mode, airline: item.summary.airline, number: item.summary.number, from: first.from, to: last.to, depart: first.depart, arrive: last.arrive };
  // Same reasoning as FlightCard — FlightProgress already shows the current
  // leg's route, cities, and times in one bar, so skip the otherwise-
  // duplicate ribbon + boarding-pass strip while a leg is actually airborne.
  const showProgress = status === "airborne" && isFlight && airborneLeg;
  const airborneLegTo = showProgress ? airport(airborneLeg.to) : null;
  const arriveViewerTime = showProgress ? window.MGData.viewerTime(airborneLeg.arrive, airborneLegTo) : null;

  return (
    <article className={`card card--${status === "layover" ? "boarding" : status}`} onClick={() => onOpen(journeyFlight)}>
      <div className="card__top">
        <AvatarStack ids={first.travelers} size={32} />
        <StatusPill status={status} mode={mode} label={pillLabel} />
      </div>
      <div className="card__lead">
        {cardLead({
          status, isFlight, travelers, now,
          depart: first.depart, arrive: last.arrive,
          departReal: flightRealDepart(first), arriveReal: flightRealArrive(last),
          layoverCity,
        })}
      </div>
      {showProgress ? (
        <>
          <FlightProgress flight={airborneLeg} now={now} />
          {arriveViewerTime && <div className="fprog__viewer">({arriveViewerTime.time} {arriveViewerTime.tzAbbrev})</div>}
        </>
      ) : (
        <>
          <div className="card__cities">
            <span className="card__city">
              <span className="card__city-code">{isFlight ? first.from : ""}</span>
              <span className="card__city-name">{from.city}</span>
            </span>
            {isFlight ? (
              <MultiRouteRibbon legs={legs} status={status} now={now} />
            ) : (
              <span className="mode-connector" aria-hidden="true">{modeMeta(first).icon}</span>
            )}
            <span className="card__city">
              <span className="card__city-code">{isFlight ? last.to : ""}</span>
              <span className="card__city-name">{to.city}</span>
            </span>
          </div>
          <div className="card__via">Stopover in {legs.slice(0, -1).map((l) => airport(l.to).city).join(", ")}</div>
          <BoardingPassStrip flight={stripFlight} dense />
        </>
      )}
      {item.summary.note && travelers.length === 1 && (
        <div className="card__note">"{item.summary.note.length > 80 ? item.summary.note.slice(0, 80) + "…" : item.summary.note}"</div>
      )}
      {faUrl && (
        <a
          className="fa-link card__fa"
          href={faUrl}
          target="_blank" rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          Track on FlightAware <span className="fa-link__arrow">↗</span>
        </a>
      )}
    </article>
  );
}

// ── RoundTripCard ───────────────────────────────────────────────────────────
// An outbound flight and its already-logged return, shown as one card while
// neither has happened yet (see pairRoundTrips, data.js) — the outbound gets
// the normal full card treatment, and a compact return line sits below it
// instead of that same trip appearing as a second, separate card further
// down the board. The moment the outbound actually departs, pairRoundTrips
// stops pairing them and the return goes back to being its own ordinary
// card — this component only ever renders both still-upcoming.
function RoundTripCard({ item, onOpen, now }) {
  const { outbound, returnLeg } = item;
  const status = flightStatus(outbound, now); // scheduled or boarding, by construction
  const mode = modeOf(outbound);
  const isFlight = mode === "flight";
  const from = { ...airport(outbound.from), code: outbound.from };
  const to   = { ...airport(outbound.to),   code: outbound.to };
  const travelers = outbound.travelers.map(familyById).filter(Boolean);
  const pillLabel = scheduledPillLabel(status, flightRealDepart(outbound), now);
  const faUrl = isFlight && flightRealDepart(outbound) - now <= hours(48) ? flightAwareUrl(outbound) : null;

  return (
    <article className={`card card--${status}`} onClick={() => onOpen(outbound)}>
      <div className="card__top">
        <AvatarStack ids={outbound.travelers} size={32} />
        <StatusPill status={status} mode={mode} label={pillLabel} />
      </div>
      <div className="card__lead">
        {cardLead({
          status, isFlight, travelers, now,
          depart: outbound.depart, arrive: outbound.arrive,
          departReal: flightRealDepart(outbound), arriveReal: flightRealArrive(outbound),
        })}
      </div>
      <div className="card__cities">
        <span className="card__city">
          <span className="card__city-code">{isFlight ? outbound.from : ""}</span>
          <span className="card__city-name">{from.city}</span>
        </span>
        {isFlight ? (
          <RouteRibbon from={from} to={to} progress={flightProgress(outbound, now)} status={status} />
        ) : (
          <span className="mode-connector" aria-hidden="true">{modeMeta(outbound).icon}</span>
        )}
        <span className="card__city">
          <span className="card__city-code">{isFlight ? outbound.to : ""}</span>
          <span className="card__city-name">{to.city}</span>
        </span>
      </div>
      <BoardingPassStrip flight={outbound} dense />
      {outbound.note && travelers.length === 1 && (
        <div className="card__note">"{outbound.note.length > 80 ? outbound.note.slice(0, 80) + "…" : outbound.note}"</div>
      )}
      <button
        className="card__return"
        onClick={(e) => { e.stopPropagation(); onOpen(returnLeg); }}
      >
        <span className="card__return-label">Returns {fmtDateShort(returnLeg.depart)}</span>
        <span className="card__return-row">
          {isFlight && <span className="card__return-flight"><span className="bp-airline" style={{ ["--ac"]: airline(returnLeg.airline).color }}>{returnLeg.airline}</span>{returnLeg.number}</span>}
          <span className="card__return-route">{to.city} <span aria-hidden="true">→</span> {from.city}</span>
          <span className="card__return-time">{fmtTime(returnLeg.depart)} {to.tz}</span>
        </span>
      </button>
      {faUrl && (
        <a
          className="fa-link card__fa"
          href={faUrl}
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
  FlightProgress, BoardingPassStrip, FlightCard, JourneyCard, RoundTripCard, SectionHead, EmptyRow,
});
