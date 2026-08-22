// calendar.jsx — the Calendar view, written for Dadaji.
//
// Earlier version had a month grid, color chips, and a Gantt — too busy.
// This version is just an agenda: one day per row, plain text lines like
// "Aarav flies to Delhi" and "Meera in Phoenix". Anything else gets in the
// way of the one thing he wants to know — who is where, when.

// ── away-segment builder ────────────────────────────────────────────────────
// For each person, walk their upcoming flights in order. Every time they land
// somewhere ≠ home, they're "in" that city until the next flight departs
// (or 14 days, if no return is on file yet).
function buildAwaySegments(allFlights) {
  const byPerson = {};
  for (const f of allFlights) {
    for (const pid of f.travelers) (byPerson[pid] = byPerson[pid] || []).push(f);
  }
  const ASSUMED_STAY = 14 * 24 * 60 * 60 * 1000;
  const segments = [];
  for (const pid of Object.keys(byPerson)) {
    const person = window.MGData.familyById(pid);
    if (!person) continue;
    const home = person.homeAirport;
    const list = [...byPerson[pid]].sort((a, b) => a.depart - b.depart);
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const next = list[i + 1];
      if (f.to !== home) {
        const start = f.arrive;
        const end = next ? next.depart : new Date(f.arrive.getTime() + ASSUMED_STAY);
        segments.push({
          personId: pid,
          location: f.to,
          locationCity: window.MGData.airport(f.to)?.city ?? f.to,
          start, end,
          assumed: !next,
          originFlightId: f.id,
        });
      }
    }
  }
  return segments;
}

// ── date helpers ────────────────────────────────────────────────────────────
function startOfMonth(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonths(d, n) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); }
function daysInMonth(d)  { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
function sameUTCDay(a, b) {
  return a.getUTCFullYear() === b.getUTCFullYear() &&
         a.getUTCMonth()    === b.getUTCMonth()    &&
         a.getUTCDate()     === b.getUTCDate();
}
function dayBounds(d) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), dd = d.getUTCDate();
  return [Date.UTC(y, m, dd, 0, 0, 0), Date.UTC(y, m, dd, 23, 59, 59)];
}

// Build the agenda rows for the cursor's month.
// Each day in the month gets either an empty entry (skipped) or a list of
// human-readable events. We collapse multi-traveler same-flight events into
// one line ("Priya & Raj fly to London") and skip stay-events on days where
// the person is also flying (the flight line already implies they're there).
function buildAgenda(cursor, flights, segments) {
  const total = daysInMonth(cursor);
  const out = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), i + 1));
    const [dStart, dEnd] = dayBounds(d);

    // Travel events — flights departing this day. Grouped per flight.
    const travel = flights
      .filter((f) => f.depart.getTime() >= dStart && f.depart.getTime() <= dEnd)
      .map((f) => ({
        kind: "travel", flight: f,
        travelers: f.travelers,
        from: f.from, to: f.to,
        depart: f.depart, arrive: f.arrive,
        nextDay: !sameUTCDay(f.depart, f.arrive),
      }));

    // Returns home — flights ARRIVING today at a traveler's home airport.
    const returnsHome = flights
      .filter((f) => f.arrive.getTime() >= dStart && f.arrive.getTime() <= dEnd)
      .flatMap((f) => f.travelers
        .map((pid) => ({ pid, home: window.MGData.familyById(pid)?.homeAirport }))
        .filter(({ home }) => home === f.to)
        // skip "returns home" if there's no away-period preceding it (i.e.
        // they were just at the from-airport for transit — unlikely here)
        .map(({ pid }) => ({ kind: "home", personId: pid, flight: f }))
      );

    // People IDs who are traveling/returning today — used to dedupe stays.
    const travelingToday = new Set();
    for (const t of travel) for (const pid of t.travelers) travelingToday.add(pid);
    for (const r of returnsHome) travelingToday.add(r.personId);

    // Stay events — person is in a non-home city today, but not on a flight.
    const stays = segments
      .filter((s) => s.start.getTime() < dEnd && s.end.getTime() > dStart)
      .filter((s) => !travelingToday.has(s.personId))
      // dedupe by person — same person can only have one stay per day
      .filter((s, i, arr) => arr.findIndex((x) => x.personId === s.personId) === i)
      .map((s) => ({ kind: "stay", personId: s.personId, location: s.location, locationCity: s.locationCity, assumed: s.assumed }));

    if (travel.length || returnsHome.length || stays.length) {
      out.push({ date: d, travel, returnsHome, stays });
    }
  }
  return out;
}

