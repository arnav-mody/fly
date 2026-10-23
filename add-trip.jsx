// add-trip.jsx — AddTripFlow: the one way to add travel to the board.
//
// Three steps instead of a long form: drop in screenshots (or paste text, or
// type it in), check the trip the way it'll read on the board, save. Every
// screenshot can hold several legs — an outbound with a connection plus the
// return is one screenshot, one review, one save (see parse-flight's
// `multi` mode). Replaces both the old single-trip form and the separate
// bulk-upload queue for *new* trips; editing an existing flight still goes
// through AddTripModal (modals.jsx).
//
// Helpers shared with modals.jsx (all globals there): Modal, AddPersonModal,
// ArriveDayField, buildDepartArrive, resizeImageForUpload, withTimeout,
// readFunctionError, placeDisplay, placeCode, matchTravelerByName.

const ADD_MAX_FILES = 12;
const ADD_CONCURRENCY = 3;
const LAST_TRAVELERS_KEY = "mg_last_travelers";
// Two legs read as a connection (same journey card) when the second leaves
// from where the first landed within this window — the parser's own
// "connects to next" call wins when it made one.
const LINK_MIN_GAP = 20 * 60 * 1000;
const LINK_MAX_GAP = 24 * 60 * 60 * 1000;

// Runs `worker` over `items` with at most `limit` in flight at once — a burst
// of simultaneous Claude calls contends for the same rate limit and lands
// slower than a steady trickle.
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

let _legSeq = 0;
function newLeg(fields = {}) {
  return {
    id: `leg-${Date.now()}-${_legSeq++}`,
    mode: "flight", airline: "", number: "", from: "", to: "",
    date: "", departTime: "", arriveTime: "", arriveDayOffset: 0,
    direction: "unknown",
    connectsHint: null,   // parser's "connects to next" call: true / false / null
    linkNext: false,      // what the review screen currently shows
    lowConfidence: [], detectedOffset: false,
    source: "manual", expanded: false, dupChoice: null,
    ...fields,
  };
}

function legFromParsed(p, source) {
  return newLeg({
    mode: p.mode === "train" ? "train" : "flight",
    airline: (p.airline_code || "").toUpperCase(),
    number: p.flight_number || "",
    from: p.from_airport ? placeDisplay(p.from_airport) : "",
    to: p.to_airport ? placeDisplay(p.to_airport) : "",
    date: p.date || "",
    departTime: p.depart_time || "",
    arriveTime: p.arrive_time || "",
    arriveDayOffset: parsedDayOffset(p) ?? 0,
    detectedOffset: parsedDayOffset(p) != null,
    direction: p.direction || "unknown",
    connectsHint: typeof p.connects_to_next === "boolean" ? p.connects_to_next : null,
    lowConfidence: p.low_confidence_fields || [],
    source,
  });
}

const legReady = (leg) => !!(leg.from && leg.to && leg.date && leg.departTime);

// "UA 934", "ua934", "6E 5201" → airline + number. Anything that doesn't
// split cleanly keeps its digits as the number so nothing typed is lost.
function splitFlight(text) {
  const t = String(text || "").trim().toUpperCase().replace(/\s+/g, " ");
  const m = t.match(/^([A-Z0-9]{2})\s?0*(\d{1,5}[A-Z]?)$/);
  if (m && /[A-Z]/.test(m[1])) return { airline: m[1], number: m[2] };
  const digits = t.replace(/\D/g, "");
  return { airline: "", number: digits };
}

// The leg as the rest of the app sees a flight (codes, naive Dates), plus the
// arrival resolution the form shows — or null while it's still incomplete.
function legAsFlight(leg) {
  if (!legReady(leg)) return null;
  const r = buildDepartArrive(leg, leg.mode);
  if (r.invalid) return null;
  return { r, flight: { mode: leg.mode, from: placeCode(leg.from), to: placeCode(leg.to), depart: r.departAt, arrive: r.arriveAt } };
}
const realDepartOf = (leg) => { const x = legAsFlight(leg); return x ? window.MGData.flightRealDepart(x.flight) : null; };
const realArriveOf = (leg) => { const x = legAsFlight(leg); return x ? window.MGData.flightRealArrive(x.flight) : null; };

const normNumber = (n) => String(n || "").trim().replace(/^0+/, "");
const ymdOf = (d) => d.toISOString().slice(0, 10);
const clockMinutes = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };

