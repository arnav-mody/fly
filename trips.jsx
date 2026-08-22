// trips.jsx — trip-centric home view.
// A "trip" is derived automatically from consecutive flights shared by the
// same group of travelers: land somewhere that isn't home, and you're on a
// trip until the next flight departs. This is the primary lens for the home
// view now — flights are supporting detail, reachable by clicking through.

const DAY_MS = 24 * 60 * 60 * 1000;

// ── buildTrips ──────────────────────────────────────────────────────────────
// Groups flights by traveler-set so co-travelers (e.g. Priya & Raj) share one
// trip card instead of two. Home airport is read from the first traveler in
// the group — fine for our data, where co-travelers share a home base.
function buildTrips(flights) {
  const groups = {};
  for (const f of flights) {
    const key = [...f.travelers].sort().join(",");
    (groups[key] = groups[key] || []).push(f);
  }
  const ASSUMED_STAY = 14 * DAY_MS;
  const trips = [];
  for (const key of Object.keys(groups)) {
    const travelers = key.split(",");
    const home = familyById(travelers[0])?.homeAirport;
    const list = [...groups[key]].sort((a, b) => a.depart - b.depart);
    for (let i = 0; i < list.length; i++) {
      const leg = list[i];
      if (leg.to === home) continue; // this leg IS a return — captured as the previous trip's returnFlight
      const next = list[i + 1];
      trips.push({
        id: "trip-" + leg.id,
        travelers,
        destination: leg.to,
        destinationCity: airport(leg.to)?.city ?? leg.to,
        outboundFlight: leg,
        returnFlight: next && next.from === leg.to ? next : null,
        end: next ? next.depart : new Date(leg.arrive.getTime() + ASSUMED_STAY),
        assumedReturn: !next,
      });
    }
  }
  return trips;
}

// Status is computed against `now`, not stored, same pattern as flightStatus.
function tripStatus(trip, now) {
  const t = now.getTime();
  const dep = trip.outboundFlight.depart.getTime();
  const arr = trip.outboundFlight.arrive.getTime();
  if (t < dep) return "upcoming";
  if (t < arr) return "outbound";
  if (trip.returnFlight) {
    const rdep = trip.returnFlight.depart.getTime();
    const rarr = trip.returnFlight.arrive.getTime();
    if (t < rdep) return "there";
    if (t < rarr) return "returning";
    return "past";
  }
  return t < trip.end.getTime() ? "there" : "past";
}

