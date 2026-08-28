// bulk-upload.jsx — BulkUploadModal: upload many boarding passes at once,
// then confirm each one before it's added to the board. Every helper here
// (resizeImageForUpload, withTimeout, readFunctionError, placeDisplay,
// placeCode, buildDepartArrive, matchTravelerByName, EMPTY_TRIP_FORM) comes
// straight from modals.jsx — a card in this review queue is the same trip
// form AddTripModal already uses, just shown one at a time in a stack
// instead of alone. Deliberately flight-only (no train/car/round-trip/
// connecting-leg options) — those are rare enough to add one at a time
// through the regular flow; this is for the common case of a pile of
// boarding-pass photos from one trip.

const MAX_BULK_FILES = 20;
const BULK_CONCURRENCY = 3;

// Runs `worker` over `items` with at most `limit` in flight at once. Plain
// concurrency cap rather than firing every parse-flight call at once — a
// burst of 15+ simultaneous Claude API calls is both slow to land (contends
// for the same rate limit) and a worse "reading your photos" experience
// than a steady trickle of completions.
function runPool(items, limit, worker) {
  return new Promise((resolve) => {
    if (items.length === 0) { resolve(); return; }
    let next = 0, done = 0;
    const startNext = () => {
      const i = next++;
      if (i >= items.length) return;
      worker(items[i], i).then(() => {
        done++;
        if (done === items.length) resolve();
        else startNext();
      });
    };
    for (let k = 0; k < Math.min(limit, items.length); k++) startNext();
  });
}

// Two draft cards describe "the same flight" when the essentials line up
// exactly — used to auto-merge separate boarding passes (one family's
// several tickets for one flight) into a single card with everyone listed
// as a traveler, instead of quietly creating duplicate flights on the
// board. Deliberately narrow (exact date + exact departure time + matching
// cities) so it only catches genuine duplicates, not two different flights
// that happen to share a route.
function sameTripSlot(a, b) {
  if (!a.date || !b.date || a.date !== b.date) return false;
  if (!a.departTime || !b.departTime || a.departTime !== b.departTime) return false;
  if (!a.from || !b.from || !a.to || !b.to) return false;
  return window.MGData.placesMatch(placeCode(a.from), placeCode(b.from)) &&
    window.MGData.placesMatch(placeCode(a.to), placeCode(b.to));
}

function formFromParsed(p) {
  const matchedTraveler = matchTravelerByName(p.passenger_name);
  return {
    travelers: matchedTraveler ? [matchedTraveler] : [],
    airline: (p.airline_code || "").toUpperCase(),
    number: p.flight_number || "",
    from: p.from_airport ? placeDisplay(p.from_airport) : "",
    to: p.to_airport ? placeDisplay(p.to_airport) : "",
    date: p.date || "",
    departTime: p.depart_time || "",
    arriveTime: p.arrive_time || "",
    arriveNextDay: !!p.arrives_next_day,
    note: "",
  };
}

function newCard(id, file) {
  return {
    id,
    thumbUrls: [URL.createObjectURL(file)],
    status: "parsing", // parsing | ready | error | merged
    mergedInto: null,
    parsed: null,
    error: null,
    form: { ...EMPTY_TRIP_FORM },
    outcome: "pending", // pending | accepted | discarded
    savedFlightId: null,
    saving: false,
    saveError: null,
    mergedCount: 1,
  };
}

async function parseCardFile(file) {
  try {
    const blob = await resizeImageForUpload(file);
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("Couldn't read that file — try a different one?"));
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.readAsDataURL(blob);
    });
    const { data, error } = await withTimeout(
      window.supabaseClient.functions.invoke("parse-flight", { body: { image: base64, mediaType: "image/jpeg" } }),
      30000, "Reading"
    );
    if (error || !data || !data.ok) {
      const message = (data && data.error) || await readFunctionError(error) || "Couldn't read that image.";
      return { ok: false, error: message };
    }
    return { ok: true, parsed: data.parsed };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

