// now.jsx — the glance view. One screenful, no scrolling, phone-first.
// Every traveling group is ONE row. Rows expand in place for detail so the
// summary never grows past the fold as more people travel.

const IMMINENT_MS = 24 * 60 * 60 * 1000;

function tallyLine(air, away, home, soon) {
  const parts = [];
  if (air) parts.push(`${air} in the air`);
  if (soon) parts.push(`${soon} leaving soon`);
  if (away) parts.push(`${away} away`);
  return parts.length ? parts.join(" · ") : "quiet skies — everyone's home";
}

// ── NowRow — one traveling group, one line ──────────────────────────────────
function NowRow({ trip, status, now, open, onToggle, onOpenFlight }) {
  const travelers = trip.travelers.map(familyById).filter(Boolean);
  const names = travelers.map((p) => p.nick || p.first).join(" & ");
  const air = status === "outbound" || status === "returning";
  const soon = status === "upcoming";
  const leg = status === "returning" ? trip.returnFlight : trip.outboundFlight;

  let place, right, sub;
  if (soon) {
    const from = airport(leg.from);
    place = `→ ${trip.destinationCity}`;
    right = "in " + fmtDuration(leg.depart - now);
    sub = `departs ${fmtTime(leg.depart)} ${from.tz}`;
  } else if (air) {
    const to = airport(leg.to);
    place = status === "returning" ? `flying home → ${to.city}` : `→ ${to.city}`;
    right = fmtDuration(leg.arrive - now);
    sub = `lands ${fmtTime(leg.arrive)} ${to.tz}`;
  } else {
    const endMs = trip.returnFlight ? trip.returnFlight.depart : trip.end;
    const days = Math.max(0, Math.ceil((endMs - now) / DAY_MS));
    place = `in ${trip.destinationCity}`;
    right = days === 0 ? "back today" : `${days}d left`;
    sub = trip.returnFlight ? `back ${fmtDateShort(trip.returnFlight.arrive)}` : "return not booked";
  }

  const pct = air ? Math.round(Math.min(1, Math.max(0, (now - leg.depart) / (leg.arrive - leg.depart))) * 100) : 0;

  return (
    <li className="nowrow" data-air={air ? "1" : "0"} data-soon={soon ? "1" : "0"} data-open={open ? "1" : "0"} data-comment-anchor={`now-${trip.id}`}>
      <button className="nowrow__hit" onClick={onToggle} aria-expanded={open}>
        <AvatarStack ids={trip.travelers} size={34} />
        <span className="nowrow__text">
          <span className="nowrow__name">{names}</span>
          <span className="nowrow__place">{place}</span>
        </span>
        <span className="nowrow__right">
          <span className="nowrow__val">{(air || soon) && <span className="nowrow__dot" />}{right}</span>
          <span className="nowrow__sub">{sub}</span>
        </span>
      </button>
      {air && <span className="nowrow__prog"><span style={{ width: pct + "%" }} /></span>}
      {open && (
        <div className="nowrow__detail">
          <div className="nowrow__map">
            <RouteMap
              from={{ ...airport(leg.from), code: leg.from }}
              to={{ ...airport(leg.to), code: leg.to }}
              progress={air ? (leg.progress ?? pct / 100) : 0}
              status={air ? "airborne" : "landed"}
              height={130}
            />
          </div>
          <div className="nowrow__legs">
            <button className="nowrow__leg" onClick={() => onOpenFlight(trip.outboundFlight)}>
              <span>Outbound</span>
              <strong>{trip.outboundFlight.airline}{trip.outboundFlight.number}</strong>
              <span>{fmtDateShort(trip.outboundFlight.depart)}</span>
            </button>
            {trip.returnFlight ? (
              <button className="nowrow__leg" onClick={() => onOpenFlight(trip.returnFlight)}>
                <span>Return</span>
                <strong>{trip.returnFlight.airline}{trip.returnFlight.number}</strong>
                <span>{fmtDateShort(trip.returnFlight.depart)}</span>
              </button>
            ) : (
              <div className="nowrow__leg nowrow__leg--empty">Return not booked yet</div>
            )}
          </div>
          {trip.outboundFlight.note && <div className="nowrow__note">"{trip.outboundFlight.note}"</div>}
          <a
            className="fa-link nowrow__fa"
            href={flightAwareUrl(leg)}
            target="_blank" rel="noopener noreferrer"
          >
            Track on FlightAware <span className="fa-link__arrow">↗</span>
          </a>
        </div>
      )}
    </li>
  );
}

