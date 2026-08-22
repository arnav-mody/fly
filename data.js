// Mody-Gandhi Travel Tracker — data
// Family roster is real; flights start empty and accumulate from real
// uploads. (Demo flight data used to live here for prototyping — removed
// now that the roster is real, since it referenced family-member IDs that
// no longer exist.)

// Time anchor kept around for the `t()`/hours()/days() helpers below, which
// are still handy for one-off date math — but useNow() (components.jsx) uses
// real wall-clock time, not this.
const NOW = new Date();

// Family members. The `tone` controls each person's monogram color so the
// directory + avatars feel distinct without leaning on stock photos.
// `home`/`homeAirport` are deliberately unset — they're not known yet, and
// the Calendar view's "away from home" detection just quietly no-ops until
// they're filled in with real values (see familyById in this file for how
// a missing homeAirport degrades, not crashes). `photo` is an optional URL;
// Avatar falls back to the monogram when it's not set.
const FAMILY = [
  { id: "arnav",  first: "Arnav",  last: "Mody",   home: null, homeAirport: null, photo: null, tone: 1 },
  { id: "esha",   first: "Esha",   last: "Mody",   home: null, homeAirport: null, photo: null, tone: 2 },
  { id: "roopal", first: "Roopal", last: "Mody",   home: null, homeAirport: null, photo: null, tone: 3 },
  { id: "nihar",  first: "Nihar",  last: "Mody",   home: null, homeAirport: null, photo: null, tone: 4 },
  { id: "ashok",  first: "Ashok",  last: "Mody",   home: null, homeAirport: null, photo: null, tone: 5 },
  { id: "rohan",  first: "Rohan",  last: "Gandhi", home: null, homeAirport: null, photo: null, tone: 6 },
  { id: "avani",  first: "Avani",  last: "Gandhi", home: null, homeAirport: null, photo: null, tone: 7 },
  { id: "sanjay", first: "Sanjay", last: "Gandhi", home: null, homeAirport: null, photo: null, tone: 8 },
  { id: "charu",  first: "Charu",  last: "Gandhi", home: null, homeAirport: null, photo: null, tone: 9 },
  { id: "navin",  first: "Navin",  last: "Gandhi", home: null, homeAirport: null, photo: null, tone: 10 },
  { id: "ramila", first: "Ramila", last: "Gandhi", home: null, homeAirport: null, photo: null, tone: 11 },
];

// Airport lookup with rough lat/lon for the route map.
const AIRPORTS = {
  JFK: { city: "New York",      country: "USA",     name: "John F. Kennedy Intl",  lat: 40.64, lon: -73.78, tz: "EDT" },
  EWR: { city: "Newark",        country: "USA",     name: "Newark Liberty",        lat: 40.69, lon: -74.17, tz: "EDT" },
  SFO: { city: "San Francisco", country: "USA",     name: "San Francisco Intl",    lat: 37.62, lon: -122.38, tz: "PDT" },
  LAX: { city: "Los Angeles",   country: "USA",     name: "Los Angeles Intl",      lat: 33.94, lon: -118.41, tz: "PDT" },
  SEA: { city: "Seattle",       country: "USA",     name: "Seattle-Tacoma Intl",   lat: 47.45, lon: -122.31, tz: "PDT" },
  PHX: { city: "Phoenix",       country: "USA",     name: "Sky Harbor",            lat: 33.43, lon: -112.01, tz: "MST" },
  ATL: { city: "Atlanta",       country: "USA",     name: "Hartsfield-Jackson",    lat: 33.64, lon: -84.43, tz: "EDT" },
  AUS: { city: "Austin",        country: "USA",     name: "Austin-Bergstrom",      lat: 30.20, lon: -97.67, tz: "CDT" },
  ORD: { city: "Chicago",       country: "USA",     name: "O'Hare Intl",           lat: 41.98, lon: -87.91, tz: "CDT" },
  LHR: { city: "London",        country: "UK",      name: "Heathrow",              lat: 51.47, lon: -0.45, tz: "BST" },
  CDG: { city: "Paris",         country: "France",  name: "Charles de Gaulle",     lat: 49.01, lon:  2.55, tz: "CEST" },
  DEL: { city: "Delhi",         country: "India",   name: "Indira Gandhi Intl",    lat: 28.55, lon: 77.10, tz: "IST" },
  BLR: { city: "Bangalore",     country: "India",   name: "Kempegowda Intl",       lat: 13.20, lon: 77.71, tz: "IST" },
  BOM: { city: "Mumbai",        country: "India",   name: "Chhatrapati Shivaji",   lat: 19.09, lon: 72.87, tz: "IST" },
  DXB: { city: "Dubai",         country: "UAE",     name: "Dubai Intl",            lat: 25.25, lon: 55.36, tz: "GST" },
  NRT: { city: "Tokyo",         country: "Japan",   name: "Narita Intl",           lat: 35.77, lon: 140.39, tz: "JST" },
};

