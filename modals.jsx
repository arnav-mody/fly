// modals.jsx — FlightDetail + AddTrip modals for the Mody-Gandhi Travel Tracker.

const { FAMILY: _FAM, FLIGHTS: _FLT, AIRLINES: _AL, AIRPORTS: _AP } = window.MGData;
const _flightStatus = window.MGData.flightStatus;
const _familyById   = window.MGData.familyById;
const _airport      = window.MGData.airport;
const _flightAwareUrl = window.MGData.flightAwareUrl;
const _modeOf   = window.MGData.modeOf;
const _modeMeta = window.MGData.modeMeta;
const _MODE     = window.MGData.MODE_META;
const _hasLoggedReturn = window.MGData.hasLoggedReturn;
const _hasCoords = window.MGData.hasCoords;

// supabase-js only exposes a generic "Edge Function returned a non-2xx
// status code" on failure — it doesn't parse the response body for you. The
// actual JSON error we sent back (see parse-flight/save-flight) is sitting
// on error.context, which is the raw Response object. Dig it out so people
// see the real reason instead of this one useless sentence every time.
// A hung request (bad connection, a cold-start stall, whatever) previously
// left the UI stuck on "Saving…" forever — the promise just never settled,
// so neither the success path nor the .catch() ever ran. Race every
// Edge Function call against a hard timeout so that can't happen again.
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} is taking too long — check your connection and try again.`)), ms)
    ),
  ]);
}

async function readFunctionError(error) {
  if (!error) return null;
  try {
    if (error.context && typeof error.context.json === "function") {
      const body = await error.context.clone().json();
      if (body && body.error) return body.error;
    }
  } catch (e) { /* body wasn't JSON — fall through to the generic message */ }
  return error.message || "Something went wrong.";
}

// Resize + re-encode any uploaded image client-side, before it goes
// anywhere. Two birds, one stone: Claude's vision encoder doesn't get any
// more useful out of an image bigger than ~1568px on the long edge — beyond
// that you're just paying more bandwidth and tokens for nothing — and
// redrawing through a canvas always outputs plain JPEG regardless of the
// source format, which quietly fixes formats Claude can't read directly
// (HEIC off an iPhone, etc.) as long as the browser itself can decode them.
const MAX_UPLOAD_DIM = 1568;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // sanity cap before we even try decoding

async function resizeImageForUpload(file) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("That file's too large (over 20MB) — try a smaller photo or a screenshot instead?");
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (e) {
    throw new Error("Couldn't read that image — try a different file or format?");
  }

  const scale = Math.min(1, MAX_UPLOAD_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Couldn't process that image."))),
      "image/jpeg",
      0.9
    );
  });
  return blob;
}

// ── Modal shell ─────────────────────────────────────────────────────────────
function Modal({ open, onClose, children, size = "lg" }) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal modal--${size}`} onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose} aria-label="Close">✕</button>
        {children}
      </div>
    </div>
  );
}