// ── TripCard ────────────────────────────────────────────────────────────────
function TripCard({ trip, status, now, onOpen, compact = false }) {
  const travelers = trip.travelers.map(familyById).filter(Boolean);
  const names = travelers.map((p) => p.first).join(" & ");
  const plural = travelers.length > 1;
  const toCity = trip.destinationCity;

  const legForMap = status === "returning" && trip.returnFlight ? trip.returnFlight : trip.outboundFlight;
  const legMode = modeOf(legForMap);
  const isFlight = legMode === "flight";
  const mapFrom = { ...airport(legForMap.from), code: legForMap.from };
  const mapTo   = { ...airport(legForMap.to),   code: legForMap.to };
  const mapStatus = status === "outbound" || status === "returning" ? "airborne"
    : status === "upcoming" ? "scheduled" : "landed";

  let headline, pillLabel, pillClass, subline;
  if (status === "upcoming") {
    const days = Math.ceil((trip.outboundFlight.depart - now) / DAY_MS);
    headline = <>{names} {plural ? "leave" : "leaves"} for {toCity} {days <= 0 ? "today" : `in ${days} day${days === 1 ? "" : "s"}`}</>;
    pillLabel = "Coming up"; pillClass = "pill--up";
    subline = `Departs ${fmtDateShort(trip.outboundFlight.depart)} · ${fmtTime(trip.outboundFlight.depart)} ${airport(trip.outboundFlight.from)?.tz ?? ""}`;
  } else if (status === "outbound") {
    headline = <>{names} {plural ? "are" : "is"} flying to {toCity}</>;
    pillLabel = "In the air"; pillClass = "pill--air";
    subline = `Lands ${fmtTime(trip.outboundFlight.arrive)} ${airport(trip.outboundFlight.to)?.tz ?? ""}`;
  } else if (status === "there") {
    const endMs = trip.returnFlight ? trip.returnFlight.depart : trip.end;
    const days = Math.max(0, Math.ceil((endMs - now) / DAY_MS));
    headline = <>{names} {plural ? "are" : "is"} in {toCity}</>;
    pillLabel = days <= 0 ? "Leaving today" : `${days} day${days === 1 ? "" : "s"} left`;
    pillClass = "pill--up";
    subline = trip.returnFlight ? `Returns ${fmtDateShort(trip.returnFlight.depart)}` : "Return not booked yet";
  } else if (status === "returning") {
    headline = <>{names} {plural ? "are" : "is"} flying home</>;
    pillLabel = "Heading home"; pillClass = "pill--landed";
    subline = `Lands ${fmtTime(trip.returnFlight.arrive)} ${airport(trip.returnFlight.to)?.tz ?? ""}`;
  }

  const note = trip.outboundFlight.note;

  return (
    <article className={`tcard ${compact ? "tcard--compact" : ""}`} data-status={status} data-comment-anchor={`trip-${trip.id}`}>
      <div className="tcard__map">
        {isFlight
          ? <RouteMap from={mapFrom} to={mapTo} progress={legForMap.progress ?? 0} status={mapStatus} height={compact ? 120 : 160} />
          : <div className="tcard__mode-block" style={{ height: compact ? 120 : 160 }}>{modeMeta(legForMap).icon}</div>}
      </div>
      <div className="tcard__body">
        <div className="tcard__top">
          <AvatarStack ids={trip.travelers} size={32} />
          <span className={`pill ${pillClass}`}><span className="pill__dot" />{pillLabel}</span>
        </div>
        <h3 className="tcard__headline">{headline}</h3>
        <div className="tcard__meta">
          <span>{toCity}{airport(trip.destination)?.country ? `, ${airport(trip.destination).country}` : ""}</span>
          <span className="tcard__sub">{subline}</span>
        </div>
        {note && !compact && <div className="tcard__note">"{note.length > 100 ? note.slice(0, 100) + "…" : note}"</div>}
        <div className="tcard__flights">
          <button className="tcard__flightrow" onClick={() => onOpen(trip.outboundFlight)}>
            <span className="tcard__flightrow-lbl">Outbound</span>
            <span className="tcard__flightrow-flight">
              {modeOf(trip.outboundFlight) === "flight"
                ? <><span style={{ color: airline(trip.outboundFlight.airline).color }}>{trip.outboundFlight.airline}</span>{trip.outboundFlight.number}</>
                : modeMeta(trip.outboundFlight).icon}
            </span>
            <span className="tcard__flightrow-date">{fmtDateShort(trip.outboundFlight.depart)} · {fmtTime(trip.outboundFlight.depart)}</span>
          </button>
          {trip.returnFlight ? (
            <button className="tcard__flightrow" onClick={() => onOpen(trip.returnFlight)}>
              <span className="tcard__flightrow-lbl">Return</span>
              <span className="tcard__flightrow-flight">
                {modeOf(trip.returnFlight) === "flight"
                  ? <><span style={{ color: airline(trip.returnFlight.airline).color }}>{trip.returnFlight.airline}</span>{trip.returnFlight.number}</>
                  : modeMeta(trip.returnFlight).icon}
              </span>
              <span className="tcard__flightrow-date">{fmtDateShort(trip.returnFlight.depart)} · {fmtTime(trip.returnFlight.depart)}</span>
            </button>
          ) : (
            <div className="tcard__flightrow tcard__flightrow--empty">No return booked yet — the trip's still wide open</div>
          )}
        </div>
        {isFlight && (
          <a
            className="fa-link tcard__fa"
            href={flightAwareUrl(legForMap)}
            target="_blank" rel="noopener noreferrer"
          >
            Track on FlightAware <span className="fa-link__arrow">↗</span>
          </a>
        )}
      </div>
    </article>
  );
}