// Same flight, read twice (two family members' boarding passes, or an
// itinerary plus a boarding pass for one of its legs).
function sameLeg(a, b) {
  if (!a.date || a.date !== b.date || a.mode !== b.mode) return false;
  if (a.number && b.number) {
    return normNumber(a.number) === normNumber(b.number) && (!a.airline || !b.airline || a.airline === b.airline);
  }
  return !!(a.departTime && a.departTime === b.departTime &&
    window.MGData.placesMatch(placeCode(a.from), placeCode(b.from)) &&
    window.MGData.placesMatch(placeCode(a.to), placeCode(b.to)));
}

// An already-saved flight this leg duplicates: same day, and the same flight
// number — or the same route within an hour, when there's no number to go on.
function findExisting(leg, allFlights) {
  if (!legReady(leg)) return null;
  return allFlights.find((f) => {
    if (window.MGData.modeOf(f) !== leg.mode || ymdOf(f.depart) !== leg.date) return false;
    if (leg.number && f.number) {
      return normNumber(f.number) === normNumber(leg.number) && (!leg.airline || !f.airline || f.airline === leg.airline);
    }
    const fClock = f.depart.getUTCHours() * 60 + f.depart.getUTCMinutes();
    return window.MGData.placesMatch(f.from, placeCode(leg.from)) &&
      window.MGData.placesMatch(f.to, placeCode(leg.to)) &&
      Math.abs(fClock - clockMinutes(leg.departTime)) <= 60;
  }) || null;
}

// What happens to a duplicate on save. "already": everyone on this trip is
// already on that flight — skip by default. "others": the flight exists for
// someone else — add these travelers to it by default, rather than making a
// second copy of the same flight.
function dupInfo(leg, existing, travelers) {
  if (!existing) return null;
  const missing = travelers.filter((id) => !existing.travelers.includes(id));
  const kind = missing.length === 0 ? "already" : "others";
  const action = leg.dupChoice ?? (kind === "already" ? "skip" : "merge");
  return { existing, kind, missing, action };
}

// Complete legs in real departure order; anything still missing a time keeps
// its place at the end so it doesn't jump around while being filled in.
function sortLegs(legs) {
  const ready = legs.filter((l) => realDepartOf(l));
  const rest = legs.filter((l) => !realDepartOf(l));
  ready.sort((a, b) => realDepartOf(a) - realDepartOf(b));
  return [...ready, ...rest];
}

function plausibleConnection(a, b) {
  const arr = realArriveOf(a), dep = realDepartOf(b);
  if (!arr || !dep || a.mode !== b.mode) return false;
  if (!window.MGData.placesMatch(placeCode(a.to), placeCode(b.from))) return false;
  const gap = dep - arr;
  return gap >= LINK_MIN_GAP && gap <= LINK_MAX_GAP;
}

// Decide which consecutive legs are one journey, once, right after reading —
// the parser's call when it made one (and the airports agree), the time/place
// heuristic otherwise. After this the review screen's link/unlink controls
// are the only thing that changes it.
function initialLinks(legs) {
  const sorted = sortLegs(legs);
  return sorted.map((leg, i) => {
    const next = sorted[i + 1];
    let linkNext = false;
    if (next) {
      if (leg.connectsHint === true) linkNext = window.MGData.placesMatch(placeCode(leg.to), placeCode(next.from));
      else if (leg.connectsHint === null) linkNext = plausibleConnection(leg, next);
    }
    return { ...leg, linkNext };
  });
}

function groupJourneys(sorted) {
  const journeys = [];
  let current = [];
  sorted.forEach((leg, i) => {
    current.push(leg);
    if (!(leg.linkNext && sorted[i + 1])) { journeys.push(current); current = []; }
  });
  return journeys;
}

// Last time's travelers (still people this viewer can add trips for), or
// just the viewer themselves.
function loadLastTravelers() {
  let ids = [];
  try {
    const stored = JSON.parse(localStorage.getItem(LAST_TRAVELERS_KEY) || "[]");
    if (Array.isArray(stored)) ids = stored.filter((id) => window.MGData.familyById(id)?.canManage);
  } catch (e) {}
  return ids.length ? ids : (window.MG_ME ? [window.MG_ME] : []);
}
function saveLastTravelers(ids) {
  try { localStorage.setItem(LAST_TRAVELERS_KEY, JSON.stringify(ids)); } catch (e) {}
}

async function readImageFile(file) {
  const blob = await resizeImageForUpload(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file — try a different one?"));
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.readAsDataURL(blob);
  });
}

async function parseItinerary(body) {
  const { data, error } = await withTimeout(
    window.supabaseClient.functions.invoke("parse-flight", { body: { ...body, multi: true } }),
    60000, "Reading"
  );
  if (error || !data || !data.ok) {
    throw new Error((data && data.error) || await readFunctionError(error) || "Couldn't read that one.");
  }
  return data.itinerary;
}

