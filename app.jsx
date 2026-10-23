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
  const [editingFlight, setEditingFlight] = React.useState(null);
  const [returnPrefill, setReturnPrefill] = React.useState(null);
  const [filterIds, setFilterIds] = React.useState([]);

  // Real flights, fetched from Supabase — merged alongside the curated demo
  // data in FLIGHTS rather than replacing it, so the board still has
  // something to show before anyone's added a real one. A failed/pending
  // fetch just leaves this empty; nothing else breaks.
  const [dbFlights, setDbFlights] = React.useState([]);
  // get_board() (schema.sql) returns only what this signed-in viewer may see
  // — full detail for their own and their close circles' trips, dates and
  // cities only for people they just follow.
  const refreshFlights = React.useCallback(() => {
    if (!window.supabaseClient) return;
    window.supabaseClient
      .rpc("get_board")
      .then(({ data, error }) => {
        if (error) { console.error("Couldn't load flights from Supabase:", error.message); return; }
        setDbFlights((data || []).map(mapDbFlight));
      });
  }, []);
  React.useEffect(() => { refreshFlights(); }, [refreshFlights]);

  // The family roster — FAMILY (data.js) starts as a hardcoded array (the
  // original 11 seeded members) and this fetch both keeps it in sync (home
  // airport edited from the Travelers tab, etc.) and grows it: anyone added
  // later via save-person (a new profile, or a one-trip guest) exists only
  // in Supabase until this pushes a matching entry onto FAMILY. Mutating in
  // place — updating an existing person's fields, pushing a new object for
  // an id we haven't seen — is what lets everything else in the app keep
  // reading the bare FAMILY array/familyById() without knowing any of this
  // is happening; bumping this counter is just what forces React to notice.
  const [, setFamilyVersion] = React.useState(0);
  // get_people() returns everyone this viewer has a reason to see, plus how
  // each relates to them (follows, close circle, whether they can add trips
  // for that person) — the People tab and the traveler pickers read those.
  const refreshFamily = React.useCallback(() => {
    if (!window.supabaseClient) return;
    window.supabaseClient
      .rpc("get_people")
      .then(({ data, error }) => {
        if (error) { console.error("Couldn't load people from Supabase:", error.message); return; }
        const next = [];
        for (const row of data || []) {
          const fields = {
            first: row.first_name, last: row.last_name,
            nick: row.nickname || undefined, role: row.role || undefined,
            home: row.home_city || null, homeAirport: row.home_airport || null,
            tone: row.tone || 1, isGuest: !!row.is_guest,
            claimed: !!row.claimed, isMe: !!row.is_me,
            iFollow: row.i_follow || null, followsMe: row.follows_me || null,
            inMyCircle: !!row.in_my_circle, inTheirCircle: !!row.in_their_circle,
            canManage: !!row.can_manage,
          };
          const existing = familyById(row.id);
          next.push(existing ? Object.assign(existing, fields) : { id: row.id, photo: null, ...fields });
        }
        // Replace, never just add: after a sign-out and a different sign-in,
        // the previous person's people (and what they could manage) must not
        // linger in the pickers.
        FAMILY.splice(0, FAMILY.length, ...next);
        setFamilyVersion((v) => v + 1);
      });
  }, []);
  React.useEffect(() => { refreshFamily(); }, [refreshFamily]);

  const allFlights = [...FLIGHTS, ...dbFlights];

  // Group legs sharing a journeyId into one journey item — everything else
  // (including a journeyId whose only partner got deleted) stays solo. See
  // buildJourneys in data.js. Then, separately, pair up an outbound/return
  // that are both still upcoming into one roundtrip item (see
  // pairRoundTrips) — round-trip legs aren't linked by any id the way a
  // connecting journey's are, so this re-derives the pairing every render
  // rather than depending on how the trip was originally logged.
  const boardItems = React.useMemo(
    () => window.MGData.pairRoundTrips(window.MGData.buildJourneys(allFlights), now),
    [allFlights, now]
  );
  const soloFlights = React.useMemo(() => boardItems.filter((i) => i.kind === "solo").map((i) => i.flight), [boardItems]);
  const journeyItems = React.useMemo(() => boardItems.filter((i) => i.kind === "journey"), [boardItems]);
  const roundTripItems = React.useMemo(() => boardItems.filter((i) => i.kind === "roundtrip"), [boardItems]);

  // Bucket solo flights by status — unchanged from before journeys existed;
  // this is what the hero sections key off of. Journeys don't get the big
  // hero treatment (just a rail card, identical in style to a nonstop card —
  // see JourneyCard) since the hero's live-progress framing assumes one
  // continuous flight, not a multi-leg trip with a layover in the middle.
  const byStatus = React.useMemo(() => {
    const buckets = { airborne: [], boarding: [], scheduled: [], landed: [], past: [] };
    for (const f of soloFlights) {
      const s = flightStatus(f, now);
      buckets[s].push(f);
    }
    // Real instants, not the stored airport-local digits — two flights from
    // different time zones sort wrong otherwise, and boarding[0] is what the
    // "Next departure" hero features.
    const dep = flightRealDepart, arr = flightRealArrive;
    buckets.airborne.sort((a, b) => arr(a) - arr(b));
    buckets.boarding.sort((a, b) => dep(a) - dep(b));
    buckets.scheduled.sort((a, b) => dep(a) - dep(b));
    buckets.landed.sort((a, b) => arr(b) - arr(a)); // most recent first
    buckets.past.sort((a, b) => dep(b) - dep(a));
    return buckets;
  }, [soloFlights, now]);

  // Journeys, bucketed the same way (a "layover" reads into the same rail as
  // "taking off soon" — both are time-sensitive, happening-right-now cards).
  const journeyByStatus = React.useMemo(() => {
    const buckets = { airborne: [], boarding: [], scheduled: [], landed: [] };
    for (const item of journeyItems) {
      let s = window.MGData.itemStatus(item, now);
      if (s === "layover") s = "boarding";
      if (buckets[s]) buckets[s].push(item);
    }
    const dep = (item) => flightRealDepart(item.legs[0]);
    const arr = (item) => flightRealArrive(item.legs[item.legs.length - 1]);
    buckets.airborne.sort((a, b) => arr(a) - arr(b));
    buckets.boarding.sort((a, b) => dep(a) - dep(b));
    buckets.scheduled.sort((a, b) => dep(a) - dep(b));
    buckets.landed.sort((a, b) => arr(b) - arr(a));
    return buckets;
  }, [journeyItems, now]);

  // Person filter — applied across all buckets.
  const f = (list) => filterIds.length ? list.filter((x) => x.travelers.some((id) => filterIds.includes(id))) : list;
  const fj = (list) => filterIds.length ? list.filter((x) => x.summary.travelers.some((id) => filterIds.includes(id))) : list;
  const frt = (list) => filterIds.length ? list.filter((x) => x.outbound.travelers.some((id) => filterIds.includes(id))) : list;

  // AddTripModal does its own saving (via the save-flight Edge Function) —
  // this just re-syncs the board once it's done.
  const handleSubmit = () => refreshFlights();

  // "Connects to X — link as one trip?" — the retroactive counterpart to the
  // "add a connecting flight" flow at upload time, for two legs that got
  // logged separately. Just sets a shared journey_id on both rows.
  const handleLinkConnection = (flightA, flightB) => {
    window.supabaseClient.functions.invoke("save-flight", {
      body: { linkFlightIds: [flightA.id, flightB.id] },
    }).then(({ data, error }) => {
      if (error || !data || !data.ok) { console.error("Couldn't link flights:", error || data); return; }
      refreshFlights();
    });
  };

  // "Return not logged" isn't always right — a home-city match the app
  // doesn't know about yet, or a flight that genuinely has no return
  // planned. Dismiss records that decision once, for everyone, rather than
  // guessing harder or hiding it only on the device that clicked dismiss.
  const handleDismissReturn = (flight) => {
    window.supabaseClient.functions.invoke("save-flight", {
      body: { dismissReturn: true, flightId: flight.id },
    }).then(({ data, error }) => {
      if (error || !data || !data.ok) { console.error("Couldn't dismiss:", error || data); return; }
      refreshFlights();
    });
  };

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
          <Board
            buckets={{
              airborne: f(byStatus.airborne),
              boarding: f(byStatus.boarding),
              scheduled: f(byStatus.scheduled),
              landed: f(byStatus.landed),
            }}
            journeyBuckets={{
              airborne: fj(journeyByStatus.airborne),
              boarding: fj(journeyByStatus.boarding),
              scheduled: fj(journeyByStatus.scheduled),
              landed: fj(journeyByStatus.landed),
            }}
            roundTripItems={frt(roundTripItems)}
            allFlights={allFlights}
            now={now}
            heroOn
            onOpen={setOpenFlight}
            onAdd={() => setAddOpen(true)}
            onAddReturn={(flight) => setReturnPrefill({ from: flight.to, to: flight.from, travelers: flight.travelers, mode: flight.mode })}
            onLinkConnection={handleLinkConnection}
            onDismissReturn={handleDismissReturn}
          />
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
          <TravelersView allFlights={allFlights} now={now} onSelectPerson={(id) => { setFilterIds([id]); setView("board"); }} onFamilyChanged={refreshFamily} />
        )}
      </main>

      <Footer />

      <FlightDetailModal
        flight={openFlight}
        onClose={() => setOpenFlight(null)}
        now={now}
        allFlights={allFlights}
        onEdit={(f) => { setOpenFlight(null); setEditingFlight(f); }}
        onDeleted={refreshFlights}
        onAddReturn={(f) => { setOpenFlight(null); setReturnPrefill({ from: f.to, to: f.from, travelers: f.travelers, mode: f.mode }); }}
        onDismissReturn={(f) => { handleDismissReturn(f); setOpenFlight(null); }}
      />
      {/* Every new trip goes through AddTripFlow (add-trip.jsx); the older
          form only handles editing a flight that's already saved. */}
      <AddTripFlow
        open={addOpen || !!returnPrefill}
        onClose={() => { setAddOpen(false); setReturnPrefill(null); }}
        onSubmit={handleSubmit}
        prefill={returnPrefill}
        allFlights={allFlights}
        onFamilyChanged={refreshFamily}
      />
      <AddTripModal
        open={!!editingFlight}
        onClose={() => setEditingFlight(null)}
        onSubmit={handleSubmit}
        editing={editingFlight}
        onFamilyChanged={refreshFamily}
      />

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
        <button data-active={view === "travelers"} onClick={() => setView("travelers")}>People</button>
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
            {FAMILY.filter((p) => !p.isGuest).map((p) => {
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
function Board({ buckets, journeyBuckets, roundTripItems, now, heroOn, onOpen, onAdd, allFlights, onAddReturn, onLinkConnection, onDismissReturn }) {
  const rt = roundTripItems || [];
  const jb = journeyBuckets || { airborne: [], boarding: [], scheduled: [], landed: [] };
  const airborne = buckets.airborne;
  const anyAirborne = airborne.length > 0 || jb.airborne.length > 0;
  const showBoardingHero = heroOn && !anyAirborne && buckets.boarding.length > 0;
  const boardingHeroFlight = showBoardingHero ? buckets.boarding[0] : null;
  // Boarding flights NOT already used in the hero — feed the "Taking off soon" rail.
  const remainingBoarding = buckets.boarding.filter((f) => f !== boardingHeroFlight);

  // One shared world map for everyone currently airborne, instead of a big
  // tile per flight — a journey contributes whichever leg is actually in the
  // air right now. Cards for all of them still follow right below.
  const mapItems = [
    ...airborne.map((f) => ({ key: f.id, from: airport(f.from), to: airport(f.to), progress: flightProgress(f, now) })),
    ...jb.airborne.map((item) => {
      const leg = item.legs.find((l) => flightStatus(l, now) === "airborne");
      return leg ? { key: item.id, from: airport(leg.from), to: airport(leg.to), progress: flightProgress(leg, now) } : null;
    }).filter(Boolean),
  ];

  // "Taking off soon" and "on the horizon" are really both just "hasn't
  // happened yet" from a board-ordering standpoint — merged into one
  // Upcoming rail; each card's own status pill still says "Taking off soon"
  // vs "Upcoming" so the urgency distinction isn't lost, just not a whole
  // separate section for it.
  const upcomingCount = remainingBoarding.length + buckets.scheduled.length + jb.boarding.length + jb.scheduled.length + rt.length;

  // Every section mixes solo flights, journeys, and (for Upcoming) round-trip
  // pairs — each of those lists was already sorted on its own, but simply
  // rendering them one after another isn't chronological order overall (a
  // journey departing next week could render before a solo flight departing
  // tomorrow, just because journeys are a separate list). Merge each
  // section's items into one list and sort by the same real-time basis
  // before rendering, so the board reads top-to-bottom in actual time order.
  const airborneItems = [
    ...airborne.map((f) => ({ type: "flight", key: f.id, sortTime: flightRealArrive(f), flight: f })),
    ...jb.airborne.map((item) => {
      const leg = item.legs.find((l) => flightStatus(l, now) === "airborne") || item.legs[item.legs.length - 1];
      return { type: "journey", key: item.id, sortTime: flightRealArrive(leg), item };
    }),
  ].sort((a, b) => a.sortTime - b.sortTime); // soonest to land first

  const landedItems = [
    ...buckets.landed.map((f) => ({ type: "flight", key: f.id, sortTime: flightRealArrive(f), flight: f })),
    ...jb.landed.map((item) => ({ type: "journey", key: item.id, sortTime: flightRealArrive(item.legs[item.legs.length - 1]), item })),
  ].sort((a, b) => b.sortTime - a.sortTime); // most recently landed first

  const upcomingItems = [
    ...remainingBoarding.map((f) => ({ type: "flight", key: f.id, sortTime: flightRealDepart(f), flight: f })),
    ...jb.boarding.map((item) => ({ type: "journey", key: item.id, sortTime: flightRealDepart(item.legs[0]), item })),
    ...buckets.scheduled.map((f) => ({ type: "flight", key: f.id, sortTime: flightRealDepart(f), flight: f })),
    ...jb.scheduled.map((item) => ({ type: "journey", key: item.id, sortTime: flightRealDepart(item.legs[0]), item })),
    ...rt.map((item) => ({ type: "roundtrip", key: item.id, sortTime: flightRealDepart(item.outbound), item })),
  ].sort((a, b) => a.sortTime - b.sortTime); // soonest departure first

  return (
    <div className="board" data-screen-label="01 Board">
      {showBoardingHero && (
        <HeroBoarding flight={boardingHeroFlight} now={now} onOpen={onOpen} />
      )}

      {/* In the air — always first. One shared map above the cards. */}
      {anyAirborne && (
        <section className="rail">
          <SectionHead kicker="Right now" title="In the air" count={airborne.length + jb.airborne.length} />
          {heroOn && mapItems.length > 0 && (
            <div className="active-map-wrap">
              <ActiveJourneysMap items={mapItems} height={260} />
            </div>
          )}
          <div className="rail__grid">
            {airborneItems.map((u) => u.type === "flight"
              ? <FlightCard key={u.key} flight={u.flight} onOpen={onOpen} now={now} />
              : <JourneyCard key={u.key} item={u.item} onOpen={onOpen} now={now} />
            )}
          </div>
        </section>
      )}

      {/* Just landed — next, and only for 8 hours after arrival (see
          flightStatus in data.js); after that it's "past" and drops off
          the board entirely, still visible in Calendar. */}
      {(buckets.landed.length > 0 || jb.landed.length > 0) && (
        <section className="rail rail--landed">
          <SectionHead kicker="Last 8 hours" title="Just landed" count={buckets.landed.length + jb.landed.length} />
          <div className="rail__grid">
            {landedItems.map((u) => u.type === "flight"
              ? <FlightCard key={u.key} flight={u.flight} onOpen={onOpen} now={now} allFlights={allFlights} onAddReturn={onAddReturn} onLinkConnection={onLinkConnection} onDismissReturn={onDismissReturn} />
              : <JourneyCard key={u.key} item={u.item} onOpen={onOpen} now={now} />
            )}
          </div>
        </section>
      )}

      {/* Upcoming — last: taking-off-soon and further-out scheduled trips together. */}
      <section className="rail">
        <SectionHead kicker="What's next" title="Upcoming" count={upcomingCount} />
        {upcomingCount === 0
          ? <EmptyRow text="No upcoming trips. Tell the family to start planning something!" />
          : (
            <div className="rail__grid">
              {upcomingItems.map((u) => {
                if (u.type === "flight") {
                  return <FlightCard key={u.key} flight={u.flight} onOpen={onOpen} now={now} allFlights={allFlights} onAddReturn={onAddReturn} onLinkConnection={onLinkConnection} onDismissReturn={onDismissReturn} />;
                }
                if (u.type === "roundtrip") {
                  return <RoundTripCard key={u.key} item={u.item} onOpen={onOpen} now={now} />;
                }
                return <JourneyCard key={u.key} item={u.item} onOpen={onOpen} now={now} />;
              })}
            </div>
          )
        }
      </section>

      {/* CTA */}
      <section className="cta">
        <div className="cta__inner">
          <div>
            <h3>Booked a flight?</h3>
            <p>Drop in a screenshot of the booking — every flight in it, outbound and return, lands on the board.</p>
          </div>
          <div className="cta__row">
            <button className="cta__btn" onClick={onAdd}>＋ Add a trip</button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── HeroBoarding (shown when nobody's airborne, but someone's leaving soon) ──
function HeroBoarding({ flight, now, onOpen }) {
  const isFlight = modeOf(flight) === "flight";
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
          <Countdown target={flightRealDepart(flight)} dramatic now={now} />
          <p className="hero__sub">
            {isFlight ? <>{flight.airline}{flight.number} · </> : <>{modeMeta(flight).icon} {modeMeta(flight).label} · </>}
            {from.city} ({flight.from}) → {to.city} ({flight.to}) · {fmtTime(flight.depart)} {from.tz}
          </p>
          <button className="hero__more" onClick={() => onOpen(flight)}>
            Open flight details →
          </button>
        </div>
        <div className="hero__right">
          {isFlight && hasCoords(from, to)
            ? <RouteMap from={from} to={to} progress={0} status="scheduled" height={360} />
            : <div className="tcard__mode-block" style={{ height: 360 }}>{modeMeta(flight).icon}</div>}
        </div>
      </div>
    </section>
  );
}

// ── TravelersView ───────────────────────────────────────────────────────────
function TravelersView({ allFlights, now, onSelectPerson, onFamilyChanged }) {
  const [addPersonOpen, setAddPersonOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [inviteFor, setInviteFor] = React.useState(null); // a not-yet-joined profile, or null for anyone

  // Guests (added just for one trip — see is_guest, schema.sql) don't belong
  // on the general roster, and someone whose only link to the viewer is a
  // pending request shows under Requests instead. The viewer comes first.
  const roster = FAMILY
    .filter((p) => !p.isGuest)
    .filter((p) => !(p.followsMe === "pending" && !p.iFollow && !p.inMyCircle && !p.inTheirCircle && !p.canManage))
    .sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0));
  const openInvite = (profile) => { setInviteFor(profile || null); setInviteOpen(true); };

  // Build per-person stats.
  const stats = roster.map((p) => {
    const flown = allFlights.filter((f) => f.travelers.includes(p.id));
    const upcoming = flown.filter((f) => {
      const s = flightStatus(f, now);
      return s === "scheduled" || s === "boarding" || s === "airborne";
    }).length;
    const airborne = flown.find((f) => flightStatus(f, now) === "airborne");
    return { p, total: flown.length, upcoming, airborne };
  });

  // Photo upload — resize/re-encode client-side (same helper the boarding-pass
  // upload uses, from modals.jsx), then hand it to the upload-photo Edge
  // Function, which writes it to the public family-photos bucket at a
  // deterministic `${personId}.jpg` path. Avatar just looks that path up
  // directly, so a full reload is the simplest way to make sure every avatar
  // on the page picks up the new photo (and stops showing a cached 404).
  const [uploadingFor, setUploadingFor] = React.useState(null);
  const [photoError, setPhotoError] = React.useState(null);

  const handlePhotoSelect = (personId, e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploadingFor(personId);
    setPhotoError(null);

    resizeImageForUpload(file).then((blob) => {
      const reader = new FileReader();
      reader.onerror = () => { setUploadingFor(null); setPhotoError("Couldn't read that photo — try a different file?"); };
      reader.onload = () => {
        const base64 = String(reader.result).split(",")[1];
        window.supabaseClient.functions.invoke("upload-photo", {
          body: { personId, image: base64, mediaType: "image/jpeg" },
        }).then(({ data, error }) => {
          if (error || !data || !data.ok) {
            setUploadingFor(null);
            setPhotoError((data && data.error) || "Couldn't upload that photo — mind trying again?");
            return;
          }
          window.location.reload();
        }).catch((err) => {
          setUploadingFor(null);
          setPhotoError(String((err && err.message) || err));
        });
      };
      reader.readAsDataURL(blob);
    }).catch((err) => {
      setUploadingFor(null);
      setPhotoError(String((err && err.message) || err));
    });
  };

  // Home airport — editable inline, right on the card. This is what
  // suppresses the "return not logged" nudge when someone lands exactly
  // where they live (see isHomeArrival, data.js), so it needs to be
  // something anyone in the family can correct without asking for help.
  const [homeEditing, setHomeEditing] = React.useState(null); // personId
  const [homeDraft, setHomeDraft] = React.useState("");
  const [homeSaving, setHomeSaving] = React.useState(false);
  const [homeError, setHomeErrorFor] = React.useState(null);

  const startEditingHome = (p) => {
    setHomeEditing(p.id);
    setHomeDraft(p.homeAirport ? placeDisplay(p.homeAirport) : "");
    setHomeErrorFor(null);
  };

  const saveHome = (personId) => {
    const code = homeDraft ? placeCode(homeDraft) : null;
    setHomeSaving(true);
    window.supabaseClient.functions.invoke("update-home", {
      body: { personId, homeAirport: code },
    }).then(({ data, error }) => {
      setHomeSaving(false);
      if (error || !data || !data.ok) {
        setHomeErrorFor((data && data.error) || "Couldn't save that — mind trying again?");
        return;
      }
      setHomeEditing(null);
      onFamilyChanged();
    }).catch((err) => {
      setHomeSaving(false);
      setHomeErrorFor(String((err && err.message) || err));
    });
  };

  return (
    <div className="travelers" data-screen-label="02 Travelers">
      <SectionHead kicker="Your people" title="Who you're connected to" sub="Tap a face to see only their trips on the board. Your close circle sees your flight details; everyone else who follows you sees dates and cities." />
      <div className="pp__actions">
        <button className="cta__btn" onClick={() => openInvite(null)}>＋ Invite someone</button>
        <button className="pp__signout" onClick={() => window.supabaseClient.auth.signOut()}>Sign out</button>
      </div>
      <FollowRequests people={FAMILY} onChanged={() => { onFamilyChanged(); }} />
      {photoError && <div className="travelers__error">{photoError}</div>}
      <div className="travelers__grid">
        {stats.map(({ p, total, upcoming, airborne }) => (
          <div key={p.id} className="trav-card">
            <button className="trav-card__hit" onClick={() => onSelectPerson(p.id)}>
              <Avatar person={p} size={64} />
              <div className="trav-card__name">{p.nick ? <><span className="trav-card__nick">{p.nick}</span> · {p.first} {p.last}</> : <>{p.first} {p.last}</>}</div>
              {p.role && <div className="trav-card__role">{p.role}</div>}
              <div className="trav-card__stats">
                <div><strong>{total}</strong><span>flights</span></div>
                <div><strong>{upcoming}</strong><span>upcoming</span></div>
                <div data-air={airborne ? "1" : "0"}>
                  <strong>{airborne ? "✈" : "—"}</strong><span>{airborne ? "in air" : "on ground"}</span>
                </div>
              </div>
            </button>
            {p.canManage && <label
              className="trav-card__photo-btn"
              htmlFor={`trav-photo-${p.id}`}
              onClick={(e) => e.stopPropagation()}
              title={`Add or change ${p.first}'s photo`}
              data-busy={uploadingFor === p.id ? "1" : "0"}
            >
              <input
                id={`trav-photo-${p.id}`}
                type="file"
                accept="image/*"
                disabled={uploadingFor === p.id}
                onChange={(e) => handlePhotoSelect(p.id, e)}
                style={{ display: "none" }}
              />
              {uploadingFor === p.id ? (
                <span className="trav-card__photo-spinner" aria-hidden="true">…</span>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 8h3l1.6-2.2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
                    <circle cx="12" cy="13.2" r="3.1" />
                  </svg>
                  <span className="trav-card__photo-badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 19V6M6 11l6-6 6 6" />
                    </svg>
                  </span>
                </>
              )}
            </label>}
            <div className="trav-card__home" onClick={(e) => e.stopPropagation()}>
              {homeEditing === p.id ? (
                <div className="trav-card__home-edit">
                  <input
                    list="trav-airport-list"
                    value={homeDraft}
                    onChange={(e) => setHomeDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") saveHome(p.id); if (e.key === "Escape") setHomeEditing(null); }}
                    placeholder="City or airport"
                    autoFocus
                  />
                  <div className="trav-card__home-actions">
                    <button onClick={() => saveHome(p.id)} disabled={homeSaving}>{homeSaving ? "…" : "Save"}</button>
                    <button onClick={() => setHomeEditing(null)} disabled={homeSaving}>Cancel</button>
                  </div>
                </div>
              ) : p.canManage ? (
                <button className="trav-card__home-btn" onClick={() => startEditingHome(p)}>
                  🏠 {p.homeAirport ? airport(p.homeAirport).city : "Set home city"}
                </button>
              ) : p.homeAirport ? (
                <span className="trav-card__home-btn">🏠 {airport(p.homeAirport).city}</span>
              ) : null}
              {homeError && homeEditing === p.id && <div className="trav-card__home-error">{homeError}</div>}
            </div>
            <RelationControls p={p} onInvite={openInvite} onChanged={onFamilyChanged} />
          </div>
        ))}
        <button className="trav-card trav-card--add" onClick={() => setAddPersonOpen(true)}>
          <span className="trav-card__add-icon" aria-hidden="true">＋</span>
          <span>Add someone</span>
        </button>
      </div>
      <datalist id="trav-airport-list">
        {Object.entries(AIRPORTS).map(([code, a]) => (
          <option key={code} value={`${a.city} (${code})`}>{a.city}, {a.country}</option>
        ))}
      </datalist>
      <AddPersonModal
        open={addPersonOpen}
        onClose={() => setAddPersonOpen(false)}
        onCreated={() => onFamilyChanged()}
      />
      <InviteModal open={inviteOpen} profile={inviteFor} onClose={() => { setInviteOpen(false); onFamilyChanged(); }} />
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
            <div className="footer__sub">Built with love, for the family</div>
          </div>
        </div>
      </div>
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

// ── get_board() row → app flight shape ──────────────────────────────────────
// `limited` rows (someone you follow but aren't in the close circle of) have
// no airline, number, clock times or note — depart/arrive are just the
// calendar day. Cards and statuses check `limited` instead of pretending to
// know the time (see flightStatus in data.js).
function mapDbFlight(row) {
  return {
    id: row.id,
    mode: row.mode || "flight",
    airline: row.airline_code,
    number: row.flight_number,
    from: row.from_airport,
    to: row.to_airport,
    depart: new Date(row.depart_at),
    arrive: new Date(row.arrive_at),
    journeyId: row.journey_id || null,
    returnDismissed: !!row.return_dismissed,
    travelers: row.travelers || [],
    note: row.note || undefined,
    limited: row.detail === "limited",
  };
}

// ── mount ───────────────────────────────────────────────────────────────────
// Sign-in (auth.jsx) replaces the old shared password: the board only renders
// for a signed-in account attached to a profile.
ReactDOM.createRoot(document.getElementById("root")).render(
  <AuthGate><App /></AuthGate>
);
