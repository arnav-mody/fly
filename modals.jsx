// modals.jsx — FlightDetail + AddTrip modals for the Mody-Gandhi Travel Tracker.

const { FAMILY: _FAM, FLIGHTS: _FLT, AIRLINES: _AL, AIRPORTS: _AP } = window.MGData;
const _flightStatus = window.MGData.flightStatus;
const _familyById   = window.MGData.familyById;
const _airline      = window.MGData.airline;
const _airport      = window.MGData.airport;
const _flightAwareUrl = window.MGData.flightAwareUrl;

// supabase-js only exposes a generic "Edge Function returned a non-2xx
// status code" on failure — it doesn't parse the response body for you. The
// actual JSON error we sent back (see parse-flight/save-flight) is sitting
// on error.context, which is the raw Response object. Dig it out so people
// see the real reason instead of this one useless sentence every time.
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
function FlightDetailModal({ flight, onClose, now }) {
  if (!flight) return null;
  const status   = _flightStatus(flight, now);
  const al       = _airline(flight.airline);
  const from     = { ..._airport(flight.from), code: flight.from };
  const to       = { ..._airport(flight.to),   code: flight.to };
  const travelers = flight.travelers.map(_familyById).filter(Boolean);

  return (
    <Modal open={!!flight} onClose={onClose} size="lg">
      <div className="fd">
        {/* Hero — route map + status */}
        <div className={`fd__hero fd__hero--${status}`}>
          <div className="fd__hero-inner">
            <div className="fd__statusrow">
              <StatusPill status={status} />
              <span className="fd__id">
                <span style={{ color: al.color, fontWeight: 700 }}>{flight.airline}</span>{flight.number}
                <span className="fd__id-sep">·</span>
                {fmtDateLong(flight.depart)}
              </span>
            </div>
            <h1 className="fd__title">
              <span className="fd__city">
                <span className="fd__city-name">{from.city}</span>
                <span className="fd__city-code">{from.code}</span>
              </span>
              <span className="fd__arrow">→</span>
              <span className="fd__city">
                <span className="fd__city-name">{to.city}</span>
                <span className="fd__city-code">{to.code}</span>
              </span>
            </h1>
            <div className="fd__map">
              <RouteMap from={from} to={to} progress={flight.progress ?? 0} status={status} height={280} />
            </div>
          </div>
        </div>

        {/* Status detail */}
        <div className="fd__statusdetail">
          {status === "airborne" && (
            <>
              <FlightProgress flight={flight} now={now} />
              <div className="fd__stats">
                <Stat label="Altitude"  value={`${flight.cruisingAlt?.toLocaleString() ?? "—"} ft`} />
                <Stat label="Ground speed" value={`${flight.speed ?? "—"} kts`} />
                <Stat label="Aircraft"  value={flight.aircraft ?? "—"} />
              </div>
            </>
          )}
          {(status === "boarding" || status === "scheduled") && (
            <Countdown target={flight.depart} label="Taking off in" dramatic now={now} />
          )}
          {status === "landed" && (
            <div className="fd__landed">
              <div className="fd__landed-mark">✓</div>
              <div>
                <div className="fd__landed-title">Landed safely</div>
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
                  <div className="fd__traveler-role">{p.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Family reactions (mocked) */}
        <div className="fd__details fd__details--reactions">
          <h3 className="fd__h">Family says</h3>
          <div className="fd__reactions">
            <Reaction person={_familyById("bharat")} text="Safe travels, beta. Text Dadiji when you land." />
            <Reaction person={_familyById("asha")}   text="Take a sweater, it gets cold!" />
            <Reaction person={_familyById("priya")}  text="Have so much fun! ❤️" />
          </div>
          <div className="fd__react-input">
            <input placeholder="Send a note for the journey…" />
            <button>Send</button>
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
function Reaction({ person, text }) {
  if (!person) return null;
  return (
    <div className="reaction">
      <Avatar person={person} size={32} />
      <div>
        <span className="reaction__name">{person.nick || person.first}</span>
        <span className="reaction__txt">{text}</span>
      </div>
    </div>
  );
}

// ── AddTrip modal ───────────────────────────────────────────────────────────
function AddTripModal({ open, onClose, onSubmit }) {
  const [tab, setTab] = React.useState("form");
  const [parsing, setParsing] = React.useState(false);   // "Paste confirmation" tab — still a mock
  const [parsed, setParsed]   = React.useState(null);
  const [form, setForm]       = React.useState({
    travelers: [],
    airline: "UA", number: "",
    from: "", to: "",
    date: "", departTime: "", arriveTime: "",
    seat: "", confirmation: "", note: "",
  });

  // "Upload boarding pass" tab — this one is real: parse-flight (Claude
  // vision) reads the image, save-flight writes the confirmed result.
  const [uploading, setUploading] = React.useState(false);
  const [uploadParsed, setUploadParsed] = React.useState(null);
  const [uploadError, setUploadError] = React.useState(null);
  const [imagePath, setImagePath] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [submitError, setSubmitError] = React.useState(null);

  React.useEffect(() => {
    if (!open) {
      // reset on close
      setTimeout(() => {
        setTab("form"); setParsing(false); setParsed(null);
        setUploading(false); setUploadParsed(null); setUploadError(null); setImagePath(null);
        setSaving(false); setSubmitError(null);
        setForm({ travelers: [], airline: "UA", number: "", from: "", to: "",
                  date: "", departTime: "", arriveTime: "", seat: "", confirmation: "", note: "" });
      }, 200);
    }
  }, [open]);

  const toggleTraveler = (id) => {
    setForm((f) => ({
      ...f,
      travelers: f.travelers.includes(id) ? f.travelers.filter((x) => x !== id) : [...f.travelers, id],
    }));
  };

  const submit = () => {
    if (!form.travelers.length || !form.number || !form.from || !form.to || !form.date) return;
    setSaving(true);
    setSubmitError(null);
    window.supabaseClient.functions.invoke("save-flight", {
      body: {
        airline_code: form.airline || null,
        flight_number: form.number,
        from_airport: form.from,
        to_airport: form.to,
        depart_at: new Date(`${form.date}T${form.departTime || "12:00"}:00Z`).toISOString(),
        arrive_at: new Date(`${form.date}T${form.arriveTime || "16:00"}:00Z`).toISOString(),
        seat: form.seat || null,
        confirmation: form.confirmation || null,
        note: form.note || null,
        source: imagePath ? "upload" : "manual",
        imagePath: imagePath || null,
        travelerIds: form.travelers,
      },
    }).then(async ({ data, error }) => {
      setSaving(false);
      if (error || !data || !data.ok) {
        const message = (data && data.error) || await readFunctionError(error) || "Couldn't save this flight — mind trying again?";
        setSubmitError(message);
        return;
      }
      onSubmit(data.flight);
      onClose();
    }).catch((err) => {
      setSaving(false);
      setSubmitError(String((err && err.message) || err));
    });
  };

  // Mock email-paste parsing — pretend to extract structured data after a
  // brief delay, then prefill the form fields. (The upload tab below this
  // one is the real thing; this tab is still a demo.)
  const mockParse = () => {
    setParsing(true);
    setTimeout(() => {
      const fake = {
        airline: "BA", number: "286",
        from: "SFO", to: "LHR",
        date: "2026-05-23", departTime: "20:40", arriveTime: "14:55",
        seat: "24E, 24F", confirmation: "B9N7TM",
        travelers: [],
      };
      setParsed(fake);
      setForm((f) => ({ ...f, ...fake }));
      setParsing(false);
    }, 1500);
  };

  // Real upload: read the file, ship it to the parse-flight Edge Function
  // (which stores the image and asks Claude to read it), then prefill the
  // Quick Form tab with whatever it found so a human can confirm/fix before
  // saving.
  const handleFileSelect = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadParsed(null);

    const reader = new FileReader();
    reader.onerror = () => { setUploading(false); setUploadError("Couldn't read that file — try a different one?"); };
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1];
      window.supabaseClient.functions.invoke("parse-flight", {
        body: { image: base64, mediaType: file.type },
      }).then(async ({ data, error }) => {
        setUploading(false);
        if (error || !data || !data.ok) {
          const message = (data && data.error) || await readFunctionError(error) || "Couldn't read that image — try Quick Form instead?";
          setUploadError(message);
          return;
        }
        const p = data.parsed;
        setImagePath(data.imagePath);
        setUploadParsed(p);
        setForm((f) => ({
          ...f,
          airline: (p.airline_code || f.airline || "").toUpperCase(),
          number: p.flight_number || f.number,
          from: (p.from_airport || f.from || "").toUpperCase(),
          to: (p.to_airport || f.to || "").toUpperCase(),
          date: p.date || f.date,
          departTime: p.depart_time || f.departTime,
          arriveTime: p.arrive_time || f.arriveTime,
          seat: p.seat || f.seat,
          confirmation: p.confirmation || f.confirmation,
        }));
      }).catch((err) => {
        setUploading(false);
        setUploadError(String((err && err.message) || err));
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <Modal open={open} onClose={onClose} size="md">
      <div className="at">
        <header className="at__head">
          <div className="at__kicker">Add a trip</div>
          <h2 className="at__title">Where are you flying?</h2>
          <p className="at__sub">Dadaji will see this on the board the moment you save.</p>
        </header>

        <div className="at__tabs" role="tablist">
          <button role="tab" aria-selected={tab === "form"}    onClick={() => setTab("form")}    className={tab === "form" ? "on" : ""}>
            <span className="at__tab-num">01</span>
            <span className="at__tab-lbl">Quick form</span>
          </button>
          <button role="tab" aria-selected={tab === "email"}   onClick={() => setTab("email")}   className={tab === "email" ? "on" : ""}>
            <span className="at__tab-num">02</span>
            <span className="at__tab-lbl">Paste confirmation</span>
          </button>
          <button role="tab" aria-selected={tab === "upload"}  onClick={() => setTab("upload")}  className={tab === "upload" ? "on" : ""}>
            <span className="at__tab-num">03</span>
            <span className="at__tab-lbl">Upload boarding pass</span>
          </button>
        </div>

        {tab === "email" && (
          <div className="at__body">
            <label className="at__field at__field--full">
              <span>Paste your booking confirmation email here</span>
              <textarea
                rows={7}
                placeholder={`Your booking is confirmed!\nBritish Airways flight BA 286\nSan Francisco (SFO) → London Heathrow (LHR)\nSat, May 23 · Depart 8:40 PM · Arrive 2:55 PM (+1)\nSeats 24E, 24F · Confirmation B9N7TM`}
              />
            </label>
            <button className="at__primary" onClick={mockParse} disabled={parsing}>
              {parsing ? "Reading the email…" : "Parse details"}
            </button>
            {parsed && (
              <div className="at__parsed">
                <div className="at__parsed-mark">✓</div>
                <div>
                  <strong>Got it!</strong> We picked up {parsed.airline}{parsed.number}, {parsed.from} → {parsed.to}.
                  Switch to the Quick Form tab to add who's traveling and save.
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "upload" && (
          <div className="at__body">
            <label className="at__drop" htmlFor="at-file-input">
              <input
                id="at-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={handleFileSelect}
                style={{ display: "none" }}
              />
              <div className="at__drop-icon">⬆</div>
              <div className="at__drop-title">
                {uploading ? "Reading your boarding pass…" : "Upload a photo of your boarding pass or ticket"}
              </div>
              <div className="at__drop-sub">Click to choose a file · PNG, JPG, or WebP</div>
              {uploading && <div className="at__drop-loading">This usually takes a few seconds…</div>}
            </label>
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
                  Switch to Quick Form to pick who's traveling, double-check the details, and save.
                  {uploadParsed.low_confidence_fields && uploadParsed.low_confidence_fields.length > 0 && (
                    <div className="at__parsed-note">Worth double-checking: {uploadParsed.low_confidence_fields.join(", ")}.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "form" && (
          <div className="at__body">
            <div className="at__row">
              <label className="at__field">
                <span>Airline</span>
                <select value={form.airline} onChange={(e) => setForm({ ...form, airline: e.target.value })}>
                  {Object.entries(_AL).map(([code, a]) => (
                    <option key={code} value={code}>{code} — {a.name}</option>
                  ))}
                </select>
              </label>
              <label className="at__field at__field--narrow">
                <span>Flight #</span>
                <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="286" />
              </label>
            </div>
            <div className="at__row">
              <label className="at__field">
                <span>From (airport code)</span>
                <input value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value.toUpperCase() })} placeholder="SFO" maxLength="3" />
              </label>
              <label className="at__field">
                <span>To (airport code)</span>
                <input value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value.toUpperCase() })} placeholder="LHR" maxLength="3" />
              </label>
            </div>
            <div className="at__row">
              <label className="at__field">
                <span>Date</span>
                <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </label>
              <label className="at__field at__field--narrow">
                <span>Depart</span>
                <input type="time" value={form.departTime} onChange={(e) => setForm({ ...form, departTime: e.target.value })} />
              </label>
              <label className="at__field at__field--narrow">
                <span>Arrive</span>
                <input type="time" value={form.arriveTime} onChange={(e) => setForm({ ...form, arriveTime: e.target.value })} />
              </label>
            </div>
            <div className="at__row">
              <label className="at__field">
                <span>Seat(s)</span>
                <input value={form.seat} onChange={(e) => setForm({ ...form, seat: e.target.value })} placeholder="24E, 24F" />
              </label>
              <label className="at__field">
                <span>Confirmation</span>
                <input value={form.confirmation} onChange={(e) => setForm({ ...form, confirmation: e.target.value })} placeholder="B9N7TM" />
              </label>
            </div>

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
                {saving ? "Saving…" : "Add to the board"}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

Object.assign(window, { Modal, FlightDetailModal, AddTripModal });
