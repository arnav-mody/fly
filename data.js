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

// Airport lookup with rough lat/lon for the route map. A curated set of
// major/common hubs worldwide — not an exhaustive global database (that'd be
// thousands of rows this small no-build app would ship on every load), just
// enough that the combobox actually finds what most families type. Anything
// not here still works fine as free-typed text (see save-flight's stub-row
// upsert) — this list only makes the *suggestion* better, it's never a hard
// requirement.
const AIRPORTS = {
  // ── USA ──────────────────────────────────────────────────────────────────
  JFK: { city: "New York",      country: "USA", name: "John F. Kennedy Intl",   lat: 40.64, lon: -73.78,  tz: "EDT" },
  LGA: { city: "New York",      country: "USA", name: "LaGuardia",              lat: 40.78, lon: -73.87,  tz: "EDT" },
  EWR: { city: "Newark",        country: "USA", name: "Newark Liberty",         lat: 40.69, lon: -74.17,  tz: "EDT" },
  SFO: { city: "San Francisco", country: "USA", name: "San Francisco Intl",     lat: 37.62, lon: -122.38, tz: "PDT" },
  OAK: { city: "Oakland",       country: "USA", name: "Oakland Intl",           lat: 37.72, lon: -122.22, tz: "PDT" },
  SJC: { city: "San Jose",      country: "USA", name: "Norman Y. Mineta",       lat: 37.36, lon: -121.93, tz: "PDT" },
  LAX: { city: "Los Angeles",   country: "USA", name: "Los Angeles Intl",       lat: 33.94, lon: -118.41, tz: "PDT" },
  SAN: { city: "San Diego",     country: "USA", name: "San Diego Intl",         lat: 32.73, lon: -117.19, tz: "PDT" },
  SEA: { city: "Seattle",       country: "USA", name: "Seattle-Tacoma Intl",    lat: 47.45, lon: -122.31, tz: "PDT" },
  PDX: { city: "Portland",      country: "USA", name: "Portland Intl",          lat: 45.59, lon: -122.60, tz: "PDT" },
  PHX: { city: "Phoenix",       country: "USA", name: "Sky Harbor",             lat: 33.43, lon: -112.01, tz: "MST" },
  LAS: { city: "Las Vegas",     country: "USA", name: "Harry Reid Intl",        lat: 36.08, lon: -115.15, tz: "PDT" },
  DEN: { city: "Denver",        country: "USA", name: "Denver Intl",            lat: 39.86, lon: -104.67, tz: "MDT" },
  SLC: { city: "Salt Lake City",country: "USA", name: "Salt Lake City Intl",    lat: 40.79, lon: -111.98, tz: "MDT" },
  ATL: { city: "Atlanta",       country: "USA", name: "Hartsfield-Jackson",     lat: 33.64, lon: -84.43,  tz: "EDT" },
  AUS: { city: "Austin",        country: "USA", name: "Austin-Bergstrom",       lat: 30.20, lon: -97.67,  tz: "CDT" },
  DFW: { city: "Dallas",        country: "USA", name: "Dallas/Fort Worth Intl", lat: 32.90, lon: -97.04,  tz: "CDT" },
  IAH: { city: "Houston",       country: "USA", name: "George Bush Intl",       lat: 29.99, lon: -95.34,  tz: "CDT" },
  MSP: { city: "Minneapolis",   country: "USA", name: "Minneapolis-St Paul",    lat: 44.88, lon: -93.22,  tz: "CDT" },
  ORD: { city: "Chicago",       country: "USA", name: "O'Hare Intl",            lat: 41.98, lon: -87.91,  tz: "CDT" },
  MDW: { city: "Chicago",       country: "USA", name: "Midway Intl",            lat: 41.79, lon: -87.75,  tz: "CDT" },
  DTW: { city: "Detroit",       country: "USA", name: "Detroit Metro",          lat: 42.21, lon: -83.35,  tz: "EDT" },
  STL: { city: "St. Louis",     country: "USA", name: "St. Louis Lambert",      lat: 38.75, lon: -90.37,  tz: "CDT" },
  MCI: { city: "Kansas City",   country: "USA", name: "Kansas City Intl",       lat: 39.30, lon: -94.71,  tz: "CDT" },
  BOS: { city: "Boston",        country: "USA", name: "Logan Intl",             lat: 42.36, lon: -71.01,  tz: "EDT" },
  PHL: { city: "Philadelphia",  country: "USA", name: "Philadelphia Intl",      lat: 39.87, lon: -75.24,  tz: "EDT" },
  DCA: { city: "Washington",    country: "USA", name: "Reagan National",        lat: 38.85, lon: -77.04,  tz: "EDT" },
  IAD: { city: "Washington",    country: "USA", name: "Dulles Intl",            lat: 38.95, lon: -77.46,  tz: "EDT" },
  BWI: { city: "Baltimore",     country: "USA", name: "BWI Marshall",           lat: 39.18, lon: -76.67,  tz: "EDT" },
  MIA: { city: "Miami",         country: "USA", name: "Miami Intl",             lat: 25.80, lon: -80.29,  tz: "EDT" },
  FLL: { city: "Fort Lauderdale",country:"USA", name: "Fort Lauderdale-Hollywood", lat: 26.07, lon: -80.15, tz: "EDT" },
  MCO: { city: "Orlando",       country: "USA", name: "Orlando Intl",           lat: 28.43, lon: -81.31,  tz: "EDT" },
  TPA: { city: "Tampa",         country: "USA", name: "Tampa Intl",             lat: 27.98, lon: -82.53,  tz: "EDT" },
  CLT: { city: "Charlotte",     country: "USA", name: "Charlotte Douglas",      lat: 35.21, lon: -80.94,  tz: "EDT" },
  RDU: { city: "Raleigh",       country: "USA", name: "Raleigh-Durham Intl",    lat: 35.88, lon: -78.79,  tz: "EDT" },
  RIC: { city: "Richmond",      country: "USA", name: "Richmond Intl",          lat: 37.51, lon: -77.32,  tz: "EDT" },
  HNL: { city: "Honolulu",      country: "USA", name: "Daniel K. Inouye Intl",  lat: 21.32, lon: -157.92, tz: "HST" },
  ANC: { city: "Anchorage",     country: "USA", name: "Ted Stevens Anchorage",  lat: 61.17, lon: -150.00, tz: "AKDT" },

  // ── Canada ───────────────────────────────────────────────────────────────
  YYZ: { city: "Toronto",       country: "Canada", name: "Pearson Intl",        lat: 43.68, lon: -79.63,  tz: "EDT" },
  YVR: { city: "Vancouver",     country: "Canada", name: "Vancouver Intl",      lat: 49.19, lon: -123.18, tz: "PDT" },
  YUL: { city: "Montreal",      country: "Canada", name: "Montréal-Trudeau",    lat: 45.47, lon: -73.74,  tz: "EDT" },
  YYC: { city: "Calgary",       country: "Canada", name: "Calgary Intl",        lat: 51.11, lon: -114.02, tz: "MDT" },
  YOW: { city: "Ottawa",        country: "Canada", name: "Ottawa Macdonald-Cartier", lat: 45.32, lon: -75.67, tz: "EDT" },

  // ── Mexico & Latin America ───────────────────────────────────────────────
  MEX: { city: "Mexico City",   country: "Mexico",    name: "Mexico City Intl",     lat: 19.44, lon: -99.07,  tz: "CST" },
  CUN: { city: "Cancún",        country: "Mexico",    name: "Cancún Intl",          lat: 21.04, lon: -86.87,  tz: "EST" },
  GDL: { city: "Guadalajara",   country: "Mexico",    name: "Guadalajara Intl",     lat: 20.52, lon: -103.31, tz: "CST" },
  GRU: { city: "São Paulo",     country: "Brazil",    name: "Guarulhos Intl",       lat: -23.43, lon: -46.47, tz: "BRT" },
  GIG: { city: "Rio de Janeiro",country: "Brazil",    name: "Galeão Intl",          lat: -22.81, lon: -43.25, tz: "BRT" },
  EZE: { city: "Buenos Aires",  country: "Argentina", name: "Ministro Pistarini",   lat: -34.82, lon: -58.54, tz: "ART" },
  SCL: { city: "Santiago",      country: "Chile",     name: "Arturo Merino Benítez",lat: -33.39, lon: -70.79, tz: "CLT" },
  BOG: { city: "Bogotá",        country: "Colombia",  name: "El Dorado Intl",       lat: 4.70,  lon: -74.15,  tz: "COT" },
  LIM: { city: "Lima",          country: "Peru",      name: "Jorge Chávez Intl",    lat: -12.02, lon: -77.11, tz: "PET" },
  PTY: { city: "Panama City",   country: "Panama",    name: "Tocumen Intl",         lat: 9.07,  lon: -79.38,  tz: "EST" },

  // ── UK & Ireland ─────────────────────────────────────────────────────────
  LHR: { city: "London",        country: "UK", name: "Heathrow",                lat: 51.47, lon: -0.45,  tz: "BST" },
  LGW: { city: "London",        country: "UK", name: "Gatwick",                 lat: 51.15, lon: -0.19,  tz: "BST" },
  LCY: { city: "London",        country: "UK", name: "City Airport",            lat: 51.51, lon: 0.06,   tz: "BST" },
  STN: { city: "London",        country: "UK", name: "Stansted",                lat: 51.89, lon: 0.24,   tz: "BST" },
  MAN: { city: "Manchester",    country: "UK", name: "Manchester Airport",      lat: 53.35, lon: -2.27,  tz: "BST" },
  EDI: { city: "Edinburgh",     country: "UK", name: "Edinburgh Airport",       lat: 55.95, lon: -3.37,  tz: "BST" },
  BHX: { city: "Birmingham",    country: "UK", name: "Birmingham Airport",      lat: 52.45, lon: -1.75,  tz: "BST" },
  DUB: { city: "Dublin",        country: "Ireland", name: "Dublin Airport",     lat: 53.43, lon: -6.27,  tz: "IST" },

  // ── Western & Northern Europe ────────────────────────────────────────────
  CDG: { city: "Paris",         country: "France",  name: "Charles de Gaulle",  lat: 49.01, lon: 2.55,   tz: "CEST" },
  ORY: { city: "Paris",         country: "France",  name: "Orly",               lat: 48.73, lon: 2.36,   tz: "CEST" },
  AMS: { city: "Amsterdam",     country: "Netherlands", name: "Schiphol",       lat: 52.31, lon: 4.76,   tz: "CEST" },
  FRA: { city: "Frankfurt",     country: "Germany", name: "Frankfurt Airport",  lat: 50.04, lon: 8.57,   tz: "CEST" },
  MUC: { city: "Munich",        country: "Germany", name: "Munich Airport",     lat: 48.35, lon: 11.79,  tz: "CEST" },
  BER: { city: "Berlin",        country: "Germany", name: "Brandenburg",        lat: 52.37, lon: 13.50,  tz: "CEST" },
  ZRH: { city: "Zurich",        country: "Switzerland", name: "Zurich Airport", lat: 47.46, lon: 8.55,   tz: "CEST" },
  GVA: { city: "Geneva",        country: "Switzerland", name: "Geneva Airport", lat: 46.24, lon: 6.11,   tz: "CEST" },
  VIE: { city: "Vienna",        country: "Austria",  name: "Vienna Intl",       lat: 48.11, lon: 16.57,  tz: "CEST" },
  BRU: { city: "Brussels",      country: "Belgium",  name: "Brussels Airport",  lat: 50.90, lon: 4.48,   tz: "CEST" },
  CPH: { city: "Copenhagen",    country: "Denmark",  name: "Copenhagen Airport",lat: 55.62, lon: 12.66,  tz: "CEST" },
  ARN: { city: "Stockholm",     country: "Sweden",   name: "Arlanda",           lat: 59.65, lon: 17.92,  tz: "CEST" },
  OSL: { city: "Oslo",          country: "Norway",   name: "Oslo Airport",      lat: 60.19, lon: 11.10,  tz: "CEST" },
  HEL: { city: "Helsinki",      country: "Finland",  name: "Helsinki Airport",  lat: 60.32, lon: 24.96,  tz: "EEST" },

  // ── Southern Europe ──────────────────────────────────────────────────────
  MAD: { city: "Madrid",        country: "Spain",    name: "Adolfo Suárez Barajas", lat: 40.47, lon: -3.57, tz: "CEST" },
  BCN: { city: "Barcelona",     country: "Spain",    name: "Barcelona-El Prat", lat: 41.30, lon: 2.08,   tz: "CEST" },
  LIS: { city: "Lisbon",        country: "Portugal", name: "Humberto Delgado",  lat: 38.77, lon: -9.13,  tz: "WEST" },
  FCO: { city: "Rome",          country: "Italy",    name: "Fiumicino",         lat: 41.80, lon: 12.24,  tz: "CEST" },
  MXP: { city: "Milan",         country: "Italy",    name: "Malpensa",          lat: 45.63, lon: 8.72,   tz: "CEST" },
  ATH: { city: "Athens",        country: "Greece",   name: "Athens Intl",       lat: 37.94, lon: 23.95,  tz: "EEST" },
  IST: { city: "Istanbul",      country: "Turkey",   name: "Istanbul Airport",  lat: 41.28, lon: 28.75,  tz: "TRT" },

  // ── Central & Eastern Europe ─────────────────────────────────────────────
  WAW: { city: "Warsaw",        country: "Poland",   name: "Chopin Airport",    lat: 52.17, lon: 20.97,  tz: "CEST" },
  PRG: { city: "Prague",        country: "Czechia",  name: "Václav Havel",      lat: 50.10, lon: 14.26,  tz: "CEST" },
  BUD: { city: "Budapest",      country: "Hungary",  name: "Ferenc Liszt",      lat: 47.44, lon: 19.26,  tz: "CEST" },

  // ── Middle East ──────────────────────────────────────────────────────────
  DXB: { city: "Dubai",         country: "UAE",     name: "Dubai Intl",         lat: 25.25, lon: 55.36,  tz: "GST" },
  AUH: { city: "Abu Dhabi",     country: "UAE",     name: "Zayed Intl",         lat: 24.43, lon: 54.65,  tz: "GST" },
  DOH: { city: "Doha",          country: "Qatar",   name: "Hamad Intl",         lat: 25.27, lon: 51.61,  tz: "AST" },
  TLV: { city: "Tel Aviv",      country: "Israel",  name: "Ben Gurion",         lat: 32.01, lon: 34.89,  tz: "IDT" },
  AMM: { city: "Amman",         country: "Jordan",  name: "Queen Alia Intl",    lat: 31.72, lon: 35.99,  tz: "EEST" },
  JED: { city: "Jeddah",        country: "Saudi Arabia", name: "King Abdulaziz Intl", lat: 21.68, lon: 39.16, tz: "AST" },
  RUH: { city: "Riyadh",        country: "Saudi Arabia", name: "King Khalid Intl",    lat: 24.96, lon: 46.70, tz: "AST" },

  // ── India ────────────────────────────────────────────────────────────────
  DEL: { city: "Delhi",         country: "India", name: "Indira Gandhi Intl",   lat: 28.55, lon: 77.10,  tz: "IST" },
  BOM: { city: "Mumbai",        country: "India", name: "Chhatrapati Shivaji",  lat: 19.09, lon: 72.87,  tz: "IST" },
  BLR: { city: "Bangalore",     country: "India", name: "Kempegowda Intl",      lat: 13.20, lon: 77.71,  tz: "IST" },
  MAA: { city: "Chennai",       country: "India", name: "Chennai Intl",         lat: 12.99, lon: 80.17,  tz: "IST" },
  HYD: { city: "Hyderabad",     country: "India", name: "Rajiv Gandhi Intl",    lat: 17.24, lon: 78.43,  tz: "IST" },
  CCU: { city: "Kolkata",       country: "India", name: "Netaji Subhas Chandra Bose", lat: 22.65, lon: 88.45, tz: "IST" },
  AMD: { city: "Ahmedabad",     country: "India", name: "Sardar Vallabhbhai Patel Intl", lat: 23.08, lon: 72.63, tz: "IST" },
  PNQ: { city: "Pune",          country: "India", name: "Pune Airport",         lat: 18.58, lon: 73.92,  tz: "IST" },
  GOI: { city: "Goa",           country: "India", name: "Dabolim Airport",      lat: 15.38, lon: 73.83,  tz: "IST" },
  COK: { city: "Kochi",         country: "India", name: "Cochin Intl",          lat: 10.15, lon: 76.40,  tz: "IST" },
  JAI: { city: "Jaipur",        country: "India", name: "Jaipur Intl",          lat: 26.82, lon: 75.81,  tz: "IST" },
  LKO: { city: "Lucknow",       country: "India", name: "Chaudhary Charan Singh Intl", lat: 26.76, lon: 80.89, tz: "IST" },
  IXC: { city: "Chandigarh",    country: "India", name: "Chandigarh Airport",   lat: 30.67, lon: 76.79,  tz: "IST" },

  // ── Rest of South Asia ───────────────────────────────────────────────────
  KTM: { city: "Kathmandu",     country: "Nepal",      name: "Tribhuvan Intl",  lat: 27.70, lon: 85.36,  tz: "NPT" },
  CMB: { city: "Colombo",       country: "Sri Lanka",  name: "Bandaranaike Intl", lat: 7.18, lon: 79.88, tz: "IST" },
  DAC: { city: "Dhaka",         country: "Bangladesh", name: "Hazrat Shahjalal Intl", lat: 23.84, lon: 90.40, tz: "BST" },
  KHI: { city: "Karachi",       country: "Pakistan",   name: "Jinnah Intl",     lat: 24.91, lon: 67.16,  tz: "PKT" },
  ISB: { city: "Islamabad",     country: "Pakistan",   name: "Islamabad Intl",  lat: 33.56, lon: 72.83,  tz: "PKT" },

  // ── East & Southeast Asia ────────────────────────────────────────────────
  NRT: { city: "Tokyo",         country: "Japan",       name: "Narita Intl",      lat: 35.77, lon: 140.39, tz: "JST" },
  HND: { city: "Tokyo",         country: "Japan",       name: "Haneda Airport",   lat: 35.55, lon: 139.78, tz: "JST" },
  KIX: { city: "Osaka",         country: "Japan",       name: "Kansai Intl",      lat: 34.43, lon: 135.24, tz: "JST" },
  ICN: { city: "Seoul",         country: "South Korea", name: "Incheon Intl",     lat: 37.46, lon: 126.44, tz: "KST" },
  PVG: { city: "Shanghai",      country: "China",       name: "Pudong Intl",      lat: 31.14, lon: 121.81, tz: "CST" },
  PEK: { city: "Beijing",       country: "China",       name: "Capital Intl",     lat: 40.08, lon: 116.58, tz: "CST" },
  HKG: { city: "Hong Kong",     country: "Hong Kong",   name: "Hong Kong Intl",   lat: 22.31, lon: 113.91, tz: "HKT" },
  TPE: { city: "Taipei",        country: "Taiwan",      name: "Taoyuan Intl",     lat: 25.08, lon: 121.23, tz: "CST" },
  SIN: { city: "Singapore",     country: "Singapore",   name: "Changi Airport",   lat: 1.36,  lon: 103.99, tz: "SGT" },
  KUL: { city: "Kuala Lumpur",  country: "Malaysia",    name: "KL Intl",          lat: 2.75,  lon: 101.71, tz: "MYT" },
  BKK: { city: "Bangkok",       country: "Thailand",    name: "Suvarnabhumi",     lat: 13.69, lon: 100.75, tz: "ICT" },
  CGK: { city: "Jakarta",       country: "Indonesia",   name: "Soekarno-Hatta",   lat: -6.13, lon: 106.66, tz: "WIB" },
  MNL: { city: "Manila",        country: "Philippines", name: "Ninoy Aquino Intl",lat: 14.51, lon: 121.02, tz: "PST" },
  SGN: { city: "Ho Chi Minh City", country: "Vietnam",  name: "Tan Son Nhat Intl",lat: 10.82, lon: 106.66, tz: "ICT" },
  HAN: { city: "Hanoi",         country: "Vietnam",     name: "Noi Bai Intl",     lat: 21.22, lon: 105.81, tz: "ICT" },

  // ── Australia & New Zealand ──────────────────────────────────────────────
  SYD: { city: "Sydney",        country: "Australia", name: "Kingsford Smith",   lat: -33.95, lon: 151.18, tz: "AEST" },
  MEL: { city: "Melbourne",     country: "Australia", name: "Melbourne Airport", lat: -37.67, lon: 144.84, tz: "AEST" },
  BNE: { city: "Brisbane",      country: "Australia", name: "Brisbane Airport",  lat: -27.38, lon: 153.12, tz: "AEST" },
  PER: { city: "Perth",         country: "Australia", name: "Perth Airport",     lat: -31.94, lon: 115.97, tz: "AWST" },
  AKL: { city: "Auckland",      country: "New Zealand", name: "Auckland Airport",lat: -37.01, lon: 174.79, tz: "NZST" },

  // ── Africa ───────────────────────────────────────────────────────────────
  JNB: { city: "Johannesburg",  country: "South Africa", name: "O.R. Tambo Intl", lat: -26.14, lon: 28.24, tz: "SAST" },
  CPT: { city: "Cape Town",     country: "South Africa", name: "Cape Town Intl",  lat: -33.97, lon: 18.60, tz: "SAST" },
  CAI: { city: "Cairo",         country: "Egypt",        name: "Cairo Intl",      lat: 30.11, lon: 31.41, tz: "EET" },
  NBO: { city: "Nairobi",       country: "Kenya",        name: "Jomo Kenyatta Intl", lat: -1.32, lon: 36.93, tz: "EAT" },
  LOS: { city: "Lagos",         country: "Nigeria",      name: "Murtala Muhammed Intl", lat: 6.58, lon: 3.32, tz: "WAT" },
  ADD: { city: "Addis Ababa",   country: "Ethiopia",     name: "Bole Intl",       lat: 8.98,  lon: 38.80, tz: "EAT" },
  CMN: { city: "Casablanca",    country: "Morocco",      name: "Mohammed V Intl", lat: 33.37, lon: -7.59, tz: "WEST" },
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
// Deliberately factual only — no inference about where someone "is" beyond
// a verified flight state. "landed" is time-boxed to 24h so a completed
// flight ages off the live board on its own; after that it's "past" and
// only visible in Calendar, which just lists what was actually logged.
function flightStatus(f, now = new Date()) {
  const dep = f.depart.getTime(), arr = f.arrive.getTime(), n = now.getTime();
  if (n >= arr + hours(24))                return "past";
  if (n >= arr)                             return "landed";
  if (n >= dep)                             return "airborne";
  if (n >= dep - hours(24))                 return "boarding"; // taking off soon (within 24h)
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

// Purely a data-completeness check, not a location claim: is there any
// other logged flight, for at least one of the same travelers, departing
// from where this one landed? If not, that's worth flagging so whoever's
// looking knows to add the return leg — not so the app can guess how long
// they're away for.
const hasLoggedReturn = (flight, allFlights) => allFlights.some((other) =>
  other.id !== flight.id &&
  other.from === flight.to &&
  other.depart > flight.arrive &&
  other.travelers.some((id) => flight.travelers.includes(id))
);

// RouteMap needs real lat/lon to draw an arc — a free-typed airport code we
// don't recognize (or train/car's plain city text) has none, and feeding it
// undefined produces NaN coordinates and broken SVG. Callers should check
// this before rendering RouteMap and fall back to the mode-icon block
// (already the pattern used for train/car) when it's false.
const hasCoords = (a, b) => Number.isFinite(a?.lat) && Number.isFinite(a?.lon) && Number.isFinite(b?.lat) && Number.isFinite(b?.lon);

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
  flightStatus, familyById, airline, airport, flightAwareUrl, modeOf, modeMeta, hasLoggedReturn, hasCoords,
  minutes, hours, days,
};