// ── HomeRoster ──────────────────────────────────────────────────────────────
// Everyone NOT currently traveling — a quiet, compact strip so the page's
// visual weight stays on the people who are actually away.
function HomeRoster({ family, awayIds, trips, now }) {
  const atHome = family.filter((p) => !awayIds.has(p.id));
  if (atHome.length === 0) return null;
  return (
    <section className="rail">
      <SectionHead kicker="Everyone else" title="At home" count={atHome.length} />
      <div className="homeroster">
        {atHome.map((p) => {
          const upcoming = trips
            .filter((t) => t.travelers.includes(p.id) && tripStatus(t, now) === "upcoming")
            .sort((a, b) => a.outboundFlight.depart - b.outboundFlight.depart)[0];
          const days = upcoming ? Math.max(0, Math.ceil((upcoming.outboundFlight.depart - now) / DAY_MS)) : null;
          return (
            <div key={p.id} className="hr-chip">
              <Avatar person={p} size={40} />
              <div className="hr-chip__text">
                <div className="hr-chip__name">{p.nick || p.first}</div>
                <div className="hr-chip__status">
                  {upcoming ? `Leaves in ${days === 0 ? "today" : days + "d"}` : "Home"}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── TripsHome ───────────────────────────────────────────────────────────────
function TripsHome({ allFlights, now, onOpenFlight, filterIds = [], upcomingOnly = false }) {
  const nonPast = React.useMemo(() => allFlights.filter((f) => !f.past), [allFlights]);
  const trips = React.useMemo(() => buildTrips(nonPast), [nonPast]);
  const visible = filterIds.length ? trips.filter((t) => t.travelers.some((id) => filterIds.includes(id))) : trips;
  const withStatus = visible.map((trip) => ({ trip, status: tripStatus(trip, now) })).filter((x) => x.status !== "past");

  const travelingNow = withStatus
    .filter((x) => x.status === "outbound" || x.status === "there" || x.status === "returning")
    .sort((a, b) => a.trip.outboundFlight.depart - b.trip.outboundFlight.depart);
  const comingUp = withStatus
    .filter((x) => x.status === "upcoming" && (!upcomingOnly || x.trip.outboundFlight.depart - now >= 24 * 60 * 60 * 1000))
    .sort((a, b) => a.trip.outboundFlight.depart - b.trip.outboundFlight.depart);

  // Anyone actually airborne right now gets the big hero treatment, same as
  // before — it's the single most important moment for Dadaji. Everyone else
  // who's simply "there" (landed, not yet flying home) gets a regular card.
  const inFlight = travelingNow.filter((x) => x.status === "outbound" || x.status === "returning");
  const atDestination = travelingNow.filter((x) => x.status === "there");
  const heroFlights = inFlight.map((x) => x.status === "outbound" ? x.trip.outboundFlight : x.trip.returnFlight);

  const awayIds = new Set(trips
    .filter((t) => { const s = tripStatus(t, now); return s === "outbound" || s === "there" || s === "returning"; })
    .flatMap((t) => t.travelers));
  const familyList = filterIds.length ? FAMILY.filter((p) => filterIds.includes(p.id)) : FAMILY;

  return (
    <div className="trips-home">
      {!upcomingOnly && heroFlights.length > 0 && <HeroDeck flights={heroFlights} now={now} onOpen={onOpenFlight} />}

      {!upcomingOnly && <><section className="rail">
        <SectionHead kicker="Right now" title="Traveling now" count={travelingNow.length} />
        {travelingNow.length === 0
          ? <EmptyRow text="Nobody's traveling right now — everyone's home." />
          : atDestination.length > 0
            ? <div className="tcard-grid">{atDestination.map(({ trip, status }) => <TripCard key={trip.id} trip={trip} status={status} now={now} onOpen={onOpenFlight} />)}</div>
            : null
        }
      </section>

      <HomeRoster family={familyList} awayIds={awayIds} trips={trips} now={now} /></>}

      {comingUp.length > 0 && (
        <section className="rail">
          <SectionHead kicker="On the horizon" title="Coming up" count={comingUp.length} />
          <div className="tcard-grid tcard-grid--compact">
            {comingUp.map(({ trip, status }) => <TripCard key={trip.id} trip={trip} status={status} now={now} onOpen={onOpenFlight} compact />)}
          </div>
        </section>
      )}
    </div>
  );
}

Object.assign(window, { buildTrips, tripStatus, TripCard, HomeRoster, TripsHome });