// ── CalendarView ────────────────────────────────────────────────────────────
function CalendarView({ flights, now, onOpen, filterIds = [] }) {
  const [cursor, setCursor] = React.useState(() => startOfMonth(now));

  const visibleFlights = React.useMemo(
    () => filterIds.length ? flights.filter((f) => f.travelers.some((id) => filterIds.includes(id))) : flights,
    [flights, filterIds]
  );
  const segments = React.useMemo(() => buildAwaySegments(visibleFlights), [visibleFlights]);
  const agenda   = React.useMemo(() => buildAgenda(cursor, visibleFlights, segments), [cursor, visibleFlights, segments]);

  const monthLabel = cursor.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const isThisMonth = cursor.getUTCMonth() === now.getUTCMonth() && cursor.getUTCFullYear() === now.getUTCFullYear();

  // Ref to the "today" row so we can scroll there when entering the view.
  const todayRef = React.useRef(null);

  return (
    <div className="cal" data-screen-label="04 Calendar">
      <div className="cal__head">
        <SectionHead
          kicker="At a glance"
          title="Who's where, when"
          sub="Every takeoff, landing, and day away from home — the family's whole story, one month at a time. Step back with ‹ for the old chapters."
        />
        <div className="cal__nav">
          <button className="cal__nav-btn" onClick={() => setCursor(addMonths(cursor, -1))} aria-label="Previous month">‹</button>
          <span className="cal__nav-label">{monthLabel}</span>
          <button className="cal__nav-btn" onClick={() => setCursor(addMonths(cursor, 1))} aria-label="Next month">›</button>
          <button className="cal__today" onClick={() => setCursor(startOfMonth(now))}>Today</button>
        </div>
      </div>

      <div className="cal__agenda">
        {agenda.length === 0 && (
          <div className="cal__quiet">No travel this month. A quiet stretch for the family. ✨</div>
        )}
        {agenda.map((day) => (
          <DayRow
            key={day.date.toISOString()}
            day={day}
            now={now}
            isToday={sameUTCDay(day.date, now)}
            onOpen={onOpen}
            innerRef={isThisMonth && sameUTCDay(day.date, now) ? todayRef : null}
          />
        ))}
      </div>
    </div>
  );
}

// ── DayRow ──────────────────────────────────────────────────────────────────
// One day's worth of agenda lines. Plain text, large enough for older eyes.
function DayRow({ day, now, isToday, onOpen, innerRef }) {
  const weekday = day.date.toLocaleString("en-US", { weekday: "long", timeZone: "UTC" });
  const monthDay = day.date.toLocaleString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
  const past = day.date.getTime() < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return (
    <div className={`dayrow ${isToday ? "dayrow--today" : ""} ${past ? "dayrow--past" : ""}`} ref={innerRef}>
      <div className="dayrow__when">
        <div className="dayrow__weekday">{weekday}</div>
        <div className="dayrow__date">{monthDay}</div>
        {isToday && <div className="dayrow__pin">Today</div>}
      </div>
      <div className="dayrow__events">
        {day.travel.map((t) => <TravelLine key={"t-" + t.flight.id} event={t} onOpen={onOpen} />)}
        {day.returnsHome.map((r) => <HomeLine key={"h-" + r.personId + "-" + r.flight.id} event={r} onOpen={onOpen} />)}
        {day.stays.map((s) => <StayLine key={"s-" + s.personId} event={s} />)}
      </div>
    </div>
  );
}

// ── Lines ───────────────────────────────────────────────────────────────────
// A "travel" line — "Aarav flies to Delhi". Click to open the flight modal.
function TravelLine({ event, onOpen }) {
  const travelers = event.travelers.map((id) => window.MGData.familyById(id)).filter(Boolean);
  const names = travelers.map((p) => p.first).join(" & ");
  const toCity = window.MGData.airport(event.to)?.city ?? event.to;
  const fromCity = window.MGData.airport(event.from)?.city ?? event.from;

  return (
    <button className="dline dline--travel" onClick={() => onOpen(event.flight)}>
      <span className="dline__icon" aria-hidden="true">{window.MGData.modeMeta(event.flight).icon}</span>
      <span className="dline__text">
        <span className="dline__name">{names}</span>
        <span className="dline__verb"> {travelers.length === 1 ? "flies" : "fly"} to </span>
        <span className="dline__place">{toCity}</span>
        <span className="dline__meta">
          {" "}· from {fromCity}
          {event.nextDay && <> · arrives {event.arrive.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" })}</>}
        </span>
      </span>
    </button>
  );
}

// A "stay" line — "Meera in Phoenix" (for days when person is away but not flying).
function StayLine({ event }) {
  const p = window.MGData.familyById(event.personId);
  if (!p) return null;
  return (
    <div className="dline dline--stay">
      <span className="dline__icon" aria-hidden="true">•</span>
      <span className="dline__text">
        <span className="dline__name">{p.first}</span>
        <span className="dline__verb"> in </span>
        <span className="dline__place">{event.locationCity}</span>
        {event.assumed && <span className="dline__meta"> · return not booked yet</span>}
      </span>
    </div>
  );
}

// A "returns home" line — distinguishes "Aarav lands home in New York" from
// a regular travel day, because Dadaji will want to know when people are
// back safely.
function HomeLine({ event, onOpen }) {
  const p = window.MGData.familyById(event.personId);
  if (!p) return null;
  return (
    <button className="dline dline--home" onClick={() => onOpen(event.flight)}>
      <span className="dline__icon" aria-hidden="true">⌂</span>
      <span className="dline__text">
        <span className="dline__name">{p.first}</span>
        <span className="dline__verb"> back home in </span>
        <span className="dline__place">{p.home}</span>
      </span>
    </button>
  );
}

Object.assign(window, { CalendarView, buildAwaySegments });