// Airline metadata — shows up on cards and flight detail.
const AIRLINES = {
  AI: { name: "Air India",        color: "#c8102e" },
  UA: { name: "United",           color: "#005daa" },
  AS: { name: "Alaska Airlines",  color: "#003561" },
  DL: { name: "Delta",            color: "#9b1c2e" },
  BA: { name: "British Airways",  color: "#075aaa" },
  WN: { name: "Southwest",        color: "#f9b612" },
  AA: { name: "American",         color: "#0078d2" },
  EK: { name: "Emirates",         color: "#d71a21" },
  AF: { name: "Air France",       color: "#002157" },
};

// helpers ────────────────────────────────────────────────────────────────────
const minutes = (m) => m * 60 * 1000;
const hours   = (h) => h * 60 * 60 * 1000;
const days    = (d) => d * 24 * 60 * 60 * 1000;
const t = (offset) => new Date(NOW.getTime() + offset);

// Flights — real ones come from Supabase (see app.jsx's dbFlights/mapDbFlight)
// and get merged in alongside this array. Starts empty; nothing fictional
// pinned to old demo names anymore.
const FLIGHTS = [];

// Status derivation. `status` is computed not stored so it always reflects
// whatever `now` (real wall-clock time) is passed in at render time.
function flightStatus(f, now = new Date()) {
  if (f.past) return "past";
  const dep = f.depart.getTime(), arr = f.arrive.getTime(), n = now.getTime();
  if (n >= arr - minutes(5) && f.landed)   return "landed";
  if (n >= arr)                            return "landed";
  if (n >= dep)                            return "airborne";
  if (n >= dep - hours(24))                return "boarding"; // taking off soon (within 24h)
  return "scheduled";
}

// Journey mode metadata — flights track live via FlightAware; train/car are
// logged for the board/calendar but have no live-tracking source (yet).
const MODE_META = {
  flight: { icon: "✈", label: "Flight" },
  train:  { icon: "🚆", label: "Train" },
  car:    { icon: "🚗", label: "Car" },
};
const modeOf = (f) => MODE_META[f?.mode] ? f.mode : "flight";
const modeMeta = (f) => MODE_META[modeOf(f)];

// Convenience getters. Airline/airport codes can now be free-typed (see
// save-flight's stub-row upsert) or, for train/car, plain city text that was
// never meant to resolve against these small reference tables at all — both
// fall back to a bare object built from the code itself so callers can keep
// reading `.name`/`.city`/`.color` without null-checking everywhere.
const familyById  = (id) => FAMILY.find((p) => p.id === id);
const airline     = (code) => AIRLINES[code] || { code: code || "", name: code || "—", color: "var(--ink-soft)" };
const airport     = (code) => AIRPORTS[code] || { code: code || "", city: code || "—", country: "", name: code || "" };

// FlightAware live-tracking link for a given flight (airline code + number).
// Only meaningful for mode: 'flight' — callers should gate on that.
const flightAwareUrl = (f) => `https://www.flightaware.com/live/flight/${f.airline}${f.number}`;

window.MGData = {
  NOW, FAMILY, AIRPORTS, AIRLINES, FLIGHTS, MODE_META,
  flightStatus, familyById, airline, airport, flightAwareUrl, modeOf, modeMeta,
  minutes, hours, days,
};
