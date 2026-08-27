// calendar.jsx — the Calendar view, written for Dadaji.
//
// Earlier version had a month grid, color chips, and a Gantt — too busy.
// This version is just an agenda: one day per row, plain text lines like
// "Aarav flies to Delhi". Deliberately factual only — no inference about
// where someone "is" on days between flights (that used to exist as a
// "stay" concept and was often just wrong, especially for multi-city trips
// or when a return leg was never logged). Every line here corresponds to
// an actual logged flight event: it departed, or it arrived.

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

// Build the agenda rows for the cursor's month. Each day gets a departure
// line per flight leaving that day, and an arrival line per traveler
// landing that day — both read straight off logged flight data, nothing
// inferred in between.
function buildAgenda(cursor, flights) {
  const total = daysInMonth(cursor);
  const out = [];
  for (let i = 0; i < total; i++) {
    const d = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), i + 1));
    const [dStart, dEnd] = dayBounds(d);

    const travel = flights
      .filter((f) => f.depart.getTime() >= dStart && f.depart.getTime() <= dEnd)
      .map((f) => ({
        kind: "travel", flight: f,
        travelers: f.travelers,
        from: f.from, to: f.to,
        depart: f.depart, arrive: f.arrive,
        nextDay: !sameUTCDay(f.depart, f.arrive),
      }));

    // Skipped when arrival is the same calendar day as departure — the
    // travel line already on this same day ("flies to X") says everything
    // an arrival line would, and showing both reads as redundant. Genuinely
    // useful once departure and arrival fall on different days, since
    // that's the one case neither line alone would tell you.
    const arrivals = flights
      .filter((f) => f.arrive.getTime() >= dStart && f.arrive.getTime() <= dEnd && !sameUTCDay(f.depart, f.arrive))
      .flatMap((f) => f.travelers.map((pid) => ({
        kind: "arrive", personId: pid, flight: f,
        isHome: window.MGData.placesMatch(window.MGData.familyById(pid)?.homeAirport, f.to),
      })));

    if (travel.length || arrivals.length) {
      out.push({ date: d, travel, arrivals });
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
  const agenda = React.useMemo(() => buildAgenda(cursor, visibleFlights), [cursor, visibleFlights]);

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
          sub="Every takeoff and landing the family's logged, one month at a time. Step back with ‹ for the old chapters."
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
        {day.arrivals.map((a) => <ArriveLine key={"a-" + a.personId + "-" + a.flight.id} event={a} onOpen={onOpen} />)}
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
        <span className="dline__main">
          <span className="dline__name">{names}</span>
          <span className="dline__verb"> {travelers.length === 1 ? "flies" : "fly"} to </span>
          <span className="dline__place">{toCity}</span>
        </span>
        {/* Its own line, always — inline after a name of unpredictable
            length wrapped inconsistently from row to row. */}
        <span className="dline__meta">
          from {fromCity}
          {event.nextDay && <> · arrives {event.arrive.toLocaleString("en-US", { weekday: "short", timeZone: "UTC" })}</>}
        </span>
      </span>
    </button>
  );
}

// An "arrival" line — "Aarav arrives in Delhi" (or "back home" when the
// destination matches the traveler's home airport). Purely factual: this is
// exactly what the flight's arrival airport says, nothing inferred about
// what happens after.
function ArriveLine({ event, onOpen }) {
  const p = window.MGData.familyById(event.personId);
  if (!p) return null;
  const toCity = window.MGData.airport(event.flight.to)?.city ?? event.flight.to;
  return (
    <button className="dline dline--home" onClick={() => onOpen(event.flight)}>
      <span className="dline__icon" aria-hidden="true">{event.isHome ? "⌂" : "🛬"}</span>
      <span className="dline__text">
        <span className="dline__main">
          <span className="dline__name">{p.first}</span>
          <span className="dline__verb">{event.isHome ? " back home in " : " arrives in "}</span>
          <span className="dline__place">{toCity}</span>
        </span>
      </span>
    </button>
  );
}

Object.assign(window, { CalendarView });