// ── NowView ─────────────────────────────────────────────────────────────────
function NowView({ allFlights, now, onOpenFlight, filterIds = [], onSeeAll }) {
  const [openId, setOpenId] = React.useState(null);
  const trips = React.useMemo(() => buildTrips(allFlights.filter((f) => !f.past)), [allFlights]);
  const visible = filterIds.length ? trips.filter((t) => t.travelers.some((id) => filterIds.includes(id))) : trips;
  const withStatus = visible.map((trip) => ({ trip, status: tripStatus(trip, now) }));

  // A trip leaving within a day is imminent enough to belong in the live panel
  // rather than the "coming up" list — that's what the old "Taking off soon"
  // rail was for, folded in here so nothing appears twice.
  const active = withStatus
    .filter((x) => ["outbound", "returning", "there"].includes(x.status)
      || (x.status === "upcoming" && x.trip.outboundFlight.depart - now < IMMINENT_MS))
    .sort((a, b) => {
      const rank = (s) => (s === "outbound" || s === "returning" ? 0 : s === "upcoming" ? 1 : 2);
      return rank(a.status) - rank(b.status) || a.trip.outboundFlight.depart - b.trip.outboundFlight.depart;
    });
  const upcoming = withStatus
    .filter((x) => x.status === "upcoming" && x.trip.outboundFlight.depart - now >= IMMINENT_MS)
    .sort((a, b) => a.trip.outboundFlight.depart - b.trip.outboundFlight.depart);

  const awayIds = new Set(active.flatMap((x) => x.trip.travelers));
  const roster = filterIds.length ? FAMILY.filter((p) => filterIds.includes(p.id)) : FAMILY;
  const atHome = roster.filter((p) => !awayIds.has(p.id));
  const airCount = active.filter((x) => x.status === "outbound" || x.status === "returning").flatMap((x) => x.trip.travelers).length;
  const soonCount = active.filter((x) => x.status === "upcoming").flatMap((x) => x.trip.travelers).length;
  const thereCount = active.filter((x) => x.status === "there").flatMap((x) => x.trip.travelers).length;

  const nextTwo = upcoming.slice(0, 2);
  const moreCount = upcoming.length - nextTwo.length;

  return (
    <section className="now" data-screen-label="01 Now">
      <div className="now__head">
        <div className="now__title">
          <span className="now__live" data-on={airCount > 0 ? "1" : "0"} />
          Right now
        </div>
        <div className="now__tally">{tallyLine(airCount, thereCount, atHome.length, soonCount)}</div>
      </div>

      {active.length === 0 ? (
        <div className="now__quiet">Everyone's home. The sky's got the day off.</div>
      ) : (
        <ul className="now__list">
          {active.map(({ trip, status }) => (
            <NowRow
              key={trip.id} trip={trip} status={status} now={now}
              open={openId === trip.id}
              onToggle={() => setOpenId(openId === trip.id ? null : trip.id)}
              onOpenFlight={onOpenFlight}
            />
          ))}
        </ul>
      )}

      <div className="now__foot">
        {atHome.length > 0 && (
          <div className="now__home">
            <AvatarStack ids={atHome.map((p) => p.id)} size={26} />
            <span className="now__home-txt">
              {atHome.map((p) => p.nick || p.first).join(", ")} {atHome.length === 1 ? "is" : "are"} home
            </span>
          </div>
        )}
        {nextTwo.length > 0 && (
          <ul className="now__next">
            {nextTwo.map(({ trip }) => {
              const days = Math.max(0, Math.ceil((trip.outboundFlight.depart - now) / DAY_MS));
              return (
                <li key={trip.id}>
                  <span className="now__next-when">{days === 0 ? "today" : `in ${days}d`}</span>
                  <span className="now__next-who">{trip.travelers.map((id) => familyById(id)?.nick || familyById(id)?.first).join(" & ")}</span>
                  <span className="now__next-where">→ {trip.destinationCity}</span>
                </li>
              );
            })}
            {moreCount > 0 && (
              <li className="now__next-more"><button onClick={onSeeAll}>+{moreCount} more upcoming →</button></li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

Object.assign(window, { NowView, NowRow });