const fmtShortDay = (d) => d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

// ── AddTripFlow ─────────────────────────────────────────────────────────────
function AddTripFlow({ open, onClose, onSubmit, prefill, allFlights, onFamilyChanged }) {
  const [phase, setPhase] = React.useState("start"); // start | reading | review | done
  const [files, setFiles] = React.useState([]);      // { id, url, status, error }
  const [readErrors, setReadErrors] = React.useState([]);
  const [legs, setLegs] = React.useState([]);
  const [travelers, setTravelers] = React.useState([]);
  const [note, setNote] = React.useState("");
  const [noteOpen, setNoteOpen] = React.useState(false);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  const [capNotice, setCapNotice] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState(null);
  const [savedCount, setSavedCount] = React.useState(0);
  const [addPersonOpen, setAddPersonOpen] = React.useState(false);
  const [showAllTravelers, setShowAllTravelers] = React.useState(false);

  const filesRef = React.useRef([]);
  React.useEffect(() => { filesRef.current = files; }, [files]);
  // Whether travelers currently come from names printed on a ticket (vs.
  // last time's picks) — the first ticket match replaces the default,
  // later ones add to it.
  const fromTicketRef = React.useRef(false);

  // Open fresh every time; a "Return not logged → add" prefill lands straight
  // on the review step with that one leg ready to fill in.
  React.useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        filesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
        setPhase("start"); setFiles([]); setReadErrors([]); setLegs([]); setTravelers([]);
        setNote(""); setNoteOpen(false); setPasteOpen(false); setPasteText(""); setDragOver(false);
        setCapNotice(null); setSaving(false); setSaveError(null); setSavedCount(0);
        setAddPersonOpen(false); setShowAllTravelers(false);
        fromTicketRef.current = false;
      }, 200);
      return () => clearTimeout(t);
    }
    if (prefill) {
      setLegs([newLeg({
        mode: prefill.mode || "flight",
        from: placeDisplay(prefill.from) || "", to: placeDisplay(prefill.to) || "",
        expanded: true,
      })]);
      setTravelers(prefill.travelers || []);
      setPhase("review");
    } else {
      setTravelers(loadLastTravelers());
    }
    return undefined;
  }, [open, prefill]);

  // Fold newly read legs into what's already there: the same flight read
  // twice becomes one leg (and its passengers all become travelers).
  const absorb = (itinerary, source) => {
    const matched = (itinerary.passenger_names || []).map(matchTravelerByName).filter(Boolean);
    if (matched.length) {
      const keep = fromTicketRef.current;
      fromTicketRef.current = true;
      setTravelers((prev) => Array.from(new Set([...(keep ? prev : []), ...matched])));
    }
    setLegs((prev) => {
      const out = [...prev];
      for (const p of itinerary.legs || []) {
        const leg = legFromParsed(p, source);
        if (!out.some((existing) => sameLeg(existing, leg))) out.push(leg);
      }
      return out;
    });
    return matched.length;
  };

  const finishReading = () => {
    setLegs((prev) => initialLinks(prev));
    setPhase("review");
  };

  const handleFiles = (fileList) => {
    let picked = Array.from(fileList || []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (picked.length === 0) return;
    if (picked.length > ADD_MAX_FILES) {
      setCapNotice(`Only the first ${ADD_MAX_FILES} were added — add the rest afterwards.`);
      picked = picked.slice(0, ADD_MAX_FILES);
    } else setCapNotice(null);

    const entries = picked.map((file, i) => ({ id: `f-${Date.now()}-${i}`, url: URL.createObjectURL(file), status: "reading", error: null, name: file.name }));
    setFiles((prev) => [...prev, ...entries]);
    setPhase("reading");

    runPool(picked, ADD_CONCURRENCY, async (file, i) => {
      const id = entries[i].id;
      try {
        const image = await readImageFile(file);
        const itinerary = await parseItinerary({ image, mediaType: "image/jpeg" });
        absorb(itinerary, "upload");
        const found = (itinerary.legs || []).length;
        setFiles((prev) => prev.map((f) => f.id === id ? { ...f, status: found ? "done" : "empty" } : f));
        if (!found) setReadErrors((prev) => [...prev, `No trip found in ${file.name || "one screenshot"}.`]);
      } catch (err) {
        setFiles((prev) => prev.map((f) => f.id === id ? { ...f, status: "error", error: String(err.message || err) } : f));
        setReadErrors((prev) => [...prev, `${file.name || "A screenshot"}: ${String(err.message || err)}`]);
      }
    }).then(finishReading);
  };

  const handlePaste = async () => {
    if (!pasteText.trim()) return;
    setPhase("reading");
    try {
      const itinerary = await parseItinerary({ text: pasteText });
      absorb(itinerary, "paste");
      if (!(itinerary.legs || []).length) setReadErrors((prev) => [...prev, "No trip found in that text — try typing it in instead?"]);
    } catch (err) {
      setReadErrors((prev) => [...prev, String(err.message || err)]);
    }
    finishReading();
  };

  // A screenshot pasted straight from the clipboard (desktop) works the same
  // as picking a file.
  React.useEffect(() => {
    if (!open || phase !== "start") return undefined;
    const onPaste = (e) => {
      const imgs = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith("image/"));
      if (imgs.length) { e.preventDefault(); handleFiles(imgs); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [open, phase]);

  const typeItIn = () => {
    setLegs((prev) => [...prev, newLeg({ expanded: true })]);
    setPhase("review");
  };

  // ── review-step derived state ─────────────────────────────────────────────
  const sorted = sortLegs(legs);
  const journeys = groupJourneys(sorted);
  const flights = allFlights || [];
  const plan = sorted.map((leg) => {
    const dup = dupInfo(leg, findExisting(leg, flights), travelers);
    return { leg, dup, willSave: !dup || dup.action === "add", willMerge: !!dup && dup.action === "merge" };
  });
  const planById = Object.fromEntries(plan.map((p) => [p.leg.id, p]));
  const newCount = plan.filter((p) => p.willSave).length;
  const mergeCount = plan.filter((p) => p.willMerge).length;
  const skipCount = plan.length - newCount - mergeCount;

  const updateLeg = (id, patch) => setLegs((prev) => prev.map((l) => l.id === id ? { ...l, ...patch } : l));
  const removeLeg = (id) => setLegs((prev) => prev.filter((l) => l.id !== id));
  const setLink = (id, linkNext) => updateLeg(id, { linkNext });
  const toggleTraveler = (pid) => setTravelers((prev) => prev.includes(pid) ? prev.filter((x) => x !== pid) : [...prev, pid]);

  const save = async () => {
    const problems = [];
    if (!travelers.length) problems.push("who's traveling");
    plan.forEach(({ leg, willSave, willMerge }, i) => {
      if (!willSave && !willMerge) return;
      if (!legReady(leg)) problems.push(`flight ${i + 1}'s ${!leg.from ? "origin" : !leg.to ? "destination" : !leg.date ? "date" : "departure time"}`);
      else if (legAsFlight(leg)?.r.impossible) problems.push(`flight ${i + 1}'s times (they don't line up)`);
    });
    if (!plan.length) problems.push("at least one flight");
    if (problems.length) { setSaveError(`Still need: ${problems.join(", ")}.`); return; }

    setSaving(true); setSaveError(null);
    const invoke = (body, label) => withTimeout(window.supabaseClient.functions.invoke("save-flight", { body }), 20000, label)
      .then(async ({ data, error }) => {
        if (error || !data || !data.ok) throw new Error((data && data.error) || await readFunctionError(error) || "Couldn't save.");
        return data;
      });

    let saved = 0;
    try {
      for (const journey of journeys) {
        const steps = journey.map((leg) => planById[leg.id]);
        const linked = journey.length > 1;
        const existingJourneyId = steps.map((s) => s.dup?.existing.journeyId).find(Boolean);
        const journeyId = linked ? (existingJourneyId || window.crypto.randomUUID()) : null;
        let firstSavedId = null;

        for (const { leg, dup, willSave, willMerge } of steps) {
          if (willSave) {
            const { r } = legAsFlight(leg);
            const isFlight = leg.mode === "flight";
            const data = await invoke({
              mode: leg.mode,
              airline_code: isFlight ? (leg.airline || null) : null,
              flight_number: isFlight ? (leg.number || null) : null,
              from_airport: placeCode(leg.from),
              to_airport: placeCode(leg.to),
              depart_at: r.departAt.toISOString(),
              arrive_at: r.arriveAt.toISOString(),
              note: note || null,
              source: leg.source,
              travelerIds: travelers,
              journeyId: journeyId || undefined,
            }, "Saving");
            firstSavedId = firstSavedId || data.flight.id;
            saved++;
          } else if (willMerge) {
            // Add these travelers to the flight that's already there,
            // everything else about it unchanged.
            const f = dup.existing;
            await invoke({
              flightId: f.id, mode: f.mode, airline_code: f.airline || null, flight_number: f.number || null,
              from_airport: f.from, to_airport: f.to,
              depart_at: f.depart.toISOString(), arrive_at: f.arrive.toISOString(),
              note: f.note || null, source: "edit",
              travelerIds: Array.from(new Set([...f.travelers, ...travelers])),
              journeyId: f.journeyId || journeyId || undefined,
            }, "Updating");
            saved++;
          }
        }
        // A skipped (already-saved) leg that belongs to this journey but was
        // never linked to anything: link it to the new legs so the board
        // shows one journey card, not a stray.
        if (linked && firstSavedId) {
          for (const s of steps) {
            if (s.dup && s.dup.action === "skip" && !s.dup.existing.journeyId) {
              await invoke({ linkFlightIds: [s.dup.existing.id, firstSavedId] }, "Linking");
            }
          }
        }
      }
      saveLastTravelers(travelers);
      setSavedCount(saved);
      setSaving(false);
      setPhase("done");
      onSubmit();
      setTimeout(onClose, 1400);
    } catch (err) {
      setSaving(false);
      if (saved) onSubmit();
      setSaveError(saved
        ? `Saved ${saved}, then hit a problem: ${String(err.message || err)} Anything saved is already on the board.`
        : String(err.message || err));
    }
  };

  const requestClose = () => {
    if (saving) return;
    if (phase === "review" && legs.length && !window.confirm("Close without adding these to the board?")) return;
    onClose();
  };

  // ── render ────────────────────────────────────────────────────────────────
  // Only people this viewer may add trips for (see can_manage, schema.sql),
  // themselves first.
  const roster = _FAM.filter((p) => !p.isGuest && p.canManage).sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0));
  const visibleRoster = showAllTravelers ? roster : roster.slice(0, 15);
  const hiddenRosterCount = roster.length - visibleRoster.length;
  const selectedGuests = travelers.map((id) => _FAM.find((p) => p.id === id)).filter((p) => p && p.isGuest);
  const readCount = files.filter((f) => f.status !== "reading").length;

  const primaryLabel = newCount + mergeCount === 0
    ? "Nothing new to add"
    : [newCount ? `Add ${newCount} ${newCount === 1 ? "flight" : "flights"}` : null,
       mergeCount ? `update ${mergeCount}` : null].filter(Boolean).join(" & ");

  return (
    <Modal open={open} onClose={requestClose} size="md">
      <div className="at af">
        <header className="at__head">
          <h2 className="at__title">{phase === "review" ? "Check your trip" : phase === "done" ? "Added" : "Add a trip"}</h2>
        </header>

        {phase === "start" && (
          <div className="af__start">
            <label
              className={`af__drop ${dragOver ? "on" : ""}`}
              htmlFor="af-files"
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            >
              <input id="af-files" type="file" accept="image/*" multiple style={{ display: "none" }}
                     onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
              <span className="af__drop-icon" aria-hidden="true">⬆</span>
              <span className="af__drop-title">Add screenshots</span>
              <span className="af__drop-sub">Boarding passes, booking confirmations, itineraries — one or several. We'll find every flight in them.</span>
            </label>
            {capNotice && <div className="at__hint">{capNotice}</div>}

            <div className="af__alt">
              <button type="button" className="af__alt-btn" onClick={() => setPasteOpen((v) => !v)} aria-expanded={pasteOpen}>Paste text</button>
              <button type="button" className="af__alt-btn" onClick={typeItIn}>Type it in</button>
            </div>
            {pasteOpen && (
              <label className="at__field at__field--full">
                <span>Paste a confirmation email or itinerary</span>
                <textarea rows={4} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                          placeholder="e.g. United UA934, JFK to LHR, Sat May 23, depart 11:40pm arrive 11:55am +1" autoFocus />
                <button className="at__primary at__paste-btn" onClick={handlePaste} disabled={!pasteText.trim()}>Read it</button>
              </label>
            )}
          </div>
        )}

        {phase === "reading" && (
          <div className="af__start">
            <div className="at__parsed at__parsed--pending">
              <span className="at__spinner" aria-hidden="true" />
              {files.length
                ? `Reading ${files.length === 1 ? "your screenshot" : `${files.length} screenshots`}… ${readCount} of ${files.length} done`
                : "Reading your text…"}
            </div>
            {files.length > 0 && (
              <div className="bu__thumbs">
                {files.map((f) => (
                  <div key={f.id} className={`bu__thumb bu__thumb--${f.status === "done" ? "ready" : f.status === "reading" ? "parsing" : "error"}`}>
                    <img src={f.url} alt="" />
                    <span className="bu__thumb-badge" aria-hidden="true">
                      {f.status === "reading" && <span className="at__spinner" />}
                      {f.status === "done" && "✓"}
                      {(f.status === "error" || f.status === "empty") && "!"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {phase === "done" && (
          <div className="af__start">
            <div className="at__parsed">
              <div className="at__parsed-mark">✓</div>
              <div><strong>{savedCount === 1 ? "1 flight" : `${savedCount} flights`} on the board.</strong> The family can see {savedCount === 1 ? "it" : "them"} now.</div>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="af__review">
            {readErrors.length > 0 && (
              <div className="at__parsed at__parsed--error">
                <div className="at__parsed-mark">!</div>
                <div>{readErrors.map((e, i) => <div key={i}>{e}</div>)}</div>
              </div>
            )}
            {legs.length === 0 && (
              <div className="af__empty">
                Nothing to add yet.
                <div className="af__alt">
                  <button type="button" className="af__alt-btn" onClick={() => { setReadErrors([]); setPhase("start"); }}>Try another screenshot</button>
                  <button type="button" className="af__alt-btn" onClick={typeItIn}>Type it in</button>
                </div>
              </div>
            )}

            {legs.length > 0 && (
              <div className="at__field at__field--full">
                <span>Who's traveling?</span>
                <div className="at__people">
                  {visibleRoster.map((p) => (
                    <button key={p.id} type="button" className={`at__person ${travelers.includes(p.id) ? "on" : ""}`} onClick={() => toggleTraveler(p.id)}>
                      <Avatar person={p} size={28} />
                      <span>{p.first}</span>
                    </button>
                  ))}
                  <button type="button" className="at__person at__person--add" onClick={() => setAddPersonOpen(true)}>
                    <span aria-hidden="true">＋</span><span>Someone new</span>
                  </button>
                </div>
                {hiddenRosterCount > 0 && (
                  <button type="button" className="at__view-more" onClick={() => setShowAllTravelers(true)}>View {hiddenRosterCount} more</button>
                )}
                {selectedGuests.length > 0 && (
                  <div className="at__guest-chips">
                    {selectedGuests.map((p) => (
                      <span key={p.id} className="at__guest-chip">
                        <Avatar person={p} size={20} />
                        {p.first} {p.last}
                        <button type="button" onClick={() => toggleTraveler(p.id)} aria-label={`Remove ${p.first}`}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {journeys.map((journey, ji) => {
              const first = journey[0], last = journey[journey.length - 1];
              const dir = journey.find((l) => l.direction !== "unknown")?.direction;
              const label = dir === "outbound" ? "Outbound" : dir === "return" ? "Return" : journeys.length > 1 ? `Journey ${ji + 1}` : "Journey";
              const dep = legAsFlight(first);
              const nextJourney = journeys[ji + 1];
              return (
                <React.Fragment key={first.id}>
                  <section className="af__journey">
                    <div className="af__journey-head">
                      <span className="af__journey-kicker">{label}</span>
                      <span className="af__journey-route">
                        {first.from ? window.MGData.airport(placeCode(first.from)).city : "?"} → {last.to ? window.MGData.airport(placeCode(last.to)).city : "?"}
                        {dep && <span className="af__journey-date"> · {fmtShortDay(dep.r.departAt)}</span>}
                      </span>
                    </div>
                    {journey.map((leg, li) => (
                      <React.Fragment key={leg.id}>
                        <LegRow
                          leg={leg} dup={planById[leg.id].dup} travelers={travelers}
                          onChange={(patch) => updateLeg(leg.id, patch)}
                          onRemove={() => removeLeg(leg.id)}
                        />
                        {li < journey.length - 1 && (
                          <LayoverRow a={leg} b={journey[li + 1]} onUnlink={() => setLink(leg.id, false)} />
                        )}
                      </React.Fragment>
                    ))}
                  </section>
                  {nextJourney && plausibleConnection(last, nextJourney[0]) && (
                    <button type="button" className="af__link" onClick={() => setLink(last.id, true)}>
                      Connects to the next flight? Link them as one journey
                    </button>
                  )}
                </React.Fragment>
              );
            })}

            {legs.length > 0 && (
              <div className="af__more">
                <button type="button" className="af__alt-btn" onClick={() => setLegs((prev) => [...prev, newLeg({ expanded: true })])}>＋ Add another flight</button>
                <label className="af__alt-btn" htmlFor="af-more-files">
                  ＋ Another screenshot
                  <input id="af-more-files" type="file" accept="image/*" multiple style={{ display: "none" }}
                         onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }} />
                </label>
              </div>
            )}

            {legs.length > 0 && (noteOpen ? (
              <label className="at__field at__field--full">
                <span>A note for the family</span>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Heading home for the holidays!" autoFocus />
              </label>
            ) : (
              <button type="button" className="at__view-more" onClick={() => setNoteOpen(true)}>Add a note for the family</button>
            ))}

            {legs.length > 0 && (
              <div className="af__footer">
                {saveError && <div className="at__error">{saveError}</div>}
                <div className="af__footer-row">
                  <span className="af__footer-sum">
                    {skipCount > 0 && `${skipCount} already on the board`}
                  </span>
                  <button className="at__secondary" onClick={requestClose} disabled={saving}>Cancel</button>
                  <button className="at__primary" onClick={save} disabled={saving || newCount + mergeCount === 0}>
                    {saving ? <><span className="at__spinner at__spinner--light" aria-hidden="true" /> Saving…</> : primaryLabel}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <AddPersonModal
          open={addPersonOpen}
          allowGuest
          onClose={() => setAddPersonOpen(false)}
          onCreated={(person) => { toggleTraveler(person.id); onFamilyChanged && onFamilyChanged(); }}
        />
        <datalist id="af-airport-list">
          {Object.entries(_AP).map(([code, a]) => <option key={code} value={`${a.city} (${code})`}>{a.city}, {a.country}</option>)}
        </datalist>
        <datalist id="af-airline-list">
          {Object.entries(_AL).map(([code, a]) => <option key={code} value={code}>{code} — {a.name}</option>)}
        </datalist>
      </div>
    </Modal>
  );
}

// One leg, collapsed to a line that reads like the board ("JFK 18:25 → LHR
// 06:30 +1"), expanding into its fields. Anything that needs a look —
// missing fields, what Claude wasn't sure about, an arrival day it had to
// correct, a duplicate of something already saved — shows on the collapsed
// line so nobody has to open every leg to find it.
function LegRow({ leg, dup, travelers, onChange, onRemove }) {
  const x = legAsFlight(leg);
  const isFlight = leg.mode === "flight";
  const icon = window.MGData.MODE_META[leg.mode]?.icon || "✈";
  const code = (v) => v ? placeCode(v) : "?";
  const missing = !legReady(leg)
    ? ["from", "to", "date", "departTime"].filter((k) => !leg[k]).map((k) => ({ from: "origin", to: "destination", date: "date", departTime: "departure time" }[k]))
    : [];
  const flagged = (leg.lowConfidence || []).map((f) => f.replace(/_/g, " "));
  const names = (ids) => ids.map((id) => window.MGData.familyById(id)?.first).filter(Boolean).join(" & ");
  const existingNames = dup ? names(dup.existing.travelers) : "";

  return (
    <div className={`af__leg ${leg.expanded ? "open" : ""} ${dup && dup.action === "skip" ? "af__leg--skip" : ""}`}>
      <button type="button" className="af__leg-sum" onClick={() => onChange({ expanded: !leg.expanded })} aria-expanded={leg.expanded}>
        <span className="af__leg-icon" aria-hidden="true">{icon}</span>
        <span className="af__leg-main">
          <span className="af__leg-route">
            {code(leg.from)} {leg.departTime || "--:--"} → {code(leg.to)} {x ? fmtTime(x.r.arriveAt) : (leg.arriveTime || "--:--")}
            {x && x.r.dayOffset !== 0 && <sup className="day-offset-sup">{x.r.dayOffset > 0 ? `+${x.r.dayOffset}` : x.r.dayOffset}</sup>}
          </span>
          <span className="af__leg-meta">
            {[isFlight && leg.airline && leg.number ? `${leg.airline} ${leg.number}` : null,
              x ? fmtShortDay(x.r.departAt) : null,
              x && x.r.durationMs != null ? fmtDuration(x.r.durationMs) : null,
              x && x.r.estimated ? "arrival estimated" : null].filter(Boolean).join(" · ") || "New flight"}
          </span>
        </span>
        <span className="af__leg-edit">{leg.expanded ? "Done" : "Edit"}</span>
      </button>

      {missing.length > 0 && !leg.expanded && <div className="af__flag af__flag--warn">Needs: {missing.join(", ")}</div>}
      {flagged.length > 0 && <div className="af__flag">Double-check: {flagged.join(", ")}</div>}
      {x && x.r.adjusted && <div className="af__flag af__flag--warn">Arrival moved to {fmtShortDay(x.r.arriveAt)} — the ticket's day would land before takeoff.</div>}
      {x && x.r.unknownZone && <div className="af__flag">We don't know one of these time zones — check the times.</div>}

      {dup && (
        <div className="af__dup">
          <span>
            {dup.kind === "already"
              ? `Already on the board${existingNames ? ` for ${existingNames}` : ""}.`
              : `Already on the board for ${existingNames || "someone else"} — add ${names(dup.missing)} to it?`}
          </span>
          <div className="af__seg" role="radiogroup">
            {(dup.kind === "already" ? [["skip", "Skip it"], ["add", "Add again"]] : [["merge", `Add ${names(dup.missing) || "them"}`], ["add", "Save separately"]]).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={dup.action === value} className={dup.action === value ? "on" : ""}
                      onClick={() => onChange({ dupChoice: value })}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {leg.expanded && (
        <div className="af__leg-edit-body">
          {/* Four short rows instead of eight full-width ones: how + flight
              number, from + to, then each end as date + time. */}
          <div className={`af__erow ${isFlight ? "af__erow--how" : ""}`}>
            <div className="at__mode-toggle af__mode" role="radiogroup" aria-label="How are you getting there?">
              {["flight", "train", "car"].map((m) => (
                <button key={m} type="button" role="radio" aria-checked={leg.mode === m} className={leg.mode === m ? "on" : ""}
                        onClick={() => onChange({ mode: m })} title={window.MGData.MODE_META[m].label}>
                  <span aria-hidden="true">{window.MGData.MODE_META[m].icon}</span><span className="af__mode-label">{window.MGData.MODE_META[m].label}</span>
                </button>
              ))}
            </div>
            {isFlight && (
              <label className="at__field"><span>Flight</span>
                <input
                  value={leg.flightText ?? [leg.airline, leg.number].filter(Boolean).join(" ")}
                  onChange={(e) => onChange({ flightText: e.target.value, ...splitFlight(e.target.value) })}
                  placeholder="UA 934" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                />
              </label>
            )}
          </div>
          <div className="af__erow af__erow--route">
            <label className="at__field"><span>From</span>
              <input list="af-airport-list" value={leg.from} onChange={(e) => onChange({ from: e.target.value })} placeholder="City or airport" />
            </label>
            <span className="af__erow-arrow" aria-hidden="true">→</span>
            <label className="at__field"><span>To</span>
              <input list="af-airport-list" value={leg.to} onChange={(e) => onChange({ to: e.target.value })} placeholder="City or airport" />
            </label>
          </div>
          <div className="af__erow af__erow--when">
            <span className="af__erow-label">Departs</span>
            <input type="date" aria-label="Departure date" value={leg.date} onChange={(e) => onChange({ date: e.target.value })} />
            <input type="time" aria-label="Departure time" value={leg.departTime} onChange={(e) => onChange({ departTime: e.target.value })} />
          </div>
          <div className="af__erow af__erow--when">
            <span className="af__erow-label">Arrives</span>
            <ArrivalDateInput form={leg} mode={leg.mode} onChange={(n) => onChange({ arriveDayOffset: n })} />
            <input type="time" aria-label="Arrival time" value={leg.arriveTime} onChange={(e) => onChange({ arriveTime: e.target.value })} />
          </div>
          <ArrivalSummary form={leg} mode={leg.mode} />
          <div className="af__leg-actions">
            <button type="button" className="af__remove" onClick={onRemove}>Remove this {isFlight ? "flight" : "leg"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// The gap between two linked legs — the detail that used to be a bare dot.
function LayoverRow({ a, b, onUnlink }) {
  const arr = realArriveOf(a), dep = realDepartOf(b);
  const sameAirport = window.MGData.placesMatch(placeCode(a.to || ""), placeCode(b.from || ""));
  const gap = arr && dep ? dep - arr : null;
  const city = a.to ? window.MGData.airport(placeCode(a.to)).city : "the connection";
  let text, warn = false;
  if (!sameAirport && a.to && b.from) { text = `Lands at ${placeCode(a.to)} but the next flight leaves from ${placeCode(b.from)}`; warn = true; }
  else if (gap == null) text = `Connection in ${city}`;
  else if (gap < 0) { text = `The next flight leaves before this one lands — check the times`; warn = true; }
  else {
    text = `${fmtDuration(gap)} layover in ${city}`;
    if (gap < 45 * 60 * 1000) { text += " — a tight connection"; warn = true; }
  }
  return (
    <div className={`af__layover ${warn ? "af__layover--warn" : ""}`}>
      <span className="af__layover-line" aria-hidden="true" />
      <span className="af__layover-text">{text}</span>
      <button type="button" className="af__layover-unlink" onClick={onUnlink}>Not a connection</button>
    </div>
  );
}

Object.assign(window, { AddTripFlow });