// ── The per-trip form — same fields AddTripModal uses for a plain flight ────
function BulkTripFields({ card, onChange, onToggleTraveler }) {
  const f = card.form;
  return (
    <div className="bu__card">
      <div className="bu__card-thumbs">
        {card.thumbUrls.map((url, i) => (
          <img key={i} src={url} alt="" className="bu__card-thumb" />
        ))}
      </div>

      {card.mergedCount > 1 && (
        <div className="at__parsed">
          <div className="at__parsed-mark">⇄</div>
          <div>Merged {card.mergedCount} boarding passes for the same flight — travelers combined below. Remove anyone who shouldn't be on it.</div>
        </div>
      )}
      {card.status === "error" && (
        <div className="at__parsed at__parsed--error">
          <div className="at__parsed-mark">!</div>
          <div>{card.error} Fill in the details by hand below.</div>
        </div>
      )}
      {card.status === "ready" && card.parsed && card.mergedCount === 1 && (
        <div className="at__parsed">
          <div className="at__parsed-mark">✓</div>
          <div>
            <strong>Got it!</strong> {card.parsed.airline_code || "—"}{card.parsed.flight_number || ""}
            {card.parsed.from_airport && card.parsed.to_airport ? `, ${card.parsed.from_airport} → ${card.parsed.to_airport}` : ""}.
            Double-check the fields below.
          </div>
        </div>
      )}

      <div className="at__row">
        <label className="at__field">
          <span>Airline (optional)</span>
          <input list="bu-airline-list" value={f.airline} onChange={(e) => onChange({ airline: e.target.value.toUpperCase() })} placeholder="UA" />
        </label>
        <label className="at__field">
          <span>Flight # (optional)</span>
          <input value={f.number} onChange={(e) => onChange({ number: e.target.value })} placeholder="286" />
        </label>
      </div>
      <div className="at__row">
        <label className="at__field">
          <span>From (city or airport)</span>
          <input list="bu-airport-list" value={f.from} onChange={(e) => onChange({ from: e.target.value })} placeholder="San Francisco" />
        </label>
        <label className="at__field">
          <span>To (city or airport)</span>
          <input list="bu-airport-list" value={f.to} onChange={(e) => onChange({ to: e.target.value })} placeholder="London" />
        </label>
      </div>
      <label className="at__field at__field--full">
        <span>Date</span>
        <input type="date" value={f.date} onChange={(e) => onChange({ date: e.target.value })} />
      </label>
      <div className="at__row at__row--times">
        <label className="at__field">
          <span>Depart</span>
          <input type="time" value={f.departTime} onChange={(e) => onChange({ departTime: e.target.value })} />
        </label>
        <label className="at__field">
          <span>Arrive</span>
          <input type="time" value={f.arriveTime} onChange={(e) => onChange({ arriveTime: e.target.value })} />
        </label>
      </div>
      <label className="at__checkbox at__checkbox--tight">
        <input type="checkbox" checked={f.arriveNextDay} onChange={(e) => onChange({ arriveNextDay: e.target.checked })} />
        <span>
          Arrives the next day
          {card.parsed?.arrives_next_day != null && <span className="at__auto-note"> (detected from your ticket)</span>}
        </span>
      </label>

      <div className="at__field at__field--full">
        <span>Who's traveling?</span>
        <div className="at__people">
          {FAMILY.map((p) => (
            <button key={p.id} type="button" className={`at__person ${f.travelers.includes(p.id) ? "on" : ""}`} onClick={() => onToggleTraveler(p.id)}>
              <Avatar person={p} size={28} />
              <span>{p.first}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BulkUploadModal({ open, onClose, onSubmit }) {
  const [phase, setPhase] = React.useState("select"); // select | parsing | review
  const [cards, setCards] = React.useState([]);
  const [activeIdx, setActiveIdx] = React.useState(0);
  const [capNotice, setCapNotice] = React.useState(null);
  const [closeConfirm, setCloseConfirm] = React.useState(false);

  const cardsRef = React.useRef([]);
  React.useEffect(() => { cardsRef.current = cards; }, [cards]);

  React.useEffect(() => {
    if (open) return undefined;
    const t = setTimeout(() => {
      cardsRef.current.forEach((c) => c.thumbUrls.forEach((u) => URL.revokeObjectURL(u)));
      setPhase("select"); setCards([]); setActiveIdx(0); setCapNotice(null); setCloseConfirm(false);
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  const handleFiles = (fileList) => {
    let files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (files.length > MAX_BULK_FILES) {
      setCapNotice(`Only the first ${MAX_BULK_FILES} were added — upload the rest as a second batch.`);
      files = files.slice(0, MAX_BULK_FILES);
    } else {
      setCapNotice(null);
    }

    const initial = files.map((file, i) => newCard(`${Date.now()}-${i}`, file));
    setCards(initial);
    setPhase("parsing");

    runPool(files, BULK_CONCURRENCY, async (file, i) => {
      const id = initial[i].id;
      const result = await parseCardFile(file);
      setCards((prev) => {
        if (!result.ok) {
          return prev.map((c) => c.id === id ? { ...c, status: "error", error: result.error } : c);
        }
        const form = formFromParsed(result.parsed);
        const match = prev.find((c) => c.id !== id && c.status === "ready" && sameTripSlot(c.form, form));
        if (match) {
          const thisCard = prev.find((c) => c.id === id);
          const mergedTravelers = Array.from(new Set([...match.form.travelers, ...form.travelers]));
          return prev.map((c) => {
            if (c.id === match.id) {
              return {
                ...c,
                form: { ...c.form, travelers: mergedTravelers },
                thumbUrls: [...c.thumbUrls, ...thisCard.thumbUrls],
                mergedCount: c.mergedCount + 1,
              };
            }
            if (c.id === id) return { ...c, status: "merged", mergedInto: match.id };
            return c;
          });
        }
        return prev.map((c) => c.id === id ? { ...c, status: "ready", parsed: result.parsed, form } : c);
      });
    }).then(() => setPhase("review"));
  };

  const visibleCards = cards.filter((c) => c.status !== "merged");
  const active = visibleCards[activeIdx] || null;

  const updateActiveForm = (patch) => {
    if (!active) return;
    const id = active.id;
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, form: { ...c.form, ...patch }, saveError: null } : c));
  };
  const toggleTraveler = (pid) => {
    if (!active) return;
    const travelers = active.form.travelers.includes(pid)
      ? active.form.travelers.filter((x) => x !== pid)
      : [...active.form.travelers, pid];
    updateActiveForm({ travelers });
  };

  const goTo = (idx) => setActiveIdx(Math.max(0, Math.min(visibleCards.length - 1, idx)));

  const acceptActive = () => {
    if (!active) return;
    const id = active.id;
    const f = active.form;
    const missing = [];
    if (!f.from) missing.push("where from");
    if (!f.to) missing.push("where to");
    if (!f.date) missing.push("the date");
    if (!f.departTime) missing.push("a departure time");
    if (!f.travelers.length) missing.push("who's traveling");
    if (missing.length) {
      setCards((prev) => prev.map((c) => c.id === id ? { ...c, saveError: `Still need: ${missing.join(", ")}.` } : c));
      return;
    }
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, saving: true, saveError: null } : c));
    const { departAt, arriveAt } = buildDepartArrive(f.date, f.departTime, f.arriveTime, f.arriveNextDay);
    const body = {
      flightId: active.savedFlightId || undefined,
      mode: "flight",
      airline_code: f.airline || null,
      flight_number: f.number || null,
      from_airport: placeCode(f.from),
      to_airport: placeCode(f.to),
      depart_at: departAt.toISOString(),
      arrive_at: arriveAt.toISOString(),
      note: f.note || null,
      source: "upload",
      travelerIds: f.travelers,
    };
    withTimeout(window.supabaseClient.functions.invoke("save-flight", { body }), 20000, "Saving")
      .then(async ({ data, error }) => {
        if (error || !data || !data.ok) {
          const message = (data && data.error) || await readFunctionError(error) || "Couldn't save this trip — mind trying again?";
          setCards((prev) => prev.map((c) => c.id === id ? { ...c, saving: false, saveError: message } : c));
          return;
        }
        setCards((prev) => prev.map((c) => c.id === id ? { ...c, saving: false, outcome: "accepted", savedFlightId: data.flight.id } : c));
        onSubmit();
        setActiveIdx((idx) => Math.min(idx + 1, visibleCards.length - 1));
      }).catch((err) => {
        setCards((prev) => prev.map((c) => c.id === id ? { ...c, saving: false, saveError: String((err && err.message) || err) } : c));
      });
  };

  const discardActive = () => {
    if (!active) return;
    const id = active.id;
    setCards((prev) => prev.map((c) => c.id === id ? { ...c, outcome: "discarded" } : c));
    goTo(activeIdx + 1);
  };

  const acceptedCount = cards.filter((c) => c.outcome === "accepted").length;
  const pendingCount = visibleCards.filter((c) => c.outcome === "pending").length;
  const readyCount = cards.filter((c) => c.status === "ready" || c.status === "error" || c.status === "merged").length;

  const requestClose = () => {
    if (phase === "review" && pendingCount > 0) { setCloseConfirm(true); return; }
    onClose();
  };

  return (
    <Modal open={open} onClose={requestClose} size="md">
      <div className="bu">
        <header className="at__head">
          <h2 className="at__title">Upload Multiple Trips</h2>
        </header>

        {phase === "select" && (
          <div className="bu__body">
            <p className="bu__intro">Select as many boarding passes as you like — you'll confirm each one before it's added to the board.</p>
            <label className="at__upload-cta" htmlFor="bu-file-input">
              <input id="bu-file-input" type="file" accept="image/*" multiple onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} style={{ display: "none" }} />
              <span className="at__upload-cta-icon">⬆</span>
              <span>Choose boarding pass images</span>
            </label>
            {capNotice && <div className="at__hint">{capNotice}</div>}
          </div>
        )}

        {phase === "parsing" && (
          <div className="bu__body">
            <div className="bu__progress">
              <span className="at__spinner" aria-hidden="true" />
              Reading {cards.length} boarding pass{cards.length === 1 ? "" : "es"}… {readyCount} of {cards.length} done
            </div>
            <div className="bu__thumbs">
              {cards.map((c) => (
                <div key={c.id} className={`bu__thumb bu__thumb--${c.status}`}>
                  <img src={c.thumbUrls[0]} alt="" />
                  <span className="bu__thumb-badge" aria-hidden="true">
                    {c.status === "parsing" && <span className="at__spinner" />}
                    {(c.status === "ready" || c.status === "merged") && "✓"}
                    {c.status === "error" && "!"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {phase === "review" && visibleCards.length === 0 && (
          <div className="bu__body">
            <div className="bu__empty">Nothing came through — every image failed to read. Try again, or add trips one at a time.</div>
          </div>
        )}

        {phase === "review" && active && (
          <div className="bu__body">
            <div className="bu__stage-head">
              <button className="bu__nav-btn" onClick={() => goTo(activeIdx - 1)} disabled={activeIdx === 0} aria-label="Previous trip">‹</button>
              <div className="bu__stage-count">
                Trip {activeIdx + 1} of {visibleCards.length}
                <span className="bu__stage-summary"> · {acceptedCount} saved</span>
              </div>
              <button className="bu__nav-btn" onClick={() => goTo(activeIdx + 1)} disabled={activeIdx === visibleCards.length - 1} aria-label="Next trip">›</button>
            </div>
            <div className="bu__dots">
              {visibleCards.map((c, i) => (
                <button
                  key={c.id}
                  className={`bu__dot bu__dot--${c.outcome} ${i === activeIdx ? "on" : ""}`}
                  onClick={() => goTo(i)}
                  aria-label={`Go to trip ${i + 1}`}
                  title={c.outcome === "accepted" ? "Saved" : c.outcome === "discarded" ? "Discarded" : "Not yet reviewed"}
                />
              ))}
            </div>

            <BulkTripFields card={active} onChange={updateActiveForm} onToggleTraveler={toggleTraveler} />

            {active.saveError && <div className="at__error">{active.saveError}</div>}
            <div className="at__actions bu__actions">
              <button className="at__secondary" onClick={discardActive} disabled={active.saving}>Discard</button>
              <button className="at__secondary" onClick={() => goTo(activeIdx + 1)} disabled={active.saving || activeIdx === visibleCards.length - 1}>Skip for now</button>
              <button className="at__primary" onClick={acceptActive} disabled={active.saving}>
                {active.saving
                  ? <><span className="at__spinner at__spinner--light" aria-hidden="true" /> Saving…</>
                  : active.outcome === "accepted" ? "Saved ✓ — update" : "Accept & add to board"}
              </button>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="bu__footer">
            {closeConfirm ? (
              <div className="bu__close-confirm">
                <span>{pendingCount} trip{pendingCount === 1 ? "" : "s"} not yet reviewed — close anyway?</span>
                <button className="at__secondary" onClick={() => setCloseConfirm(false)}>Keep reviewing</button>
                <button className="at__primary" onClick={onClose}>Close anyway</button>
              </div>
            ) : (
              <button className="at__secondary bu__done" onClick={requestClose}>
                {pendingCount === 0 ? "Done" : "Close"}
              </button>
            )}
          </div>
        )}

        <datalist id="bu-airline-list">
          {Object.entries(AIRLINES).map(([code, a]) => (
            <option key={code} value={code}>{code} — {a.name}</option>
          ))}
        </datalist>
        <datalist id="bu-airport-list">
          {Object.entries(AIRPORTS).map(([code, a]) => (
            <option key={code} value={`${a.city} (${code})`}>{a.city}, {a.country}</option>
          ))}
        </datalist>
      </div>
    </Modal>
  );
}

Object.assign(window, { BulkUploadModal });
