// Mody-Gandhi Travel Tracker — mock data
// Family roster + flights spanning every visual state we need to demonstrate:
// airborne, taking-off-imminent, taking-off-soon, upcoming, just-landed, past.

// Time anchor — we hard-pin "now" so the prototype always shows the same
// curated set of flight states regardless of when it's viewed. The real app
// would use Date.now() everywhere this is used.
const NOW = new Date("2026-05-16T18:30:00Z");

// Family members. The `tone` controls each person's monogram color so the
// directory + avatars feel distinct without leaning on stock photos. The
// `homeAirport` IATA code is what the Calendar view uses to decide when a
// person is "away from home" vs "at home".
const FAMILY = [
  { id: "bharat", first: "Bharat", last: "Mody",        nick: "Dadaji",  role: "Patriarch · The Tracker",        home: "Phoenix, AZ",     homeAirport: "PHX", tone: 1 },
  { id: "asha",   first: "Asha",   last: "Mody",        nick: "Dadiji",  role: "Matriarch",                       home: "Phoenix, AZ",     homeAirport: "PHX", tone: 2 },
  { id: "priya",  first: "Priya",  last: "Mody-Gandhi", nick: "",        role: "Daughter · Architect",            home: "San Francisco",   homeAirport: "SFO", tone: 3 },
  { id: "raj",    first: "Raj",    last: "Gandhi",      nick: "",        role: "Son-in-law · Cardiologist",       home: "San Francisco",   homeAirport: "SFO", tone: 4 },
  { id: "aarav",  first: "Aarav",  last: "Mody-Gandhi", nick: "",        role: "Grandson · NYU '26",              home: "New York",        homeAirport: "JFK", tone: 5 },
  { id: "diya",   first: "Diya",   last: "Mody-Gandhi", nick: "",        role: "Granddaughter · senior in HS",    home: "San Francisco",   homeAirport: "SFO", tone: 6 },
  { id: "meera",  first: "Meera",  last: "Iyer",        nick: "",        role: "Daughter · Pediatrician",         home: "Seattle, WA",     homeAirport: "SEA", tone: 7 },
  { id: "vikram", first: "Vikram", last: "Iyer",        nick: "",        role: "Son-in-law · Designer",           home: "Seattle, WA",     homeAirport: "SEA", tone: 8 },
  { id: "kavya",  first: "Kavya",  last: "Iyer",        nick: "",        role: "Granddaughter · 16",              home: "Seattle, WA",     homeAirport: "SEA", tone: 9 },
  { id: "arjun",  first: "Arjun",  last: "Iyer",        nick: "",        role: "Grandson · 14",                   home: "Seattle, WA",     homeAirport: "SEA", tone: 10 },
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

// Flights. Each carries depart/arrive Date objects; the status is derived from
// NOW at render time, but we tag a "feature" to control where it appears on the
// board (the hero only ever shows one airborne flight at a time).
const FLIGHTS = [
  // ─── AIRBORNE — the hero ──────────────────────────────────────────────────
  {
    id: "F-AI102-0516",
    airline: "AI", number: "102",
    from: "JFK", to: "DEL",
    depart: t(-hours(4) - minutes(23)),
    arrive: t(hours(8) + minutes(12)),
    travelers: ["aarav"],
    aircraft: "Boeing 777-300ER",
    seat: "34A",
    gate: "A6",
    terminal: "4",
    confirmation: "K7N2QP",
    note: "Heading home for summer! Dadaji — I packed the kachoris you wanted from Mr. Patel's 😊",
    cruisingAlt: 38000,
    speed: 561, // knots
    progress: 0.34, // 0..1 along route — would come from FlightAware
    pinned: true,
  },

  // ─── TAKING OFF SOON (next 24h) ───────────────────────────────────────────
  {
    id: "F-UA905-0517",
    airline: "UA", number: "905",
    from: "SFO", to: "LHR",
    depart: t(hours(6) + minutes(40)),
    arrive: t(hours(17) + minutes(15)),
    travelers: ["priya", "raj"],
    aircraft: "Boeing 787-9",
    seat: "12A, 12B",
    gate: "G98",
    terminal: "I",
    confirmation: "M3J8XR",
    note: "Anniversary trip to London! Dinner reservation at Dishoom on Saturday.",
  },
  {
    id: "F-AS312-0516",
    airline: "AS", number: "312",
    from: "SEA", to: "PHX",
    depart: t(-hours(1) - minutes(10)),
    arrive: t(hours(1) + minutes(38)),
    travelers: ["meera"],
    aircraft: "Boeing 737 MAX 9",
    seat: "8C",
    gate: "C12",
    confirmation: "PR4K2L",
    note: "Coming to see Mom & Dad for the weekend!",
    cruisingAlt: 36000,
    speed: 461,
    progress: 0.40,
  },

  // ─── UPCOMING THIS WEEK ───────────────────────────────────────────────────
  {
    id: "F-BA286-0519",
    airline: "BA", number: "286",
    from: "SFO", to: "LHR",
    depart: t(days(3) + hours(2)),
    arrive: t(days(3) + hours(13)),
    travelers: ["vikram", "kavya"],
    aircraft: "Boeing 777-200ER",
    seat: "24E, 24F",
    confirmation: "B9N7TM",
    note: "Father-daughter trip — Kavya's first time in Europe!",
  },
  {
    id: "F-DL1245-0520",
    airline: "DL", number: "1245",
    from: "ATL", to: "LAX",
    depart: t(days(4) + hours(3)),
    arrive: t(days(4) + hours(8) + minutes(15)),
    travelers: ["diya"],
    aircraft: "Airbus A330-300",
    seat: "16D",
    confirmation: "DLT5XA",
    note: "Stanford admit weekend!",
    layovers: [{ at: "ATL", duration: "1h 30m" }],
  },
  {
    id: "F-AA1491-0510",
    airline: "AA", number: "1491",
    from: "PHX", to: "ORD",
    depart: t(-days(6) - hours(3)),
    arrive: t(-days(6)),
    travelers: ["bharat", "asha"],
    aircraft: "Boeing 737-800",
    seat: "5A, 5B",
    confirmation: "AAQ7Z2",
    note: "Off to Chicago for cousin Pradeep's wedding!",
  },
  {
    id: "F-AA1492-0522",
    airline: "AA", number: "1492",
    from: "ORD", to: "PHX",
    depart: t(days(6) + hours(5)),
    arrive: t(days(6) + hours(8) + minutes(20)),
    travelers: ["bharat", "asha"],
    aircraft: "Boeing 737-800",
    seat: "5A, 5B",
    confirmation: "AAQ8X1",
    note: "Returning from cousin Pradeep's wedding.",
  },

  // ─── JUST LANDED (today) ──────────────────────────────────────────────────
  {
    id: "F-WN4521-0516",
    airline: "WN", number: "4521",
    from: "PHX", to: "AUS",
    depart: t(-hours(5) - minutes(20)),
    arrive: t(-minutes(28)),
    travelers: ["arjun"],
    aircraft: "Boeing 737-700",
    seat: "14B",
    confirmation: "WN7P2Q",
    note: "Soccer tournament in Austin this weekend.",
    landed: true,
  },

  // ─── UPCOMING (later) ─────────────────────────────────────────────────────
  {
    id: "F-EK202-0608",
    airline: "EK", number: "202",
    from: "DXB", to: "JFK",
    depart: t(days(23) + hours(6)),
    arrive: t(days(23) + hours(20) + minutes(30)),
    travelers: ["aarav"],
    aircraft: "Airbus A380-800",
    seat: "62K",
    confirmation: "EK4MN9",
    note: "Heading back to NYU via Dubai — the long way.",
    layovers: [{ at: "DXB", duration: "3h 15m" }],
  },

  // ─── PAST TRIPS (archive) ─────────────────────────────────────────────────
  { id: "F-P01", airline: "AI", number: "144", from: "BOM", to: "JFK", depart: t(-days(48)), arrive: t(-days(48) + hours(15)),  travelers: ["aarav"], past: true, note: "Spring break in India." },
  { id: "F-P02", airline: "DL", number: "60",  from: "JFK", to: "CDG", depart: t(-days(86)), arrive: t(-days(86) + hours(7)),   travelers: ["priya", "raj"], past: true, note: "Paris for our anniversary." },
  { id: "F-P03", airline: "UA", number: "237", from: "SFO", to: "NRT", depart: t(-days(132)), arrive: t(-days(132) + hours(11)), travelers: ["vikram"], past: true, note: "Design conference in Tokyo." },
  { id: "F-P04", airline: "AS", number: "688", from: "SEA", to: "PHX", depart: t(-days(174)), arrive: t(-days(174) + hours(3)),  travelers: ["meera", "kavya", "arjun"], past: true, note: "Thanksgiving with Dadaji & Dadiji." },
  { id: "F-P05", airline: "BA", number: "287", from: "LHR", to: "SFO", depart: t(-days(201)), arrive: t(-days(201) + hours(11)), travelers: ["priya", "raj", "diya"], past: true, note: "Family wedding in London." },
];

// Status derivation. `status` is computed not stored so the "now" anchor stays
// the single source of truth.
function flightStatus(f, now = NOW) {
  if (f.past) return "past";
  const dep = f.depart.getTime(), arr = f.arrive.getTime(), n = now.getTime();
  if (n >= arr - minutes(5) && f.landed)   return "landed";
  if (n >= arr)                            return "landed";
  if (n >= dep)                            return "airborne";
  if (n >= dep - hours(24))                return "boarding"; // taking off soon (within 24h)
  return "scheduled";
}

// Convenience getters.
const familyById  = (id) => FAMILY.find((p) => p.id === id);
const airline     = (code) => AIRLINES[code];
const airport     = (code) => AIRPORTS[code];

// FlightAware live-tracking link for a given flight (airline code + number).
const flightAwareUrl = (f) => `https://www.flightaware.com/live/flight/${f.airline}${f.number}`;

window.MGData = {
  NOW, FAMILY, AIRPORTS, AIRLINES, FLIGHTS,
  flightStatus, familyById, airline, airport, flightAwareUrl,
  minutes, hours, days,
};
