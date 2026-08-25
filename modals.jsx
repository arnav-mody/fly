// modals.jsx — FlightDetail + AddTrip modals for the Mody-Gandhi Travel Tracker.

const { FAMILY: _FAM, FLIGHTS: _FLT, AIRLINES: _AL, AIRPORTS: _AP } = window.MGData;
const _flightStatus = window.MGData.flightStatus;
const _familyById   = window.MGData.familyById;
const _airline      = window.MGData.airline;
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
function FlightDetailModal({ flight, onClose, now, onEdit, onDeleted, allFlights, onAddReturn }) {
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState(null);
  React.useEffect(() => { setDeleting(false); setDeleteError(null); }, [flight?.id]);

  if (!flight) return null;
  const status   = _flightStatus(flight, now);
  const mode     = _modeOf(flight);
  const isFlight = mode === "flight";
  const meta     = _modeMeta(flight);
  const al       = _airline(flight.airline);
  const from     = { ..._airport(flight.from), code: flight.from };
  const to       = { ..._airport(flight.to),   code: flight.to };
  const travelers = flight.travelers.map(_familyById).filter(Boolean);
  const noReturn = (status === "landed" || status === "past") && allFlights && !_hasLoggedReturn(flight, allFlights);

  const handleDelete = () => {
    if (!window.confirm(`Delete this trip (${flight.from} → ${flight.to})? This can't be undone.`)) return;
    setDeleting(true);
    setDeleteError(null);
    withTimeout(
      window.supabaseClient.functions.invoke("delete-flight", { body: { flightId: flight.id } }),
      15000, "Deleting"
    ).then(async ({ data, error }) => {
      setDeleting(false);
      if (error || !data || !data.ok) {
        const message = (data && data.error) || await readFunctionError(error) || "Couldn't delete this trip — mind trying again?";
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

  return (
    <Modal open={!!flight} onClose={onClose} size="lg">
      <div className="fd">
        {/* Hero — route map + status */}
        <div className={`fd__hero fd__hero--${status}`}>
          <div className="fd__hero-inner">
            <div className="fd__statusrow">
              <StatusPill status={status} mode={mode} />
              <span className="fd__id">
                {isFlight
                  ? <><span style={{ color: al.color, fontWeight: 700 }}>{flight.airline}</span>{flight.number}</>
                  : <span style={{ fontWeight: 700 }}>{meta.icon} {meta.label}</span>}
                <span className="fd__id-sep">·</span>
                {fmtDateLong(flight.depart)}
              </span>
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
            <div className="fd__map">
              {isFlight && _hasCoords(from, to)
                ? <RouteMap from={from} to={to} progress={flight.progress ?? 0} status={status} height={280} />
                : <div className="tcard__mode-block" style={{ height: 280 }}>{meta.icon}</div>}
            </div>
          </div>
        </div>

        {/* Status detail */}
        <div className="fd__statusdetail">
          {status === "airborne" && (
            <>
              <FlightProgress flight={flight} now={now} />
              {isFlight && (
                <div className="fd__stats">
                  <Stat label="Altitude"  value={`${flight.cruisingAlt?.toLocaleString() ?? "—"} ft`} />
                  <Stat label="Ground speed" value={`${flight.speed ?? "—"} kts`} />
                  <Stat label="Aircraft"  value={flight.aircraft ?? "—"} />
                </div>
              )}
            </>
          )}
          {(status === "boarding" || status === "scheduled") && (
            <Countdown target={flight.depart} label={isFlight ? "Taking off in" : "Departs in"} dramatic now={now} />
          )}
          {status === "landed" && (
            <div className="fd__landed">
              <div className="fd__landed-mark">✓</div>
              <div>
                <div className="fd__landed-title">{isFlight ? "Landed safely" : "Arrived safely"}</div>
                <div className="fd__landed-sub">
                  {fmtDuration(now - flight.arrive)} ago · arrived {fmtTime(flight.arrive)} {to.tz}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Note from the traveler */}
        {flight.note && (
          <div className="fd__note">
            <div className="fd__note-kicker">A note from {travelers[0]?.first}</div>
            <p>"{flight.note}"</p>
          </div>
        )}

        {/* Itinerary details */}
        <div className="fd__details">
          <h3 className="fd__h">Itinerary</h3>
          <BoardingPassStrip flight={flight} />
          {noReturn && (
            <button className="card__no-return fd__no-return" onClick={() => onAddReturn(flight)}>
              Return not logged — click to add
            </button>
          )}
          {isFlight && (
            <>
              <div className="fd__grid">
                <DetailField label="Confirmation" value={flight.confirmation ?? "—"} mono />
                <DetailField label="Terminal" value={flight.terminal ?? "—"} mono />
                <DetailField label="Gate" value={flight.gate ?? "—"} mono />
                <DetailField label="Seat" value={flight.seat ?? "—"} mono />
                <DetailField label="Aircraft" value={flight.aircraft ?? "—"} />
                <DetailField label="Operated by" value={al.name} />
              </div>
              <a
                className="fa-link fd__fa"
                href={_flightAwareUrl(flight)}
                target="_blank" rel="noopener noreferrer"
              >
                Track live on FlightAware <span className="fa-link__arrow">↗</span>
              </a>
            </>
          )}
        </div>

        {/* Travelers */}
        <div className="fd__details">
          <h3 className="fd__h">Who's on this flight</h3>
          <div className="fd__travelers">
            {travelers.map((p) => (
              <div key={p.id} className="fd__traveler">
                <Avatar person={p} size={52} />
                <div>
                  <div className="fd__traveler-name">{p.first} {p.last}</div>
                  {p.role && <div className="fd__traveler-role">{p.role}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Family reactions */}
        <div className="fd__details fd__details--reactions">
          <h3 className="fd__h">Family says</h3>
          <div className="fd__reactions">
            <div className="fd__reactions-empty">No notes yet — be the first to say something.</div>
          </div>
          <div className="fd__react-input">
            <input placeholder="Send a note for the journey…" />
            <button>Send</button>
          </div>
        </div>

        {/* Manage */}
        <div className="fd__manage">
          {deleteError && <div className="fd__manage-error">{deleteError}</div>}
          <div className="fd__manage-actions">
            <button className="fd__manage-btn" onClick={() => onEdit(flight)} disabled={deleting}>
              Edit trip
            </button>
            <button className="fd__manage-btn fd__manage-btn--danger" onClick={handleDelete} disabled={deleting}>
              {deleting ? <><span className="at__spinner" aria-hidden="true" /> Deleting…</> : "Delete trip"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat__lbl">{label}</div>
      <div className="stat__val">{value}</div>
    </div>
  );
}
function DetailField({ label, value, mono }) {
  return (
    <div className="detail-field">
      <div className="detail-field__lbl">{label}</div>
      <div className={`detail-field__val ${mono ? "detail-field__val--mono" : ""}`}>{value}</div>
    </div>
  );
}

// ── AddTrip modal ───────────────────────────────────────────────────────────
// One screen: the upload button, the paste-toggle, and the review/edit form
// are all visible together from the moment the modal opens — no click-through
// required. Uploading or pasting fills in the same fields live, in place.
const EMPTY_TRIP_FORM = {
  travelers: [], airline: "", number: "",
  from: "", to: "", date: "", departTime: "", arriveTime: "", note: "",
  returnDate: "", returnDepartTime: "", returnArriveTime: "",
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

function AddTripModal({ open, onClose, onSubmit, editing, prefill }) {
  const [mode, setMode] = React.useState("flight");     // "flight" | "train" | "car"
  const [form, setForm] = React.useState(EMPTY_TRIP_FORM);
  const [roundTrip, setRoundTrip] = React.useState(false); // create-flow only — logs both legs at once

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
    const missing = [];
    if (!form.from) missing.push("where from");
    if (!form.to) missing.push("where to");
    if (!form.date) missing.push("the date");
    if (!form.departTime) missing.push("a departure time");
    if (!form.travelers.length) missing.push("who's traveling");
    if (doRoundTrip) {
      if (!form.returnDate) missing.push("the return date");
      if (!form.returnDepartTime) missing.push("a return departure time");
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
      };

      withTimeout(window.supabaseClient.functions.invoke("save-flight", { body: outboundBody }), 20000, "Saving")
        .then(async ({ data, error }) => {
          if (error || !data || !data.ok) {
            setSaving(false);
            const message = (data && data.error) || await readFunctionError(error) || "Couldn't save this trip — mind trying again?";
            setSubmitError(message);
            return;
          }
          if (!doRoundTrip) {
            setSaving(false);
            onSubmit(data.flight);
            onClose();
            return;
          }

          // Round trip — the outbound saved, now log the return leg too
          // (same travelers/mode, route reversed).
          const retDepartAt = new Date(`${form.returnDate}T${form.returnDepartTime}:00Z`);
          const retArriveAt = form.returnArriveTime
            ? new Date(`${form.returnDate}T${form.returnArriveTime}:00Z`)
            : new Date(retDepartAt.getTime() + 2 * 60 * 60 * 1000);
          withTimeout(window.supabaseClient.functions.invoke("save-flight", {
            body: {
              mode,
              from_airport: toCode,
              to_airport: fromCode,
              depart_at: retDepartAt.toISOString(),
              arrive_at: retArriveAt.toISOString(),
              note: form.note || null,
              source: "manual",
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

          {mode === "flight" ? (
            <>
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
              <div className="at__row">
                <label className="at__field">
                  <span>From (city or airport — code optional)</span>
                  <input
                    list="at-airport-list"
                    value={form.from}
                    onChange={(e) => setForm({ ...form, from: e.target.value })}
                    placeholder="San Francisco"
                  />
                </label>
                <label className="at__field">
                  <span>To (city or airport — code optional)</span>
                  <input
                    list="at-airport-list"
                    value={form.to}
                    onChange={(e) => setForm({ ...form, to: e.target.value })}
                    placeholder="London"
                  />
                </label>
                <datalist id="at-airport-list">
                  {Object.entries(_AP).map(([code, a]) => (
                    <option key={code} value={`${a.city} (${code})`}>{a.city}, {a.country}</option>
                  ))}
                </datalist>
              </div>
            </>
          ) : (
            <div className="at__row">
              <label className="at__field">
                <span>From</span>
                <input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} placeholder="San Francisco" />
              </label>
              <label className="at__field">
                <span>To</span>
                <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="Los Angeles" />
              </label>
            </div>
          )}

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

          {!editing && (
            <label className="at__checkbox">
              <input type="checkbox" checked={roundTrip} onChange={(e) => setRoundTrip(e.target.checked)} />
              <span>This is a round trip — log the return leg too</span>
            </label>
          )}
          {roundTrip && !editing && (
            <>
              <label className="at__field at__field--full">
                <span>Return date</span>
                <input type="date" value={form.returnDate} onChange={(e) => setForm({ ...form, returnDate: e.target.value })} />
              </label>
              <div className="at__row at__row--times">
                <label className="at__field">
                  <span>Return depart</span>
                  <input type="time" value={form.returnDepartTime} onChange={(e) => setForm({ ...form, returnDepartTime: e.target.value })} />
                </label>
                <label className="at__field">
                  <span>Return arrive{mode !== "flight" ? " (optional)" : ""}</span>
                  <input type="time" value={form.returnArriveTime} onChange={(e) => setForm({ ...form, returnArriveTime: e.target.value })} />
                </label>
              </div>
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