// ── FlightDetail ────────────────────────────────────────────────────────────
function FlightDetailModal({ flight, onClose, now, onEdit, onDeleted, allFlights, onAddReturn, onDismissReturn }) {
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState(null);
  React.useEffect(() => { setDeleting(false); setDeleteError(null); }, [flight?.id]);

  if (!flight) return null;
  const isJourney = Array.isArray(flight.legs) && flight.legs.length > 1;
  const legs      = isJourney ? flight.legs : [flight];
  const firstLeg  = legs[0], lastLeg = legs[legs.length - 1];

  const status   = isJourney ? window.MGData.journeyStatus(legs, now) : _flightStatus(flight, now);
  const mode     = _modeOf(firstLeg);
  const isFlight = mode === "flight";
  const meta     = _modeMeta(firstLeg);
  const from     = { ..._airport(firstLeg.from), code: firstLeg.from };
  const to       = { ..._airport(lastLeg.to),    code: lastLeg.to };
  const travelers = firstLeg.travelers.map(_familyById).filter(Boolean);
  const noReturn = allFlights && !lastLeg.returnDismissed && !_hasLoggedReturn(lastLeg, allFlights) && !window.MGData.isHomeArrival(lastLeg);
  const airborneLeg = isJourney ? legs.find((l) => _flightStatus(l, now) === "airborne") : flight;
  // The leg currently underway during a layover — i.e. which gap in the
  // chain "now" falls into — so the detail panel can name the right city.
  const layoverIdx = isJourney ? legs.findIndex((l, i) => i < legs.length - 1 && now >= window.MGData.flightRealArrive(l) && now < window.MGData.flightRealDepart(legs[i + 1])) : -1;

  const handleAddReturn = () => onAddReturn({ from: from.code, to: to.code, travelers: firstLeg.travelers, mode });

  const handleDelete = () => {
    const label = isJourney ? `this trip (${from.code} → ${to.code}, ${legs.length} legs)` : `this trip (${flight.from} → ${flight.to})`;
    if (!window.confirm(`Delete ${label}? This can't be undone.`)) return;
    setDeleting(true);
    setDeleteError(null);
    Promise.all(legs.map((l) =>
      withTimeout(window.supabaseClient.functions.invoke("delete-flight", { body: { flightId: l.id } }), 15000, "Deleting")
    )).then(async (results) => {
      setDeleting(false);
      const failed = results.find(({ data, error }) => error || !data || !data.ok);
      if (failed) {
        const message = (failed.data && failed.data.error) || await readFunctionError(failed.error) || "Couldn't delete this trip — mind trying again?";
        setDeleteError(message);
        return;
      }
      onDeleted();
      onClose();
    }).catch((err) => {
      setDeleting(false);
      setDeleteError(String((err && err.message) || err));
    });
  };

  // FlightAware's per-flight-number page shows whichever instance of that
  // number is currently live/most-recent — for a flight booked far ahead,
  // that's a *different day's* flight, not this one, which is misleading
  // rather than just unavailable. Only offer the link once it's close
  // enough to actually be about this flight (within 48h of departure,
  // through touchdown) and only when flightAwareUrl actually has a
  // FlightAware-recognized ICAO code to build a real link from.
  const faUrlFor = (leg) => window.MGData.flightRealDepart(leg).getTime() - now.getTime() <= hours(48) ? _flightAwareUrl(leg) : null;

  return (
    <Modal open={!!flight} onClose={onClose} size="lg">
      <div className="fd">
        {/* Hero — route map + status */}
        <div className={`fd__hero fd__hero--${status === "layover" ? "boarding" : status}`}>
          <div className="fd__hero-inner">
            <div className="fd__statusrow">
              <StatusPill status={status} mode={mode} />
            </div>
            <h1 className="fd__title">
              <span className="fd__city">
                <span className="fd__city-name">{from.city}</span>
                {isFlight && <span className="fd__city-code">{from.code}</span>}
              </span>
              <span className="fd__arrow">→</span>
              <span className="fd__city">
                <span className="fd__city-name">{to.city}</span>
                {isFlight && <span className="fd__city-code">{to.code}</span>}
              </span>
            </h1>
            {isJourney && (
              <div className="fd__via">via {legs.slice(0, -1).map((l) => _airport(l.to).city).join(", ")}</div>
            )}
            <div className="fd__date">{fmtDateLong(firstLeg.depart)}</div>
            {/* Skipped while airborne — FlightProgress right below already
                shows this same route, cities, and times moving in real time;
                showing both back to back was pure repetition. */}
            {status !== "airborne" && (
              <div className="fd__map">
                {!isFlight || !_hasCoords(from, to)
                  ? <div className="tcard__mode-block" style={{ height: 160, fontSize: "1.8rem" }}>{meta.icon}</div>
                  : isJourney
                    ? <JourneyRouteMap legs={legs} now={now} height={220} />
                    : <RouteMap from={from} to={to} progress={window.MGData.flightProgress(flight, now)} status={status} height={220} />}
              </div>
            )}
          </div>
        </div>

        {/* Status detail */}
        <div className="fd__statusdetail">
          {status === "airborne" && (
            <>
              <FlightProgress flight={airborneLeg} now={now} />
              {(() => {
                const arriveTo = _airport(airborneLeg.to);
                const vt = window.MGData.viewerTime(airborneLeg.arrive, arriveTo);
                return vt ? <div className="fprog__viewer">({vt.time} {vt.tzAbbrev})</div> : null;
              })()}
            </>
          )}
          {status === "layover" && layoverIdx >= 0 && (
            <Countdown target={window.MGData.flightRealDepart(legs[layoverIdx + 1])} label={`On a layover in ${_airport(legs[layoverIdx].to).city} — next leg in`} now={now} />
          )}
          {(status === "boarding" || status === "scheduled") && (
            <Countdown target={window.MGData.flightRealDepart(firstLeg)} label={isFlight ? "Taking off in" : "Departs in"} now={now} />
          )}
          {status === "landed" && (
            <div className="fd__landed">
              <div className="fd__landed-mark">✓</div>
              <div>
                <div className="fd__landed-title">{isFlight ? "Landed safely" : "Arrived safely"}</div>
                <div className="fd__landed-sub">
                  {fmtDuration(now - window.MGData.flightRealArrive(lastLeg))} ago · arrived {fmtTime(lastLeg.arrive)} {to.tz}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Note from the traveler */}
        {firstLeg.note && (
          <div className="fd__note">
            <div className="fd__note-kicker">A note from {travelers[0]?.first}</div>
            <p>"{firstLeg.note}"</p>
          </div>
        )}

        {/* Itinerary details — the same compact Flight/Depart/Arrive/Duration
            row the board cards use, once per leg (just one row for a
            nonstop flight, so no separate summary line duplicating it). */}
        <div className="fd__details">
          <h3 className="fd__h">Itinerary</h3>
          {legs.map((leg, i) => (
            <React.Fragment key={leg.id}>
              <BoardingPassStrip flight={leg} />
              {isFlight && faUrlFor(leg) && (
                <a className="fa-link fd__fa" href={faUrlFor(leg)} target="_blank" rel="noopener noreferrer">
                  Track live on FlightAware <span className="fa-link__arrow">↗</span>
                </a>
              )}
              {i < legs.length - 1 && (
                <div className="fd__layover">
                  <span className="fd__layover-icon" aria-hidden="true">⏱</span>
                  Layover in {_airport(leg.to).city} — {fmtDuration(window.MGData.flightRealDepart(legs[i + 1]) - window.MGData.flightRealArrive(leg))}
                </div>
              )}
            </React.Fragment>
          ))}
          {noReturn && (
            <div className="fd__no-return-row">
              <button className="card__no-return fd__no-return" onClick={handleAddReturn}>
                Return not logged — click to add
              </button>
              <button className="fd__dismiss" onClick={() => onDismissReturn(lastLeg)} title="Not expecting a return leg for this trip">
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Travelers */}
        <div className="fd__details">
          <h3 className="fd__h">Who's on this flight</h3>
          <div className="fd__travelers">
            {travelers.map((p) => (
              <div key={p.id} className="fd__traveler">
                <Avatar person={p} size={38} />
                <div>
                  <div className="fd__traveler-name">{p.first} {p.last}</div>
                  {p.role && <div className="fd__traveler-role">{p.role}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Manage */}
        <div className="fd__manage">
          {deleteError && <div className="fd__manage-error">{deleteError}</div>}
          <div className="fd__manage-actions">
            {isJourney ? (
              legs.map((leg, i) => (
                <button key={leg.id} className="fd__manage-btn" onClick={() => onEdit(leg)} disabled={deleting}>
                  Edit leg {i + 1}
                </button>
              ))
            ) : (
              <button className="fd__manage-btn" onClick={() => onEdit(flight)} disabled={deleting}>
                Edit trip
              </button>
            )}
            <button className="fd__manage-btn fd__manage-btn--danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><span className="at__spinner" aria-hidden="true" /> Deleting…</> : "Delete trip"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── AddTrip modal ───────────────────────────────────────────────────────────
// One screen: the upload button, the paste-toggle, and the review/edit form
// are all visible together from the moment the modal opens — no click-through
// required. Uploading or pasting fills in the same fields live, in place.
const EMPTY_TRIP_FORM = {
  travelers: [], airline: "", number: "",
  from: "", to: "", date: "", departTime: "", arriveTime: "", note: "",
};

// Loose name match against the family roster, used to auto-check a traveler
// when parse-flight returns a passenger_name — only acts on a confident hit,
// leaves it alone otherwise so nobody's silently mis-tagged.
function matchTravelerByName(name) {
  if (!name) return null;
  const norm = String(name).trim().toLowerCase();
  if (!norm) return null;
  const hit = _FAM.find((p) => {
    const first = p.first.toLowerCase();
    const last = p.last.toLowerCase();
    const nick = (p.nick || "").toLowerCase();
    return norm === first || norm === last || (nick && norm === nick) ||
      norm === `${first} ${last}` || norm.includes(`${first} ${last}`) ||
      (nick && norm.includes(nick));
  });
  return hit ? hit.id : null;
}

// UTC-getters because the app deliberately stores clock digits "as if" UTC
// (see fmtTime elsewhere) rather than doing real timezone conversion — same
// convention applied in reverse here to prefill the form from a saved flight.
function dateToFormFields(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

// Combobox display: a known airport shows as "City (CODE)" so the code is
// context, not the thing you have to know — free-typed cities or codes we
// don't recognize just pass through unchanged. placeCode reverses it back
// to a bare code at submit time (or passes the text through as-is for
// anything that was never a recognized airport, matching how the backend
// already accepts a free-text place for those).
function placeDisplay(value) {
  if (!value) return "";
  const a = _AP[String(value).toUpperCase()];
  return a ? `${a.city} (${value.toUpperCase()})` : value;
}
function placeCode(value) {
  if (!value) return value;
  const m = String(value).trim().match(/\(([A-Za-z0-9]{2,4})\)\s*$/);
  return m ? m[1].toUpperCase() : value.trim();
}

const EMPTY_LEG_FORM = {
  airline: "", number: "", from: "", to: "", date: "", departTime: "", arriveTime: "",
};

// One "second leg" — used identically for the connecting-flight leg and the
// round-trip return leg, so both get the exact same upload/paste/manual-entry
// experience instead of two half-built copies of it. Each call is an
// independent set of hooks (this is just a plain function returning an
// object, not a component), so AddTripModal can hold two of these side by
// side with no conflict.
function useLegForm() {
  const [form, setForm] = React.useState(EMPTY_LEG_FORM);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [parsing, setParsing] = React.useState(false);
  const [parsed, setParsed] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [uploading, setUploading] = React.useState(false);
  const [imagePath, setImagePath] = React.useState(null);

  const applyParsed = (p) => {
    setForm((l) => ({
      ...l,
      airline: (p.airline_code || l.airline || "").toUpperCase(),
      number: p.flight_number || l.number,
      from: p.from_airport ? placeDisplay(p.from_airport) : l.from,
      to: p.to_airport ? placeDisplay(p.to_airport) : l.to,
      date: p.date || l.date,
      departTime: p.depart_time || l.departTime,
      arriveTime: p.arrive_time || l.arriveTime,
    }));
  };

  const parseText = () => {
    if (!pasteText.trim()) return;
    setParsing(true);
    setError(null);
    withTimeout(window.supabaseClient.functions.invoke("parse-flight", {
      body: { text: pasteText },
    }), 30000, "Reading").then(async ({ data, error: err }) => {
      setParsing(false);
      if (err || !data || !data.ok) {
        setError((data && data.error) || await readFunctionError(err) || "Couldn't make sense of that — try filling in the fields below instead?");
        return;
      }
      setParsed(data.parsed);
      applyParsed(data.parsed);
    }).catch((err) => {
      setParsing(false);
      setError(String((err && err.message) || err));
    });
  };

  const handleFileSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    setParsed(null);

    resizeImageForUpload(file).then((blob) => {
      const reader = new FileReader();
      reader.onerror = () => { setUploading(false); setError("Couldn't read that file — try a different one?"); };
      reader.onload = () => {
        const base64 = String(reader.result).split(",")[1];
        withTimeout(window.supabaseClient.functions.invoke("parse-flight", {
          body: { image: base64, mediaType: "image/jpeg" },
        }), 30000, "Reading").then(async ({ data, error: err }) => {
          setUploading(false);
          if (err || !data || !data.ok) {
            setError((data && data.error) || await readFunctionError(err) || "Couldn't read that image — mind typing the details in below?");
            return;
          }
          setImagePath(data.imagePath);
          setParsed(data.parsed);
          applyParsed(data.parsed);
        }).catch((err) => {
          setUploading(false);
          setError(String((err && err.message) || err));
        });
      };
      reader.readAsDataURL(blob);
    }).catch((err) => {
      setUploading(false);
      setError(String((err && err.message) || err));
    });
  };

  const reset = () => {
    setForm(EMPTY_LEG_FORM); setPasteOpen(false); setPasteText(""); setParsing(false);
    setParsed(null); setError(null); setUploading(false); setImagePath(null);
  };

  return { form, setForm, pasteOpen, setPasteOpen, pasteText, setPasteText, parsing, parsed, error, uploading, imagePath, parseText, handleFileSelect, reset };
}

// The upload/paste/manual-entry block for one leg — identical UI whether
// it's a connecting flight's second leg or a round trip's return leg.
function LegFields({ leg, idPrefix, title, isFlight, fromPlaceholder, toPlaceholder, fromOptional, toOptional, pasteExample }) {
  const f = leg.form;
  return (
    <div className="at__leg2">
      <div className="at__leg2-head">{title}</div>
      {isFlight && (
        <>
          <label className="at__upload-cta at__upload-cta--small" htmlFor={`${idPrefix}-file`}>
            <input id={`${idPrefix}-file`} type="file" accept="image/*" onChange={leg.handleFileSelect} style={{ display: "none" }} />
            <span className="at__upload-cta-icon">⬆</span>
            <span>Upload a boarding pass to autofill</span>
          </label>
          <button type="button" className="at__paste-link" onClick={() => leg.setPasteOpen((v) => !v)}>
            {leg.pasteOpen ? "Hide paste box" : "or paste in the details"}
          </button>

          {leg.uploading && (
            <div className="at__parsed at__parsed--pending">
              <span className="at__spinner" aria-hidden="true" />
              Reading your boarding pass…
            </div>
          )}
          {leg.error && (
            <div className="at__parsed at__parsed--error">
              <div className="at__parsed-mark">!</div>
              <div>{leg.error}</div>
            </div>
          )}
          {leg.parsed && !leg.error && (
            <div className="at__parsed">
              <div className="at__parsed-mark">✓</div>
              <div><strong>Got it!</strong> Double-check the fields below and save.</div>
            </div>
          )}
          {leg.pasteOpen && (
            <label className="at__field at__field--full">
              <span>Paste or type the details</span>
              <textarea rows={3} value={leg.pasteText} onChange={(e) => leg.setPasteText(e.target.value)} placeholder={pasteExample} />
              <button type="button" className="at__primary at__paste-btn" onClick={leg.parseText} disabled={leg.parsing || !leg.pasteText.trim()}>
                {leg.parsing ? <><span className="at__spinner at__spinner--light" aria-hidden="true" /> Reading…</> : "Fill in from text"}
              </button>
            </label>
          )}

          <div className="at__row">
            <label className="at__field">
              <span>Airline (optional)</span>
              <input list="at-airline-list" value={f.airline} onChange={(e) => leg.setForm({ ...f, airline: e.target.value.toUpperCase() })} placeholder="UA" />
            </label>
            <label className="at__field">
              <span>Flight # (optional)</span>
              <input value={f.number} onChange={(e) => leg.setForm({ ...f, number: e.target.value })} placeholder="934" />
            </label>
          </div>
        </>
      )}
      <div className="at__row">
        <label className="at__field">
          <span>From{fromOptional ? " (optional)" : ""}</span>
          <input list="at-airport-list" value={f.from} onChange={(e) => leg.setForm({ ...f, from: e.target.value })} placeholder={fromPlaceholder || "San Francisco"} />
        </label>
        <label className="at__field">
          <span>To{toOptional ? " (optional)" : ""}</span>
          <input list="at-airport-list" value={f.to} onChange={(e) => leg.setForm({ ...f, to: e.target.value })} placeholder={toPlaceholder || "London"} />
        </label>
      </div>
      <label className="at__field at__field--full">
        <span>Date</span>
        <input type="date" value={f.date} onChange={(e) => leg.setForm({ ...f, date: e.target.value })} />
      </label>
      <div className="at__row at__row--times">
        <label className="at__field">
          <span>Depart</span>
          <input type="time" value={f.departTime} onChange={(e) => leg.setForm({ ...f, departTime: e.target.value })} />
        </label>
        <label className="at__field">
          <span>Arrive{isFlight ? "" : " (optional)"}</span>
          <input type="time" value={f.arriveTime} onChange={(e) => leg.setForm({ ...f, arriveTime: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

function AddTripModal({ open, onClose, onSubmit, editing, prefill }) {
  const [mode, setMode] = React.useState("flight");     // "flight" | "train" | "car"
  const [form, setForm] = React.useState(EMPTY_TRIP_FORM);
  const [roundTrip, setRoundTrip] = React.useState(false); // create-flow only — logs both legs at once

  // Connecting flight — create-flow only, mutually exclusive with round trip.
  // Same idea as the round-trip flow (save two legs in one submit) but the
  // two legs share a journeyId instead of reversing the route, so the board
  // can show them as one card (see buildJourneys in data.js).
  const [addingConnection, setAddingConnection] = React.useState(false);
  const leg2 = useLegForm();

  // Round trip's return leg — same upload/paste/manual-entry experience as
  // the connecting-flight leg above (see LegFields), just without a
  // journeyId: if left blank, From/To default to the outbound route
  // reversed at submit time, but an uploaded/pasted return boarding pass can
  // still override that (e.g. a return that actually connects somewhere the
  // outbound didn't).
  const returnLeg = useLegForm();

  // Paste/type box — flight mode only, real AI parsing via parse-flight
  // (text instead of image).
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasteText, setPasteText] = React.useState("");
  const [parsingText, setParsingText] = React.useState(false);
  const [textParsed, setTextParsed] = React.useState(null);
  const [textError, setTextError] = React.useState(null);

  // Upload — real: parse-flight (Claude vision) reads the image, save-flight
  // writes the confirmed result.
  const [uploading, setUploading] = React.useState(false);
  const [uploadParsed, setUploadParsed] = React.useState(null);
  const [uploadError, setUploadError] = React.useState(null);
  const [imagePath, setImagePath] = React.useState(null);

  const [saving, setSaving] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(null);

  React.useEffect(() => {
    if (open && editing) {
      // Prefill from the flight being edited — same "clock digits stored as
      // UTC" convention the rest of the app uses (see dateToFormFields).
      const dep = dateToFormFields(editing.depart);
      const arr = dateToFormFields(editing.arrive);
      setMode(_modeOf(editing));
      setForm({
        travelers: editing.travelers || [],
        airline: editing.airline || "",
        number: editing.number || "",
        from: placeDisplay(editing.from),
        to: placeDisplay(editing.to),
        date: dep.date,
        departTime: dep.time,
        arriveTime: arr.time,
        note: editing.note || "",
      });
    } else if (open && prefill) {
      // Seeded from "Return not logged → click to add" — a fresh entry, not
      // an edit, so it still submits as a normal new flight.
      setMode(prefill.mode || "flight");
      setForm({
        ...EMPTY_TRIP_FORM,
        from: placeDisplay(prefill.from) || "",
        to: placeDisplay(prefill.to) || "",
        travelers: prefill.travelers || [],
      });
    } else if (!open) {
      // reset on close
      setTimeout(() => {
        setMode("flight"); setForm(EMPTY_TRIP_FORM); setRoundTrip(false);
        setPasteOpen(false); setPasteText(""); setParsingText(false); setTextParsed(null); setTextError(null);
        setUploading(false); setUploadParsed(null); setUploadError(null); setImagePath(null);
        setAddingConnection(false); leg2.reset(); returnLeg.reset();
        setSaving(false); setSubmitError(null);
      }, 200);
    }
  }, [open, editing, prefill]);

  const applyParsed = (p) => {
    setForm((f) => ({
      ...f,
      airline: (p.airline_code || f.airline || "").toUpperCase(),
      number: p.flight_number || f.number,
      from: p.from_airport ? placeDisplay(p.from_airport) : f.from,
      to: p.to_airport ? placeDisplay(p.to_airport) : f.to,
      date: p.date || f.date,
      departTime: p.depart_time || f.departTime,
      arriveTime: p.arrive_time || f.arriveTime,
      travelers: !f.travelers.length && matchTravelerByName(p.passenger_name)
        ? [matchTravelerByName(p.passenger_name)]
        : f.travelers,
    }));
  };

  const toggleTraveler = (id) => {
    setForm((f) => ({
      ...f,
      travelers: f.travelers.includes(id) ? f.travelers.filter((x) => x !== id) : [...f.travelers, id],
    }));
  };

  const submit = () => {
    const isFlight = mode === "flight";
    const doRoundTrip = roundTrip && !editing;
    const doConnection = addingConnection && !editing;
    const missing = [];
    if (!form.from) missing.push("where from");
    if (!form.to) missing.push("where to");
    if (!form.date) missing.push("the date");
    if (!form.departTime) missing.push("a departure time");
    if (!form.travelers.length) missing.push("who's traveling");
    if (doRoundTrip) {
      // From/To are optional here — default to the outbound route reversed
      // at submit time (see below) — but date/time aren't guessable.
      if (!returnLeg.form.date) missing.push("the return date");
      if (!returnLeg.form.departTime) missing.push("a return departure time");
    }
    if (doConnection) {
      if (!leg2.form.from) missing.push("the connecting leg's origin");
      if (!leg2.form.to) missing.push("the connecting leg's destination");
      if (!leg2.form.date) missing.push("the connecting leg's date");
      if (!leg2.form.departTime) missing.push("the connecting leg's departure time");
    }
    if (missing.length) {
      setSubmitError(`Still need: ${missing.join(", ")}.`);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    // Everything from here down used to run unguarded — a plain JS bug in
    // this block (a real one happened: a variable referenced below its
    // definition got deleted in an edit) throws synchronously, before the
    // promise chain even starts, which left the button stuck on "Saving…"
    // forever since neither .then() nor .catch() ever got a chance to run.
    // Wrapping it means any such bug still shows an error instead of
    // hanging.
    try {
      const fromCode = placeCode(form.from), toCode = placeCode(form.to);
      const departAt = new Date(`${form.date}T${form.departTime}:00Z`);
      // Arrival is optional (mainly for train/car, where it's often not known
      // upfront) — default to 2 hours out so status still has a valid window.
      const arriveAt = form.arriveTime
        ? new Date(`${form.date}T${form.arriveTime}:00Z`)
        : new Date(departAt.getTime() + 2 * 60 * 60 * 1000);

      // Two legs sharing a journeyId collapse into one card on the board
      // (see buildJourneys in data.js) — generated client-side since both
      // legs need the same id and the first save happens before the second
      // one exists.
      const journeyId = doConnection && window.crypto?.randomUUID ? window.crypto.randomUUID() : null;

      const outboundBody = {
        flightId: editing ? editing.id : undefined,
        mode,
        airline_code: isFlight ? (form.airline || null) : null,
        flight_number: isFlight ? (form.number || null) : null,
        from_airport: fromCode,
        to_airport: toCode,
        depart_at: departAt.toISOString(),
        arrive_at: arriveAt.toISOString(),
        note: form.note || null,
        source: editing ? "edit" : (imagePath ? "upload" : (textParsed ? "paste" : "manual")),
        imagePath: imagePath || null,
        travelerIds: form.travelers,
        // Preserve an existing journey link when editing a single leg of one —
        // otherwise every edit would silently unlink it (nothing else in this
        // form knows or cares that the leg is part of a journey).
        journeyId: journeyId || (editing ? editing.journeyId || undefined : undefined),
      };

      withTimeout(window.supabaseClient.functions.invoke("save-flight", { body: outboundBody }), 20000, "Saving")
        .then(async ({ data, error }) => {
          if (error || !data || !data.ok) {
            setSaving(false);
            const message = (data && data.error) || await readFunctionError(error) || "Couldn't save this trip — mind trying again?";
            setSubmitError(message);
            return;
          }
          if (!doRoundTrip && !doConnection) {
            setSaving(false);
            onSubmit(data.flight);
            onClose();
            return;
          }

          if (doConnection) {
            const leg2FromCode = placeCode(leg2.form.from), leg2ToCode = placeCode(leg2.form.to);
            const leg2DepartAt = new Date(`${leg2.form.date}T${leg2.form.departTime}:00Z`);
            const leg2ArriveAt = leg2.form.arriveTime
              ? new Date(`${leg2.form.date}T${leg2.form.arriveTime}:00Z`)
              : new Date(leg2DepartAt.getTime() + 2 * 60 * 60 * 1000);
            withTimeout(window.supabaseClient.functions.invoke("save-flight", {
              body: {
                mode,
                airline_code: isFlight ? (leg2.form.airline || null) : null,
                flight_number: isFlight ? (leg2.form.number || null) : null,
                from_airport: leg2FromCode,
                to_airport: leg2ToCode,
                depart_at: leg2DepartAt.toISOString(),
                arrive_at: leg2ArriveAt.toISOString(),
                note: form.note || null,
                source: leg2.imagePath ? "upload" : (leg2.parsed ? "paste" : "manual"),
                imagePath: leg2.imagePath || null,
                travelerIds: form.travelers,
                journeyId,
              },
            }), 20000, "Saving connecting leg").then(async ({ data: leg2Data, error: leg2Error2 }) => {
              setSaving(false);
              if (leg2Error2 || !leg2Data || !leg2Data.ok) {
                const message = (leg2Data && leg2Data.error) || await readFunctionError(leg2Error2) || "something went wrong";
                onSubmit(data.flight);
                setSubmitError(`First leg saved, but the connecting leg didn't: ${message}. You can add it separately and link it from the flight's card.`);
                return;
              }
              onSubmit(data.flight);
              onClose();
            }).catch((err) => {
              setSaving(false);
              onSubmit(data.flight);
              setSubmitError(`First leg saved, but the connecting leg didn't: ${String((err && err.message) || err)}`);
            });
            return;
          }

          // Round trip — the outbound saved, now log the return leg too.
          // From/To default to the outbound route reversed when left blank
          // (the common case), but an uploaded/pasted return boarding pass
          // can fill in a different actual route.
          const retFromCode = returnLeg.form.from ? placeCode(returnLeg.form.from) : toCode;
          const retToCode = returnLeg.form.to ? placeCode(returnLeg.form.to) : fromCode;
          const retDepartAt = new Date(`${returnLeg.form.date}T${returnLeg.form.departTime}:00Z`);
          const retArriveAt = returnLeg.form.arriveTime
            ? new Date(`${returnLeg.form.date}T${returnLeg.form.arriveTime}:00Z`)
            : new Date(retDepartAt.getTime() + 2 * 60 * 60 * 1000);
          withTimeout(window.supabaseClient.functions.invoke("save-flight", {
            body: {
              mode,
              airline_code: isFlight ? (returnLeg.form.airline || null) : null,
              flight_number: isFlight ? (returnLeg.form.number || null) : null,
              from_airport: retFromCode,
              to_airport: retToCode,
              depart_at: retDepartAt.toISOString(),
              arrive_at: retArriveAt.toISOString(),
              note: form.note || null,
              source: returnLeg.imagePath ? "upload" : (returnLeg.parsed ? "paste" : "manual"),
              imagePath: returnLeg.imagePath || null,
              travelerIds: form.travelers,
            },
          }), 20000, "Saving return leg").then(async ({ data: retData, error: retError }) => {
            setSaving(false);
            if (retError || !retData || !retData.ok) {
              const message = (retData && retData.error) || await readFunctionError(retError) || "something went wrong";
              onSubmit(data.flight); // outbound did save — refresh the board so it shows
              setSubmitError(`Outbound saved, but the return leg didn't: ${message}. You can add it separately from the flight's card.`);
              return;
            }
            onSubmit(data.flight);
            onClose();
          }).catch((err) => {
            setSaving(false);
            onSubmit(data.flight);
            setSubmitError(`Outbound saved, but the return leg didn't: ${String((err && err.message) || err)}`);
          });
        }).catch((err) => {
          setSaving(false);
          setSubmitError(String((err && err.message) || err));
        });
    } catch (err) {
      setSaving(false);
      setSubmitError(String((err && err.message) || err));
    }
  };

  // Real text parsing: same Claude call as the image path, just fed pasted
  // or typed text instead of a photo.
  const parseText = () => {
    if (!pasteText.trim()) return;
    setParsingText(true);
    setTextError(null);
    withTimeout(window.supabaseClient.functions.invoke("parse-flight", {
      body: { text: pasteText },
    }), 30000, "Reading").then(async ({ data, error }) => {
      setParsingText(false);
      if (error || !data || !data.ok) {
        const message = (data && data.error) || await readFunctionError(error) || "Couldn't make sense of that — try filling in the fields below instead?";
        setTextError(message);
        return;
      }
      setTextParsed(data.parsed);
      applyParsed(data.parsed);
    }).catch((err) => {
      setParsingText(false);
      setTextError(String((err && err.message) || err));
    });
  };

  // Read the file, ship it to the parse-flight Edge Function (which stores
  // the image and asks Claude to read it), then move to the form prefilled
  // with whatever it found so a human can confirm/fix before saving.
  const handleFileSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setMode("flight");
    setUploading(true);
    setUploadError(null);
    setUploadParsed(null);

    resizeImageForUpload(file).then((blob) => {
      const reader = new FileReader();
      reader.onerror = () => { setUploading(false); setUploadError("Couldn't read that file — try a different one?"); };
      reader.onload = () => {
        const base64 = String(reader.result).split(",")[1];
        withTimeout(window.supabaseClient.functions.invoke("parse-flight", {
          body: { image: base64, mediaType: "image/jpeg" },
        }), 30000, "Reading").then(async ({ data, error }) => {
          setUploading(false);
          if (error || !data || !data.ok) {
            const message = (data && data.error) || await readFunctionError(error) || "Couldn't read that image — mind typing the details in below?";
            setUploadError(message);
            return;
          }
          setImagePath(data.imagePath);
          setUploadParsed(data.parsed);
          applyParsed(data.parsed);
        }).catch((err) => {
          setUploading(false);
          setUploadError(String((err && err.message) || err));
        });
      };
      reader.readAsDataURL(blob);
    }).catch((err) => {
      setUploading(false);
      setUploadError(String((err && err.message) || err));
    });
  };

  // Soft plausibility check on the two legs — never blocks saving, just
  // flags when this doesn't look like a real connection (different city than
  // where one leg lands, or a gap too short/long to be a layover) so
  // whoever's entering it can double check before it's shown as one journey.
  // Which box is "leg 1" in the form vs. which leg actually departs first
  // are two different things — someone might paste in the second boarding
  // pass before the first — so this always sorts by actual departure time
  // rather than assuming the form fields are in chronological order.
  let connectionWarning = null;
  if (addingConnection && form.to && form.from && leg2.form.from && leg2.form.to && form.date && form.departTime && leg2.form.date && leg2.form.departTime) {
    const formDepart = new Date(`${form.date}T${form.departTime}:00Z`);
    const formArrive = form.arriveTime ? new Date(`${form.date}T${form.arriveTime}:00Z`) : new Date(formDepart.getTime() + 2 * 60 * 60 * 1000);
    const leg2Depart = new Date(`${leg2.form.date}T${leg2.form.departTime}:00Z`);
    const leg2Arrive = leg2.form.arriveTime ? new Date(`${leg2.form.date}T${leg2.form.arriveTime}:00Z`) : new Date(leg2Depart.getTime() + 2 * 60 * 60 * 1000);
    const formIsEarlier = formDepart <= leg2Depart;
    const earlierTo = placeCode(formIsEarlier ? form.to : leg2.form.to).toUpperCase();
    const laterFrom = placeCode(formIsEarlier ? leg2.form.from : form.from).toUpperCase();
    const earlierArrive = formIsEarlier ? formArrive : leg2Arrive;
    const laterDepart = formIsEarlier ? leg2Depart : formDepart;
    if (!window.MGData.placesMatch(earlierTo, laterFrom)) {
      connectionWarning = `The earlier leg lands at ${earlierTo}, but the later one leaves from ${laterFrom} — that's not a connection at the same airport. It'll still save, but double-check this is right.`;
    } else {
      const gapMs = laterDepart - earlierArrive;
      if (gapMs < 20 * 60 * 1000) {
        connectionWarning = "That's a very short layover (under 20 minutes) — worth double-checking the times.";
      } else if (gapMs > 8 * 60 * 60 * 1000) {
        connectionWarning = "That's more than an 8-hour gap — more like a separate later trip than a connection. It'll still save linked, but consider unchecking this if that's not what you mean.";
      }
    }
  }

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="at">
        <header className="at__head">
          <h2 className="at__title">{editing ? "Edit Trip" : "Share Travel Details"}</h2>
        </header>

        <div className="at__body">
          <div className="at__field at__field--full">
            <span>How are you getting there?</span>
            <div className="at__mode-toggle" role="radiogroup" aria-label="Journey mode">
              {["flight", "train", "car"].map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  className={mode === m ? "on" : ""}
                  onClick={() => setMode(m)}
                >
                  <span aria-hidden="true">{_MODE[m].icon}</span>
                  <span>{_MODE[m].label}</span>
                </button>
              ))}
            </div>
          </div>

          {mode === "flight" && !editing && (
            <div className="at__quickfill">
              <label className="at__upload-cta" htmlFor="at-file-input">
                <input
                  id="at-file-input"
                  type="file"
                  accept="image/*"
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                <span className="at__upload-cta-icon">⬆</span>
                <span>Upload image to autofill travel details</span>
              </label>
              <button className="at__paste-link" onClick={() => setPasteOpen((v) => !v)}>
                {pasteOpen ? "Hide paste box" : "or paste in your details here"}
              </button>

              {(uploading || uploadError || uploadParsed) && (
                <>
                  {uploading && (
                    <div className="at__parsed at__parsed--pending">
                      <span className="at__spinner" aria-hidden="true" />
                      Reading your boarding pass…
                    </div>
                  )}
                  {uploadError && (
                    <div className="at__parsed at__parsed--error">
                      <div className="at__parsed-mark">!</div>
                      <div>{uploadError}</div>
                    </div>
                  )}
                  {uploadParsed && !uploadError && (
                    <div className="at__parsed">
                      <div className="at__parsed-mark">✓</div>
                      <div>
                        <strong>Got it!</strong> {uploadParsed.airline_code || "—"}{uploadParsed.flight_number || ""}
                        {uploadParsed.from_airport && uploadParsed.to_airport
                          ? `, ${uploadParsed.from_airport} → ${uploadParsed.to_airport}` : ""}.
                        Double-check the fields below and save.
                        {uploadParsed.low_confidence_fields && uploadParsed.low_confidence_fields.length > 0 && (
                          <div className="at__parsed-note">Worth double-checking: {uploadParsed.low_confidence_fields.join(", ")}.</div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {pasteOpen && (
                <label className="at__field at__field--full">
                  <span>Paste or type your flight details here</span>
                  <textarea
                    rows={3}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={`British Airways BA286, SFO to LHR, Sat May 23, depart 8:40pm arrive 2:55pm`}
                  />
                  <button className="at__primary at__paste-btn" onClick={parseText} disabled={parsingText || !pasteText.trim()}>
                    {parsingText ? <><span className="at__spinner at__spinner--light" aria-hidden="true" /> Reading…</> : "Fill in from text"}
                  </button>
                </label>
              )}
              {textError && (
                <div className="at__parsed at__parsed--error">
                  <div className="at__parsed-mark">!</div>
                  <div>{textError}</div>
                </div>
              )}
              {textParsed && !textError && (
                <div className="at__parsed">
                  <div className="at__parsed-mark">✓</div>
                  <div>
                    <strong>Got it!</strong> {textParsed.airline_code || "—"}{textParsed.flight_number || ""}
                    {textParsed.from_airport && textParsed.to_airport
                      ? `, ${textParsed.from_airport} → ${textParsed.to_airport}` : ""}.
                    Double-check the fields below and save.
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "flight" && (
            <div className="at__row">
              <label className="at__field">
                <span>Airline (optional)</span>
                <input
                  list="at-airline-list"
                  value={form.airline}
                  onChange={(e) => setForm({ ...form, airline: e.target.value.toUpperCase() })}
                  placeholder="UA"
                />
                <datalist id="at-airline-list">
                  {Object.entries(_AL).map(([code, a]) => (
                    <option key={code} value={code}>{code} — {a.name}</option>
                  ))}
                </datalist>
              </label>
              <label className="at__field">
                <span>Flight # (optional)</span>
                <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="286" />
              </label>
            </div>
          )}
          <div className="at__row">
            <label className="at__field">
              <span>From{mode === "flight" ? " (city or airport — code optional)" : ""}</span>
              <input
                list="at-airport-list"
                value={form.from}
                onChange={(e) => setForm({ ...form, from: e.target.value })}
                placeholder="San Francisco"
              />
            </label>
            <label className="at__field">
              <span>To{mode === "flight" ? " (city or airport — code optional)" : ""}</span>
              <input
                list="at-airport-list"
                value={form.to}
                onChange={(e) => setForm({ ...form, to: e.target.value })}
                placeholder="London"
              />
            </label>
          </div>
          {/* Always rendered (not just in flight mode) — train/car legs are
              free-text places, but offering the same recognized-city list
              means "Istanbul" and "IST" resolve to the same value instead
              of looking like two different places to isConnectionCandidate
              (see placesMatch, data.js) if someone types instead of picks. */}
          <datalist id="at-airport-list">
            {Object.entries(_AP).map(([code, a]) => (
              <option key={code} value={`${a.city} (${code})`}>{a.city}, {a.country}</option>
            ))}
          </datalist>

          <label className="at__field at__field--full">
            <span>Date</span>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <div className="at__row at__row--times">
            <label className="at__field">
              <span>Depart</span>
              <input type="time" value={form.departTime} onChange={(e) => setForm({ ...form, departTime: e.target.value })} />
            </label>
            <label className="at__field">
              <span>Arrive{mode !== "flight" ? " (optional)" : ""}</span>
              <input type="time" value={form.arriveTime} onChange={(e) => setForm({ ...form, arriveTime: e.target.value })} />
            </label>
          </div>
          <div className="at__hint">Local time at departure/arrival — enter exactly what's printed on the ticket.</div>

          {!editing && !addingConnection && (
            <label className="at__checkbox">
              <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
              <span>This is a round trip — log the return leg too</span>
            </label>
          )}
          {roundTrip && !editing && (
            <>
              <LegFields
                leg={returnLeg} idPrefix="at-return" title="Return leg" isFlight={mode === "flight"}
                fromPlaceholder={form.to ? `Usually ${form.to}` : undefined} fromOptional
                toPlaceholder={form.from ? `Usually ${form.from}` : undefined} toOptional
                pasteExample={`United UA935, LHR to SFO, Sat May 30, depart 1:15pm arrive 4:50pm`}
              />
              <div className="at__hint">Same travelers as above.</div>
            </>
          )}

          {mode === "flight" && !editing && !roundTrip && (
            <label className="at__checkbox">
              <input type="checkbox" checked={addingConnection} onChange={(e) => setAddingConnection(e.target.checked)} />
              <span>This is a connecting flight — I have a second boarding pass to add</span>
            </label>
          )}
          {addingConnection && !editing && (
            <>
              <LegFields
                leg={leg2} idPrefix="at-leg2" title="Connecting leg" isFlight
                fromPlaceholder={form.to ? `Usually ${form.to}` : "New York"}
                toPlaceholder="London"
                pasteExample={`United UA934, JFK to LHR, Sat May 23, depart 11:40pm arrive 11:55am`}
              />
              <div className="at__hint">Same travelers as above.</div>
              {connectionWarning && (
                <div className="at__parsed at__parsed--error">
                  <div className="at__parsed-mark">!</div>
                  <div>{connectionWarning}</div>
                </div>
              )}
            </>
          )}

          <div className="at__field at__field--full">
            <span>Who's traveling?</span>
            <div className="at__people">
              {_FAM.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`at__person ${form.travelers.includes(p.id) ? "on" : ""}`}
                  onClick={() => toggleTraveler(p.id)}
                >
                  <Avatar person={p} size={28} />
                  <span>{p.first}</span>
                </button>
              ))}
            </div>
          </div>

          <label className="at__field at__field--full">
            <span>A note for the family (optional)</span>
            <textarea rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })}
                      placeholder="Heading home for the holidays!" />
          </label>

          {submitError && <div className="at__error">{submitError}</div>}
          <div className="at__actions">
            <button className="at__secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="at__primary" onClick={submit} disabled={saving}>
              {saving ? <><span className="at__spinner at__spinner--light" aria-hidden="true" /> Saving…</> : editing ? "Save changes" : "Add to the board"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

Object.assign(window, { Modal, FlightDetailModal, AddTripModal });
