// app.jsx — main App for the Mody-Gandhi Travel Tracker.
// Composes the Board, Travelers, Archive views; hosts modals; wires tweaks.
// (FAMILY, FLIGHTS, flightStatus, familyById, airline, airport are already in
// scope here because components.jsx declared them at the top level — Babel
// scripts share the global lexical scope.)

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "palette": ["#f4ecdc", "#1e1812", "#c45a2a"],
  "fontScale": 1,
  "density": "regular",
  "mapStyle": "chart",
  "grandpaMode": false
}/*EDITMODE-END*/;

// Palette options for the tweaks color picker. Each is [paper, ink, accent].
const PALETTES = [
  ["#f4ecdc", "#1e1812", "#c45a2a"], // warm cream + saffron (default)
  ["#f1ede4", "#1a1a1a", "#1f6b5e"], // bone + forest
  ["#eee6d6", "#241a14", "#6a4ca0"], // parchment + plum
  ["#0f1722", "#e9e2cf", "#e8a64a"], // dark navy + ochre (night mode)
  ["#fbf6ed", "#161616", "#1d4ed8"], // editorial + cobalt
];

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const now = useNow();

  // Apply tweaks to CSS vars on the root.
  React.useEffect(() => {
    const r = document.documentElement;
    const [paper, ink, accent] = t.palette;
    r.style.setProperty("--paper", paper);
    r.style.setProperty("--ink", ink);
    r.style.setProperty("--accent", accent);
    // Paper-soft is a slightly darker shade of paper for cards/inset.
    const isDark = isHexDark(paper);
    r.style.setProperty("--paper-soft", isDark ? mix(paper, "#ffffff", 0.06) : mix(paper, "#000000", 0.04));
    r.style.setProperty("--paper-deeper", isDark ? mix(paper, "#ffffff", 0.12) : mix(paper, "#000000", 0.08));
    r.style.setProperty("--paper-line", isDark ? "rgba(255,255,255,.12)" : "rgba(28,24,20,.12)");
    r.style.setProperty("--ink-soft", isDark ? mix(ink, paper, 0.45) : mix(ink, paper, 0.4));
    r.style.setProperty("--ink-faint", isDark ? mix(ink, paper, 0.65) : mix(ink, paper, 0.55));
    r.dataset.dark = isDark ? "1" : "0";
    r.style.setProperty("--font-scale", t.fontScale);
    r.dataset.density = t.density;
    r.dataset.grandpa = t.grandpaMode ? "1" : "0";
  }, [t]);

  const [view, setView] = React.useState("board");      // board | calendar | travelers
  const [openFlight, setOpenFlight] = React.useState(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [filterIds, setFilterIds] = React.useState([]);

  // Real flights, fetched from Supabase — merged alongside the curated demo
  // data in FLIGHTS rather than replacing it, so the board still has
  // something to show before anyone's added a real one. A failed/pending
  // fetch just leaves this empty; nothing else breaks.
  const [dbFlights, setDbFlights] = React.useState([]);
  const refreshFlights = React.useCallback(() => {
    if (!window.supabaseClient) return;
    window.supabaseClient
      .from("flights")
      .select("*, flight_travelers(family_member_id)")
      .then(({ data, error }) => {
        if (error) { console.error("Couldn't load flights from Supabase:", error.message); return; }
        setDbFlights((data || []).map(mapDbFlight));
      });
  }, []);
  React.useEffect(() => { refreshFlights(); }, [refreshFlights]);

  const allFlights = [...FLIGHTS, ...dbFlights];

  // Bucket by status
  const byStatus = React.useMemo(() => {
    const buckets = { airborne: [], boarding: [], scheduled: [], landed: [], past: [] };
    for (const f of allFlights) {
      const s = flightStatus(f, now);
      buckets[s].push(f);
    }
    // Sort each bucket sensibly.
    buckets.airborne.sort((a, b) => a.arrive - b.arrive);
    buckets.boarding.sort((a, b) => a.depart - b.depart);
    buckets.scheduled.sort((a, b) => a.depart - b.depart);
    buckets.landed.sort((a, b) => b.arrive - a.arrive); // most recent first
    buckets.past.sort((a, b) => b.depart - a.depart);
    return buckets;
  }, [allFlights, now]);

  // Person filter — applied across all buckets.
  const f = (list) => filterIds.length ? list.filter((x) => x.travelers.some((id) => filterIds.includes(id))) : list;

  // AddTripModal does its own saving (via the save-flight Edge Function) —
  // this just re-syncs the board once it's done.
  const handleSubmit = () => refreshFlights();

  return (
    <div className="app">
      <TopBar
        now={now}
        view={view} setView={setView}
        onAdd={() => setAddOpen(true)}
        airborneCount={byStatus.airborne.length}
        soonCount={byStatus.boarding.length}
        filterIds={filterIds}
        setFilterIds={setFilterIds}
      />

      <main className="main">
        {view === "board" && (
          <>
            <NowView allFlights={allFlights} now={now} onOpenFlight={setOpenFlight} filterIds={filterIds} onSeeAll={() => setView("calendar")} />
            <TripsHome allFlights={allFlights} now={now} onOpenFlight={setOpenFlight} filterIds={filterIds} upcomingOnly />
          </>
        )}
        {view === "calendar" && (
          <CalendarView
            flights={allFlights}
            now={now}
            onOpen={setOpenFlight}
            filterIds={filterIds}
          />
        )}
        {view === "travelers" && (
          <TravelersView allFlights={allFlights} now={now} onSelectPerson={(id) => { setFilterIds([id]); setView("board"); }} />
        )}
      </main>

      <Footer />

      <FlightDetailModal flight={openFlight} onClose={() => setOpenFlight(null)} now={now} />
      <AddTripModal open={addOpen} onClose={() => setAddOpen(false)} onSubmit={handleSubmit} />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Palette">
          <TweakColor
            label="Color theme"
            value={t.palette}
            options={PALETTES}
            onChange={(v) => setTweak("palette", v)}
          />
        </TweakSection>
        <TweakSection label="Layout">
          <TweakRadio
            label="Density"
            value={t.density}
            options={["cozy", "regular", "roomy"]}
            onChange={(v) => setTweak("density", v)}
          />
        </TweakSection>
        <TweakSection label="Accessibility">
          <TweakToggle
            label="Grandpa mode (bigger type)"
            value={t.grandpaMode}
            onChange={(v) => setTweak("grandpaMode", v)}
          />
          <TweakSlider
            label="Font scale"
            min={0.9} max={1.3} step={0.05} unit="×"
            value={t.fontScale}
            onChange={(v) => setTweak("fontScale", v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// ── TopBar ──────────────────────────────────────────────────────────────────
function TopBar({ now, view, setView, onAdd, airborneCount, soonCount, filterIds, setFilterIds }) {
  return (
    <header className="topbar" data-screen-label="00 Top Bar">
      <div className="topbar__brand">
        <BrandMark />
        <div className="topbar__brand-text">
          <div className="topbar__brand-title">Mody-Gandhi</div>
          <div className="topbar__brand-sub">Travel Tracker</div>
        </div>
      </div>
      <nav className="topbar__nav">
        <button data-active={view === "board"}     onClick={() => setView("board")}>Home</button>
        <button data-active={view === "calendar"}  onClick={() => setView("calendar")}>Calendar</button>
        <button data-active={view === "travelers"} onClick={() => setView("travelers")}>Travelers</button>
      </nav>
      <div className="topbar__right">
        <PeopleFilter ids={filterIds} onChange={setFilterIds} />
        <button className="topbar__add" onClick={onAdd} title="Add a trip" aria-label="Add a trip">＋</button>
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <svg viewBox="0 0 40 40" className="brand-mark" aria-hidden="true">
      <circle cx="20" cy="20" r="18" fill="var(--accent)" opacity="0.12" />
      <circle className="brand-mark__ring" cx="20" cy="20" r="14" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 3" />
      <g className="brand-mark__plane">
        <path d="M 6 24 L 30 18 L 10 16 L 14 18 Z" fill="var(--ink)" transform="rotate(-15 20 20)" />
      </g>
      <circle className="brand-mark__spark" cx="34" cy="11" r="2" fill="var(--accent)" />
    </svg>
  );
}

// ── PeopleFilter — one collapsed control, multi-select ──────────────────────
function PeopleFilter({ ids, onChange }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const toggle = (id) => onChange(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const label = ids.length === 0
    ? "Everyone"
    : ids.length === 1
      ? (familyById(ids[0])?.nick || familyById(ids[0])?.first)
      : `${ids.length} people`;

  return (
    <div className="pfil" ref={ref}>
      <button className="pfil__btn" data-on={ids.length ? "1" : "0"} onClick={() => setOpen(!open)} aria-expanded={open}>
        {ids.length > 0 && <AvatarStack ids={ids.slice(0, 3)} size={20} />}
        <span>{label}</span>
        <span className="pfil__caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pfil__menu">
          <button className="pfil__all" onClick={() => onChange([])}>Everyone</button>
          <div className="pfil__list">
            {FAMILY.map((p) => {
              const on = ids.includes(p.id);
              return (
                <label key={p.id} className="pfil__item" data-on={on ? "1" : "0"}>
                  <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
                  <span className="pfil__box" aria-hidden="true" />
                  <Avatar person={p} size={26} />
                  <span className="pfil__name">{p.first} {p.last}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Board ───────────────────────────────────────────────────────────────────
function Board({ buckets, now, heroOn, onOpen, onAdd }) {
  const airborne = buckets.airborne;
  const showAirborneHero = heroOn && airborne.length > 0;
  const showBoardingHero = heroOn && airborne.length === 0 && buckets.boarding.length > 0;
  const boardingHeroFlight = showBoardingHero ? buckets.boarding[0] : null;
  // Boarding flights NOT already used in the hero — feed the "Taking off soon" rail.
  const remainingBoarding = buckets.boarding.filter((f) => f !== boardingHeroFlight);
  // Airborne flights NOT already used in the hero — only happens if heroOn is off.
  const remainingAirborne = airborne.filter(() => !showAirborneHero);

  return (
    <div className="board" data-screen-label="01 Board">
      {showAirborneHero && (
        <HeroDeck flights={airborne} now={now} onOpen={onOpen} />
      )}
      {showBoardingHero && (
        <HeroBoarding flight={boardingHeroFlight} now={now} onOpen={onOpen} />
      )}

      {/* Taking off soon */}
      {remainingBoarding.length > 0 && (
        <section className="rail">
          <SectionHead
            kicker="Next 24 hours"
            title="Taking off soon"
            count={buckets.boarding.length}
          />
          <div className="rail__grid">
            {remainingBoarding.map((f) => (
              <FlightCard key={f.id} flight={f} onOpen={onOpen} now={now} />
            ))}
          </div>
        </section>
      )}

      {/* Airborne fallback row (only shown when the hero is toggled off) */}
      {remainingAirborne.length > 0 && (
        <section className="rail">
          <SectionHead kicker="Right now" title="In the air" count={remainingAirborne.length} />
          <div className="rail__grid">
            {remainingAirborne.map((f) => <FlightCard key={f.id} flight={f} onOpen={onOpen} now={now} />)}
          </div>
        </section>
      )}

      {/* This week */}
      <section className="rail">
        <SectionHead kicker="This week & beyond" title="On the horizon" count={buckets.scheduled.length} />
        {buckets.scheduled.length === 0
          ? <EmptyRow text="No upcoming trips. Tell the family to start planning something!" />
          : (
            <div className="rail__grid">
              {buckets.scheduled.map((f) => <FlightCard key={f.id} flight={f} onOpen={onOpen} now={now} />)}
            </div>
          )
        }
      </section>

      {/* Just landed */}
      {buckets.landed.length > 0 && (
        <section className="rail rail--landed">
          <SectionHead kicker="Welcome home" title="Just landed" count={buckets.landed.length} />
          <div className="rail__grid">
            {buckets.landed.map((f) => <FlightCard key={f.id} flight={f} onOpen={onOpen} now={now} />)}
          </div>
        </section>
      )}

      {/* CTA */}
      <section className="cta">
        <div className="cta__inner">
          <div>
            <h3>Booked a flight?</h3>
            <p>Drop the details — Dadaji will be tracking before you even get to the airport.</p>
          </div>
          <button className="cta__btn" onClick={onAdd}>＋ Add a trip</button>
        </div>
      </section>
    </div>
  );
}

// ── HeroDeck — single flight = the big editorial hero, 2+ = split tiles ────
// When more than one family member is in the air at once, we show every
// concurrent flight side-by-side in the same hero band so Dadaji never has to
// scroll to discover the second one. Same-flight travelers are already grouped
// inside a single tile via the AvatarStack.
function HeroDeck({ flights, now, onOpen }) {
  if (flights.length === 1) {
    return <HeroAirborne flight={flights[0]} now={now} onOpen={onOpen} />;
  }
  return (
    <section className="hero-deck" data-screen-label="01 Hero Deck">
      <div className="hero-deck__head">
        <div className="hero__kicker">
          <span className="hero__live-dot" />
          Right now · {flights.length} family members in the air
        </div>
        <span className="hero__chip">{flights.length} live flights</span>
      </div>
      <div className={`hero-deck__grid hero-deck__grid--${Math.min(flights.length, 3)}`}>
        {flights.map((f) => (
          <HeroAirborneTile key={f.id} flight={f} now={now} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}

// Compact version of the airborne hero used inside HeroDeck. Same content as
// HeroAirborne but smaller — map shrinks, the lines row drops to two stats,
// and the note moves inside the tile instead of below.
function HeroAirborneTile({ flight, now, onOpen }) {
  const from = { ...airport(flight.from), code: flight.from };
  const to   = { ...airport(flight.to),   code: flight.to };
  const travelers = flight.travelers.map(familyById).filter(Boolean);
  const remaining = flight.arrive - now;
  const lead = travelers.length === 1
    ? travelers[0].first
    : travelers.map((p) => p.first).join(" & ");
  return (
    <article className="htile" onClick={() => onOpen(flight)}>
      <div className="htile__map">
        <RouteMap from={from} to={to} progress={flight.progress ?? 0} status="airborne" height={200} />
        <span className="htile__chip">In the air</span>
      </div>
      <div className="htile__body">
        <div className="htile__top">
          <AvatarStack ids={flight.travelers} size={36} />
          <span className="htile__id">{flight.airline}{flight.number}</span>
        </div>
        <h2 className="htile__headline">
          <span className="htile__name">{lead}</span>
          <span className="htile__verb"> is in the sky.</span>
        </h2>
        <div className="htile__route">
          {from.city} <span className="htile__arrow">→</span> {to.city}
        </div>
        <FlightProgress flight={flight} now={now} />
        <div className="htile__lines">
          <div>
            <div className="hero__line-lbl">Lands in</div>
            <div className="hero__line-val">{fmtDuration(remaining)}</div>
          </div>
          <div>
            <div className="hero__line-lbl">Arriving</div>
            <div className="hero__line-val">{fmtTime(flight.arrive)} {to.tz}</div>
          </div>
        </div>
        <button className="hero__more" onClick={(e) => { e.stopPropagation(); onOpen(flight); }}>
          Open flight details →
        </button>
      </div>
    </article>
  );
}

// ── HeroAirborne ────────────────────────────────────────────────────────────
// The big "someone's in the sky right now" panel that sits at the top of the
// board whenever any flight is airborne. This is the single most important
// moment in the UI for Grandpa.
function HeroAirborne({ flight, now, onOpen }) {
  const from = { ...airport(flight.from), code: flight.from };
  const to   = { ...airport(flight.to),   code: flight.to };
  const travelers = flight.travelers.map(familyById).filter(Boolean);
  const remaining = flight.arrive - now;
  const lead = travelers.length === 1
    ? travelers[0].first
    : travelers.map((p) => p.first).join(" & ");

  return (
    <section className="hero hero--air" data-screen-label="01 Hero Airborne">
      <div className="hero__pulse" aria-hidden="true" />
      <div className="hero__top">
        <div className="hero__kicker">
          <span className="hero__live-dot" />
          Right now · {fmtTime(now)} UTC
        </div>
        <span className="hero__chip">In the air</span>
      </div>
      <div className="hero__layout">
        <div className="hero__left">
          <AvatarStack ids={flight.travelers} size={56} />
          <h1 className="hero__headline">
            <span className="hero__name">{lead}</span>
            <span className="hero__verb"> is in the sky.</span>
          </h1>
          <p className="hero__sub">
            {flight.airline}{flight.number} · {from.city} → {to.city} · cruising at {flight.cruisingAlt?.toLocaleString()} ft
          </p>
          <FlightProgress flight={flight} now={now} />
          <div className="hero__lines">
            <div>
              <div className="hero__line-lbl">Lands in</div>
              <div className="hero__line-val">{fmtDuration(remaining)}</div>
            </div>
            <div>
              <div className="hero__line-lbl">Arriving</div>
              <div className="hero__line-val">{fmtTime(flight.arrive)} {to.tz}</div>
            </div>
            <div>
              <div className="hero__line-lbl">Aircraft</div>
              <div className="hero__line-val">{flight.aircraft}</div>
            </div>
          </div>
          <button className="hero__more" onClick={() => onOpen(flight)}>
            Open flight details →
          </button>
        </div>
        <div className="hero__right">
          <RouteMap from={from} to={to} progress={flight.progress ?? 0} status="airborne" height={360} />
        </div>
      </div>
      {flight.note && (
        <div className="hero__note">
          <span className="hero__note-kicker">{travelers[0]?.first} wrote</span>
          <span>"{flight.note}"</span>
        </div>
      )}
    </section>
  );
}

// ── HeroBoarding (shown when nobody's airborne, but someone's leaving soon) ──
function HeroBoarding({ flight, now, onOpen }) {
  const from = { ...airport(flight.from), code: flight.from };
  const to   = { ...airport(flight.to),   code: flight.to };
  const travelers = flight.travelers.map(familyById).filter(Boolean);
  const lead = travelers.map((p) => p.first).join(" & ");
  return (
    <section className="hero hero--soon" data-screen-label="01 Hero Boarding">
      <div className="hero__top">
        <div className="hero__kicker">
          <span className="hero__live-dot hero__live-dot--soon" />
          Next departure
        </div>
        <span className="hero__chip hero__chip--soon">Taking off soon</span>
      </div>
      <div className="hero__layout">
        <div className="hero__left">
          <AvatarStack ids={flight.travelers} size={56} />
          <h1 className="hero__headline">
            <span className="hero__name">{lead}</span>
            <span className="hero__verb"> takes off in…</span>
          </h1>
          <Countdown target={flight.depart} dramatic now={now} />
          <p className="hero__sub">
            {flight.airline}{flight.number} · {from.city} ({flight.from}) → {to.city} ({flight.to}) · {fmtTime(flight.depart)} {from.tz}
          </p>
          <button className="hero__more" onClick={() => onOpen(flight)}>
            Open flight details →
          </button>
        </div>
        <div className="hero__right">
          <RouteMap from={from} to={to} progress={0} status="scheduled" height={360} />
        </div>
      </div>
    </section>
  );
}

// ── TravelersView ───────────────────────────────────────────────────────────
function TravelersView({ allFlights, now, onSelectPerson }) {
  // Build per-person stats.
  const stats = FAMILY.map((p) => {
    const flown = allFlights.filter((f) => f.travelers.includes(p.id));
    const upcoming = flown.filter((f) => {
      const s = flightStatus(f, now);
      return s === "scheduled" || s === "boarding" || s === "airborne";
    }).length;
    const airborne = flown.find((f) => flightStatus(f, now) === "airborne");
    return { p, total: flown.length, upcoming, airborne };
  });

  return (
    <div className="travelers" data-screen-label="02 Travelers">
      <SectionHead kicker="The roster" title="Everyone tracked here" sub="Tap a face to see only their flights on the board." />
      <div className="travelers__grid">
        {stats.map(({ p, total, upcoming, airborne }) => (
          <button key={p.id} className="trav-card" onClick={() => onSelectPerson(p.id)}>
            <Avatar person={p} size={88} />
            <div className="trav-card__name">{p.nick ? <><span className="trav-card__nick">{p.nick}</span> · {p.first} {p.last}</> : <>{p.first} {p.last}</>}</div>
            <div className="trav-card__role">{p.role}</div>
            <div className="trav-card__home">📍 {p.home}</div>
            <div className="trav-card__stats">
              <div><strong>{total}</strong><span>flights</span></div>
              <div><strong>{upcoming}</strong><span>upcoming</span></div>
              <div data-air={airborne ? "1" : "0"}>
                <strong>{airborne ? "✈" : "—"}</strong><span>{airborne ? "in air" : "on ground"}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── ArchiveView ─────────────────────────────────────────────────────────────
function ArchiveView({ flights, now, onOpen }) {
  // Group by month-year string.
  const groups = {};
  for (const f of flights) {
    const key = f.depart.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    (groups[key] = groups[key] || []).push(f);
  }
  return (
    <div className="archive" data-screen-label="03 Archive">
      <SectionHead kicker="The travel diary" title="Where we've been"
                   sub="Every flight the family has logged, oldest at the bottom." />
      {Object.entries(groups).map(([month, items]) => (
        <div key={month} className="arch-group">
          <div className="arch-group__head">
            <span className="arch-group__when">{month}</span>
            <span className="arch-group__line" />
            <span className="arch-group__count">{items.length} trip{items.length === 1 ? "" : "s"}</span>
          </div>
          {items.map((f) => {
            const al = airline(f.airline);
            const from = airport(f.from), to = airport(f.to);
            const travelers = f.travelers.map(familyById).filter(Boolean);
            return (
              <button key={f.id} className="arch-row" onClick={() => onOpen(f)}>
                <div className="arch-row__date">{f.depart.toLocaleString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</div>
                <AvatarStack ids={f.travelers} size={26} />
                <div className="arch-row__route">
                  <span className="arch-row__code">{f.from}</span>
                  <span className="arch-row__arrow">→</span>
                  <span className="arch-row__code">{f.to}</span>
                </div>
                <div className="arch-row__cities">{from.city} → {to.city}</div>
                <div className="arch-row__flight"><span style={{ color: al.color }}>{f.airline}</span>{f.number}</div>
                <div className="arch-row__note">{f.note || ""}</div>
              </button>
            );
          })}
        </div>
      ))}
      {flights.length === 0 && <EmptyRow text="No past trips logged yet. The archive fills up over time." />}
    </div>
  );
}

// ── Footer ──────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <BrandMark />
          <div>
            <div className="footer__title">Mody-Gandhi Travel Tracker</div>
            <div className="footer__sub">Built for Dadaji · with love from the family</div>
          </div>
        </div>
        <div className="footer__cols">
          <div>
            <div className="footer__col-h">Status updates</div>
            <p>Positions here are simulated for now — soon this'll pull real gate-to-gate updates from FlightAware, so the board stays true the moment wheels leave the ground.</p>
          </div>
          <div>
            <div className="footer__col-h">Coming soon</div>
            <ul>
              <li>SMS to Grandpa when anyone takes off / lands</li>
              <li>Trip photo galleries after the flight</li>
              <li>Auto-import from Gmail confirmations</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="footer__copy">© 2026 · Made on a Tuesday afternoon</div>
    </footer>
  );
}

// ── tiny color utils ────────────────────────────────────────────────────────
function hexToRgb(h) {
  const x = h.replace("#", "");
  const v = x.length === 3 ? x.replace(/./g, (c) => c + c) : x.padEnd(6, "0");
  const n = parseInt(v.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
}
function mix(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a), [br, bg, bb] = hexToRgb(b);
  return rgbToHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t);
}
function isHexDark(h) {
  const [r, g, b] = hexToRgb(h);
  return r * 299 + g * 587 + b * 114 < 128000;
}

// ── Supabase row → app flight shape ─────────────────────────────────────────
function mapDbFlight(row) {
  return {
    id: row.id,
    airline: row.airline_code,
    number: row.flight_number,
    from: row.from_airport,
    to: row.to_airport,
    depart: new Date(row.depart_at),
    arrive: new Date(row.arrive_at),
    travelers: (row.flight_travelers || []).map((t) => t.family_member_id),
    aircraft: row.aircraft || undefined,
    seat: row.seat || undefined,
    gate: row.gate || undefined,
    terminal: row.terminal || undefined,
    confirmation: row.confirmation || undefined,
    note: row.note || undefined,
  };
}

// ── PasswordGate ────────────────────────────────────────────────────────────
// Stopgap only — NOT real access control. This just keeps the site from
// showing anyone who stumbles on the URL the family's travel details; the
// password itself ships in plain text in this JS file, and the Supabase
// reads behind it are open to anyone with the publishable key regardless of
// whether this gate is passed. Real protection (Supabase Auth + tightened
// RLS policies) is a separate, later step.
const GATE_PASSWORD = "moga";
const GATE_STORAGE_KEY = "mg_gate_ok";

function PasswordGate({ children }) {
  const [unlocked, setUnlocked] = React.useState(() => {
    try { return localStorage.getItem(GATE_STORAGE_KEY) === "1"; } catch (e) { return false; }
  });
  const [value, setValue] = React.useState("");
  const [error, setError] = React.useState(false);

  if (unlocked) return children;

  const submit = (e) => {
    e.preventDefault();
    if (value.trim().toLowerCase() === GATE_PASSWORD) {
      try { localStorage.setItem(GATE_STORAGE_KEY, "1"); } catch (e) {}
      setUnlocked(true);
    } else {
      setError(true);
    }
  };

  return (
    <div className="gate">
      <form className="gate__card" onSubmit={submit}>
        <BrandMark />
        <h1 className="gate__title">Mody-Gandhi Travel Tracker</h1>
        <p className="gate__sub">Family only — enter the password to see the board.</p>
        <input
          className="gate__input"
          type="password"
          autoFocus
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(false); }}
          placeholder="Password"
        />
        {error && <div className="gate__error">That's not it — try again.</div>}
        <button className="gate__btn" type="submit">Enter</button>
      </form>
    </div>
  );
}

// ── mount ───────────────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById("root")).render(
  <PasswordGate><App /></PasswordGate>
);
