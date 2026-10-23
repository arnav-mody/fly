// Mody-Gandhi Travel Tracker — data
// Family roster is real; flights start empty and accumulate from real
// uploads. (Demo flight data used to live here for prototyping — removed
// now that the roster is real, since it referenced family-member IDs that
// no longer exist.)

// Time anchor kept around for the `t()`/hours()/days() helpers below, which
// are still handy for one-off date math — but useNow() (components.jsx) uses
// real wall-clock time, not this.
const NOW = new Date();

// People the signed-in viewer can see — filled from get_people() once signed
// in (see refreshFamily in app.jsx), never hardcoded: the page source is
// public, and with accounts each viewer gets only the people they're
// connected to. Besides the profile fields, each entry carries how it
// relates to the viewer (isMe, iFollow, followsMe, inMyCircle,
// inTheirCircle, canManage). The `tone` controls each person's monogram
// color; `photo` is an optional URL (Avatar falls back to the monogram).
const FAMILY = [];

// Airport lookup with rough lat/lon for the route map. A curated set of
// major/common hubs worldwide — not an exhaustive global database (that'd be
// thousands of rows this small no-build app would ship on every load), just
// enough that the combobox actually finds what most families type. Anything
// not here still works fine as free-typed text (see save-flight's stub-row
// upsert) — this list only makes the *suggestion* better, it's never a hard
// requirement.
// `tz` is a display-only label (e.g. "PDT") shown on boarding passes — never
// used for date math. `tzId` is the real IANA zone identifier (e.g.
// "America/Los_Angeles") used by viewerTime() below to actually compute what
// a stored departure/arrival means in someone else's local time, DST and all.
const AIRPORTS = {
  // ── USA ──────────────────────────────────────────────────────────────────
  JFK: { city: "New York",      country: "USA", name: "John F. Kennedy Intl",   lat: 40.64, lon: -73.78,  tz: "EDT", tzId: "America/New_York" },
  LGA: { city: "New York",      country: "USA", name: "LaGuardia",              lat: 40.78, lon: -73.87,  tz: "EDT", tzId: "America/New_York" },
  EWR: { city: "Newark",        country: "USA", name: "Newark Liberty",         lat: 40.69, lon: -74.17,  tz: "EDT", tzId: "America/New_York" },
  SFO: { city: "San Francisco", country: "USA", name: "San Francisco Intl",     lat: 37.62, lon: -122.38, tz: "PDT", tzId: "America/Los_Angeles" },
  OAK: { city: "Oakland",       country: "USA", name: "Oakland Intl",           lat: 37.72, lon: -122.22, tz: "PDT", tzId: "America/Los_Angeles" },
  SJC: { city: "San Jose",      country: "USA", name: "Norman Y. Mineta",       lat: 37.36, lon: -121.93, tz: "PDT", tzId: "America/Los_Angeles" },
  LAX: { city: "Los Angeles",   country: "USA", name: "Los Angeles Intl",       lat: 33.94, lon: -118.41, tz: "PDT", tzId: "America/Los_Angeles" },
  SAN: { city: "San Diego",     country: "USA", name: "San Diego Intl",         lat: 32.73, lon: -117.19, tz: "PDT", tzId: "America/Los_Angeles" },
  SEA: { city: "Seattle",       country: "USA", name: "Seattle-Tacoma Intl",    lat: 47.45, lon: -122.31, tz: "PDT", tzId: "America/Los_Angeles" },
  PDX: { city: "Portland",      country: "USA", name: "Portland Intl",          lat: 45.59, lon: -122.60, tz: "PDT", tzId: "America/Los_Angeles" },
  PHX: { city: "Phoenix",       country: "USA", name: "Sky Harbor",             lat: 33.43, lon: -112.01, tz: "MST", tzId: "America/Phoenix" },
  LAS: { city: "Las Vegas",     country: "USA", name: "Harry Reid Intl",        lat: 36.08, lon: -115.15, tz: "PDT", tzId: "America/Los_Angeles" },
  DEN: { city: "Denver",        country: "USA", name: "Denver Intl",            lat: 39.86, lon: -104.67, tz: "MDT", tzId: "America/Denver" },
  SLC: { city: "Salt Lake City",country: "USA", name: "Salt Lake City Intl",    lat: 40.79, lon: -111.98, tz: "MDT", tzId: "America/Denver" },
  ATL: { city: "Atlanta",       country: "USA", name: "Hartsfield-Jackson",     lat: 33.64, lon: -84.43,  tz: "EDT", tzId: "America/New_York" },
  AUS: { city: "Austin",        country: "USA", name: "Austin-Bergstrom",       lat: 30.20, lon: -97.67,  tz: "CDT", tzId: "America/Chicago" },
  DFW: { city: "Dallas",        country: "USA", name: "Dallas/Fort Worth Intl", lat: 32.90, lon: -97.04,  tz: "CDT", tzId: "America/Chicago" },
  IAH: { city: "Houston",       country: "USA", name: "George Bush Intl",       lat: 29.99, lon: -95.34,  tz: "CDT", tzId: "America/Chicago" },
  MSP: { city: "Minneapolis",   country: "USA", name: "Minneapolis-St Paul",    lat: 44.88, lon: -93.22,  tz: "CDT", tzId: "America/Chicago" },
  ORD: { city: "Chicago",       country: "USA", name: "O'Hare Intl",            lat: 41.98, lon: -87.91,  tz: "CDT", tzId: "America/Chicago" },
  MDW: { city: "Chicago",       country: "USA", name: "Midway Intl",            lat: 41.79, lon: -87.75,  tz: "CDT", tzId: "America/Chicago" },
  DTW: { city: "Detroit",       country: "USA", name: "Detroit Metro",          lat: 42.21, lon: -83.35,  tz: "EDT", tzId: "America/New_York" },
  STL: { city: "St. Louis",     country: "USA", name: "St. Louis Lambert",      lat: 38.75, lon: -90.37,  tz: "CDT", tzId: "America/Chicago" },
  MCI: { city: "Kansas City",   country: "USA", name: "Kansas City Intl",       lat: 39.30, lon: -94.71,  tz: "CDT", tzId: "America/Chicago" },
  IND: { city: "Indianapolis",  country: "USA", name: "Indianapolis Intl",      lat: 39.72, lon: -86.29,  tz: "EDT", tzId: "America/Indiana/Indianapolis" },
  BOS: { city: "Boston",        country: "USA", name: "Logan Intl",             lat: 42.36, lon: -71.01,  tz: "EDT", tzId: "America/New_York" },
  PHL: { city: "Philadelphia",  country: "USA", name: "Philadelphia Intl",      lat: 39.87, lon: -75.24,  tz: "EDT", tzId: "America/New_York" },
  DCA: { city: "Washington",    country: "USA", name: "Reagan National",        lat: 38.85, lon: -77.04,  tz: "EDT", tzId: "America/New_York" },
  IAD: { city: "Washington",    country: "USA", name: "Dulles Intl",            lat: 38.95, lon: -77.46,  tz: "EDT", tzId: "America/New_York" },
  BWI: { city: "Baltimore",     country: "USA", name: "BWI Marshall",           lat: 39.18, lon: -76.67,  tz: "EDT", tzId: "America/New_York" },
  MIA: { city: "Miami",         country: "USA", name: "Miami Intl",             lat: 25.80, lon: -80.29,  tz: "EDT", tzId: "America/New_York" },
  FLL: { city: "Fort Lauderdale",country:"USA", name: "Fort Lauderdale-Hollywood", lat: 26.07, lon: -80.15, tz: "EDT", tzId: "America/New_York" },
  MCO: { city: "Orlando",       country: "USA", name: "Orlando Intl",           lat: 28.43, lon: -81.31,  tz: "EDT", tzId: "America/New_York" },
  TPA: { city: "Tampa",         country: "USA", name: "Tampa Intl",             lat: 27.98, lon: -82.53,  tz: "EDT", tzId: "America/New_York" },
  CLT: { city: "Charlotte",     country: "USA", name: "Charlotte Douglas",      lat: 35.21, lon: -80.94,  tz: "EDT", tzId: "America/New_York" },
  RDU: { city: "Raleigh",       country: "USA", name: "Raleigh-Durham Intl",    lat: 35.88, lon: -78.79,  tz: "EDT", tzId: "America/New_York" },
  RIC: { city: "Richmond",      country: "USA", name: "Richmond Intl",          lat: 37.51, lon: -77.32,  tz: "EDT", tzId: "America/New_York" },
  HNL: { city: "Honolulu",      country: "USA", name: "Daniel K. Inouye Intl",  lat: 21.32, lon: -157.92, tz: "HST", tzId: "Pacific/Honolulu" },
  ANC: { city: "Anchorage",     country: "USA", name: "Ted Stevens Anchorage",  lat: 61.17, lon: -150.00, tz: "AKDT", tzId: "America/Anchorage" },

  // ── Canada ───────────────────────────────────────────────────────────────
  YYZ: { city: "Toronto",       country: "Canada", name: "Pearson Intl",        lat: 43.68, lon: -79.63,  tz: "EDT", tzId: "America/Toronto" },
  YVR: { city: "Vancouver",     country: "Canada", name: "Vancouver Intl",      lat: 49.19, lon: -123.18, tz: "PDT", tzId: "America/Vancouver" },
  YUL: { city: "Montreal",      country: "Canada", name: "Montréal-Trudeau",    lat: 45.47, lon: -73.74,  tz: "EDT", tzId: "America/Toronto" },
  YYC: { city: "Calgary",       country: "Canada", name: "Calgary Intl",        lat: 51.11, lon: -114.02, tz: "MDT", tzId: "America/Edmonton" },
  YOW: { city: "Ottawa",        country: "Canada", name: "Ottawa Macdonald-Cartier", lat: 45.32, lon: -75.67, tz: "EDT", tzId: "America/Toronto" },

  // ── Mexico & Latin America ───────────────────────────────────────────────
  MEX: { city: "Mexico City",   country: "Mexico",    name: "Mexico City Intl",     lat: 19.44, lon: -99.07,  tz: "CST", tzId: "America/Mexico_City" },
  CUN: { city: "Cancún",        country: "Mexico",    name: "Cancún Intl",          lat: 21.04, lon: -86.87,  tz: "EST", tzId: "America/Cancun" },
  GDL: { city: "Guadalajara",   country: "Mexico",    name: "Guadalajara Intl",     lat: 20.52, lon: -103.31, tz: "CST", tzId: "America/Mexico_City" },
  GRU: { city: "São Paulo",     country: "Brazil",    name: "Guarulhos Intl",       lat: -23.43, lon: -46.47, tz: "BRT", tzId: "America/Sao_Paulo" },
  GIG: { city: "Rio de Janeiro",country: "Brazil",    name: "Galeão Intl",          lat: -22.81, lon: -43.25, tz: "BRT", tzId: "America/Sao_Paulo" },
  EZE: { city: "Buenos Aires",  country: "Argentina", name: "Ministro Pistarini",   lat: -34.82, lon: -58.54, tz: "ART", tzId: "America/Argentina/Buenos_Aires" },
  SCL: { city: "Santiago",      country: "Chile",     name: "Arturo Merino Benítez",lat: -33.39, lon: -70.79, tz: "CLT", tzId: "America/Santiago" },
  BOG: { city: "Bogotá",        country: "Colombia",  name: "El Dorado Intl",       lat: 4.70,  lon: -74.15,  tz: "COT", tzId: "America/Bogota" },
  LIM: { city: "Lima",          country: "Peru",      name: "Jorge Chávez Intl",    lat: -12.02, lon: -77.11, tz: "PET", tzId: "America/Lima" },
  PTY: { city: "Panama City",   country: "Panama",    name: "Tocumen Intl",         lat: 9.07,  lon: -79.38,  tz: "EST", tzId: "America/Panama" },

  // ── UK & Ireland ─────────────────────────────────────────────────────────
  LHR: { city: "London",        country: "UK", name: "Heathrow",                lat: 51.47, lon: -0.45,  tz: "BST", tzId: "Europe/London" },
  LGW: { city: "London",        country: "UK", name: "Gatwick",                 lat: 51.15, lon: -0.19,  tz: "BST", tzId: "Europe/London" },
  LCY: { city: "London",        country: "UK", name: "City Airport",            lat: 51.51, lon: 0.06,   tz: "BST", tzId: "Europe/London" },
  STN: { city: "London",        country: "UK", name: "Stansted",                lat: 51.89, lon: 0.24,   tz: "BST", tzId: "Europe/London" },
  MAN: { city: "Manchester",    country: "UK", name: "Manchester Airport",      lat: 53.35, lon: -2.27,  tz: "BST", tzId: "Europe/London" },
  EDI: { city: "Edinburgh",     country: "UK", name: "Edinburgh Airport",       lat: 55.95, lon: -3.37,  tz: "BST", tzId: "Europe/London" },
  BHX: { city: "Birmingham",    country: "UK", name: "Birmingham Airport",      lat: 52.45, lon: -1.75,  tz: "BST", tzId: "Europe/London" },
  DUB: { city: "Dublin",        country: "Ireland", name: "Dublin Airport",     lat: 53.43, lon: -6.27,  tz: "IST", tzId: "Europe/Dublin" },

  // ── Western & Northern Europe ────────────────────────────────────────────
  CDG: { city: "Paris",         country: "France",  name: "Charles de Gaulle",  lat: 49.01, lon: 2.55,   tz: "CEST", tzId: "Europe/Paris" },
  ORY: { city: "Paris",         country: "France",  name: "Orly",               lat: 48.73, lon: 2.36,   tz: "CEST", tzId: "Europe/Paris" },
  AMS: { city: "Amsterdam",     country: "Netherlands", name: "Schiphol",       lat: 52.31, lon: 4.76,   tz: "CEST", tzId: "Europe/Amsterdam" },
  FRA: { city: "Frankfurt",     country: "Germany", name: "Frankfurt Airport",  lat: 50.04, lon: 8.57,   tz: "CEST", tzId: "Europe/Berlin" },
  MUC: { city: "Munich",        country: "Germany", name: "Munich Airport",     lat: 48.35, lon: 11.79,  tz: "CEST", tzId: "Europe/Berlin" },
  BER: { city: "Berlin",        country: "Germany", name: "Brandenburg",        lat: 52.37, lon: 13.50,  tz: "CEST", tzId: "Europe/Berlin" },
  ZRH: { city: "Zurich",        country: "Switzerland", name: "Zurich Airport", lat: 47.46, lon: 8.55,   tz: "CEST", tzId: "Europe/Zurich" },
  GVA: { city: "Geneva",        country: "Switzerland", name: "Geneva Airport", lat: 46.24, lon: 6.11,   tz: "CEST", tzId: "Europe/Zurich" },
  VIE: { city: "Vienna",        country: "Austria",  name: "Vienna Intl",       lat: 48.11, lon: 16.57,  tz: "CEST", tzId: "Europe/Vienna" },
  BRU: { city: "Brussels",      country: "Belgium",  name: "Brussels Airport",  lat: 50.90, lon: 4.48,   tz: "CEST", tzId: "Europe/Brussels" },
  CPH: { city: "Copenhagen",    country: "Denmark",  name: "Copenhagen Airport",lat: 55.62, lon: 12.66,  tz: "CEST", tzId: "Europe/Copenhagen" },
  ARN: { city: "Stockholm",     country: "Sweden",   name: "Arlanda",           lat: 59.65, lon: 17.92,  tz: "CEST", tzId: "Europe/Stockholm" },
  OSL: { city: "Oslo",          country: "Norway",   name: "Oslo Airport",      lat: 60.19, lon: 11.10,  tz: "CEST", tzId: "Europe/Oslo" },
  HEL: { city: "Helsinki",      country: "Finland",  name: "Helsinki Airport",  lat: 60.32, lon: 24.96,  tz: "EEST", tzId: "Europe/Helsinki" },

  // ── Southern Europe ──────────────────────────────────────────────────────
  MAD: { city: "Madrid",        country: "Spain",    name: "Adolfo Suárez Barajas", lat: 40.47, lon: -3.57, tz: "CEST", tzId: "Europe/Madrid" },
  BCN: { city: "Barcelona",     country: "Spain",    name: "Barcelona-El Prat", lat: 41.30, lon: 2.08,   tz: "CEST", tzId: "Europe/Madrid" },
  LIS: { city: "Lisbon",        country: "Portugal", name: "Humberto Delgado",  lat: 38.77, lon: -9.13,  tz: "WEST", tzId: "Europe/Lisbon" },
  FCO: { city: "Rome",          country: "Italy",    name: "Fiumicino",         lat: 41.80, lon: 12.24,  tz: "CEST", tzId: "Europe/Rome" },
  MXP: { city: "Milan",         country: "Italy",    name: "Malpensa",          lat: 45.63, lon: 8.72,   tz: "CEST", tzId: "Europe/Rome" },
  ATH: { city: "Athens",        country: "Greece",   name: "Athens Intl",       lat: 37.94, lon: 23.95,  tz: "EEST", tzId: "Europe/Athens" },
  IST: { city: "Istanbul",      country: "Turkey",   name: "Istanbul Airport",  lat: 41.28, lon: 28.75,  tz: "TRT", tzId: "Europe/Istanbul" },

  // ── Central & Eastern Europe ─────────────────────────────────────────────
  WAW: { city: "Warsaw",        country: "Poland",   name: "Chopin Airport",    lat: 52.17, lon: 20.97,  tz: "CEST", tzId: "Europe/Warsaw" },
  PRG: { city: "Prague",        country: "Czechia",  name: "Václav Havel",      lat: 50.10, lon: 14.26,  tz: "CEST", tzId: "Europe/Prague" },
  BUD: { city: "Budapest",      country: "Hungary",  name: "Ferenc Liszt",      lat: 47.44, lon: 19.26,  tz: "CEST", tzId: "Europe/Budapest" },

  // ── Middle East ──────────────────────────────────────────────────────────
  DXB: { city: "Dubai",         country: "UAE",     name: "Dubai Intl",         lat: 25.25, lon: 55.36,  tz: "GST", tzId: "Asia/Dubai" },
  AUH: { city: "Abu Dhabi",     country: "UAE",     name: "Zayed Intl",         lat: 24.43, lon: 54.65,  tz: "GST", tzId: "Asia/Dubai" },
  DOH: { city: "Doha",          country: "Qatar",   name: "Hamad Intl",         lat: 25.27, lon: 51.61,  tz: "AST", tzId: "Asia/Qatar" },
  TLV: { city: "Tel Aviv",      country: "Israel",  name: "Ben Gurion",         lat: 32.01, lon: 34.89,  tz: "IDT", tzId: "Asia/Jerusalem" },
  AMM: { city: "Amman",         country: "Jordan",  name: "Queen Alia Intl",    lat: 31.72, lon: 35.99,  tz: "EEST", tzId: "Asia/Amman" },
  JED: { city: "Jeddah",        country: "Saudi Arabia", name: "King Abdulaziz Intl", lat: 21.68, lon: 39.16, tz: "AST", tzId: "Asia/Riyadh" },
  RUH: { city: "Riyadh",        country: "Saudi Arabia", name: "King Khalid Intl",    lat: 24.96, lon: 46.70, tz: "AST", tzId: "Asia/Riyadh" },
  GYD: { city: "Baku",          country: "Azerbaijan", name: "Heydar Aliyev Intl", lat: 40.47, lon: 50.05, tz: "AZT", tzId: "Asia/Baku" },

  // ── India ────────────────────────────────────────────────────────────────
  DEL: { city: "Delhi",         country: "India", name: "Indira Gandhi Intl",   lat: 28.55, lon: 77.10,  tz: "IST", tzId: "Asia/Kolkata" },
  BOM: { city: "Mumbai",        country: "India", name: "Chhatrapati Shivaji",  lat: 19.09, lon: 72.87,  tz: "IST", tzId: "Asia/Kolkata" },
  BLR: { city: "Bangalore",     country: "India", name: "Kempegowda Intl",      lat: 13.20, lon: 77.71,  tz: "IST", tzId: "Asia/Kolkata" },
  MAA: { city: "Chennai",       country: "India", name: "Chennai Intl",         lat: 12.99, lon: 80.17,  tz: "IST", tzId: "Asia/Kolkata" },
  HYD: { city: "Hyderabad",     country: "India", name: "Rajiv Gandhi Intl",    lat: 17.24, lon: 78.43,  tz: "IST", tzId: "Asia/Kolkata" },
  CCU: { city: "Kolkata",       country: "India", name: "Netaji Subhas Chandra Bose", lat: 22.65, lon: 88.45, tz: "IST", tzId: "Asia/Kolkata" },
  AMD: { city: "Ahmedabad",     country: "India", name: "Sardar Vallabhbhai Patel Intl", lat: 23.08, lon: 72.63, tz: "IST", tzId: "Asia/Kolkata" },
  PNQ: { city: "Pune",          country: "India", name: "Pune Airport",         lat: 18.58, lon: 73.92,  tz: "IST", tzId: "Asia/Kolkata" },
  GOI: { city: "Goa",           country: "India", name: "Dabolim Airport",      lat: 15.38, lon: 73.83,  tz: "IST", tzId: "Asia/Kolkata" },
  COK: { city: "Kochi",         country: "India", name: "Cochin Intl",          lat: 10.15, lon: 76.40,  tz: "IST", tzId: "Asia/Kolkata" },
  JAI: { city: "Jaipur",        country: "India", name: "Jaipur Intl",          lat: 26.82, lon: 75.81,  tz: "IST", tzId: "Asia/Kolkata" },
  LKO: { city: "Lucknow",       country: "India", name: "Chaudhary Charan Singh Intl", lat: 26.76, lon: 80.89, tz: "IST", tzId: "Asia/Kolkata" },
  IXC: { city: "Chandigarh",    country: "India", name: "Chandigarh Airport",   lat: 30.67, lon: 76.79,  tz: "IST", tzId: "Asia/Kolkata" },

  // ── Rest of South Asia ───────────────────────────────────────────────────
  KTM: { city: "Kathmandu",     country: "Nepal",      name: "Tribhuvan Intl",  lat: 27.70, lon: 85.36,  tz: "NPT", tzId: "Asia/Kathmandu" },
  CMB: { city: "Colombo",       country: "Sri Lanka",  name: "Bandaranaike Intl", lat: 7.18, lon: 79.88, tz: "IST", tzId: "Asia/Colombo" },
  DAC: { city: "Dhaka",         country: "Bangladesh", name: "Hazrat Shahjalal Intl", lat: 23.84, lon: 90.40, tz: "BST", tzId: "Asia/Dhaka" },
  KHI: { city: "Karachi",       country: "Pakistan",   name: "Jinnah Intl",     lat: 24.91, lon: 67.16,  tz: "PKT", tzId: "Asia/Karachi" },
  ISB: { city: "Islamabad",     country: "Pakistan",   name: "Islamabad Intl",  lat: 33.56, lon: 72.83,  tz: "PKT", tzId: "Asia/Karachi" },

  // ── East & Southeast Asia ────────────────────────────────────────────────
  NRT: { city: "Tokyo",         country: "Japan",       name: "Narita Intl",      lat: 35.77, lon: 140.39, tz: "JST", tzId: "Asia/Tokyo" },
  HND: { city: "Tokyo",         country: "Japan",       name: "Haneda Airport",   lat: 35.55, lon: 139.78, tz: "JST", tzId: "Asia/Tokyo" },
  KIX: { city: "Osaka",         country: "Japan",       name: "Kansai Intl",      lat: 34.43, lon: 135.24, tz: "JST", tzId: "Asia/Tokyo" },
  ICN: { city: "Seoul",         country: "South Korea", name: "Incheon Intl",     lat: 37.46, lon: 126.44, tz: "KST", tzId: "Asia/Seoul" },
  PVG: { city: "Shanghai",      country: "China",       name: "Pudong Intl",      lat: 31.14, lon: 121.81, tz: "CST", tzId: "Asia/Shanghai" },
  PEK: { city: "Beijing",       country: "China",       name: "Capital Intl",     lat: 40.08, lon: 116.58, tz: "CST", tzId: "Asia/Shanghai" },
  HKG: { city: "Hong Kong",     country: "Hong Kong",   name: "Hong Kong Intl",   lat: 22.31, lon: 113.91, tz: "HKT", tzId: "Asia/Hong_Kong" },
  TPE: { city: "Taipei",        country: "Taiwan",      name: "Taoyuan Intl",     lat: 25.08, lon: 121.23, tz: "CST", tzId: "Asia/Taipei" },
  SIN: { city: "Singapore",     country: "Singapore",   name: "Changi Airport",   lat: 1.36,  lon: 103.99, tz: "SGT", tzId: "Asia/Singapore" },
  KUL: { city: "Kuala Lumpur",  country: "Malaysia",    name: "KL Intl",          lat: 2.75,  lon: 101.71, tz: "MYT", tzId: "Asia/Kuala_Lumpur" },
  BKK: { city: "Bangkok",       country: "Thailand",    name: "Suvarnabhumi",     lat: 13.69, lon: 100.75, tz: "ICT", tzId: "Asia/Bangkok" },
  CGK: { city: "Jakarta",       country: "Indonesia",   name: "Soekarno-Hatta",   lat: -6.13, lon: 106.66, tz: "WIB", tzId: "Asia/Jakarta" },
  MNL: { city: "Manila",        country: "Philippines", name: "Ninoy Aquino Intl",lat: 14.51, lon: 121.02, tz: "PST", tzId: "Asia/Manila" },
  SGN: { city: "Ho Chi Minh City", country: "Vietnam",  name: "Tan Son Nhat Intl",lat: 10.82, lon: 106.66, tz: "ICT", tzId: "Asia/Ho_Chi_Minh" },
  HAN: { city: "Hanoi",         country: "Vietnam",     name: "Noi Bai Intl",     lat: 21.22, lon: 105.81, tz: "ICT", tzId: "Asia/Ho_Chi_Minh" },

  // ── Australia & New Zealand ──────────────────────────────────────────────
  SYD: { city: "Sydney",        country: "Australia", name: "Kingsford Smith",   lat: -33.95, lon: 151.18, tz: "AEST", tzId: "Australia/Sydney" },
  MEL: { city: "Melbourne",     country: "Australia", name: "Melbourne Airport", lat: -37.67, lon: 144.84, tz: "AEST", tzId: "Australia/Melbourne" },
  BNE: { city: "Brisbane",      country: "Australia", name: "Brisbane Airport",  lat: -27.38, lon: 153.12, tz: "AEST", tzId: "Australia/Brisbane" },
  PER: { city: "Perth",         country: "Australia", name: "Perth Airport",     lat: -31.94, lon: 115.97, tz: "AWST", tzId: "Australia/Perth" },
  AKL: { city: "Auckland",      country: "New Zealand", name: "Auckland Airport",lat: -37.01, lon: 174.79, tz: "NZST", tzId: "Pacific/Auckland" },

  // ── Africa ───────────────────────────────────────────────────────────────
  JNB: { city: "Johannesburg",  country: "South Africa", name: "O.R. Tambo Intl", lat: -26.14, lon: 28.24, tz: "SAST", tzId: "Africa/Johannesburg" },
  CPT: { city: "Cape Town",     country: "South Africa", name: "Cape Town Intl",  lat: -33.97, lon: 18.60, tz: "SAST", tzId: "Africa/Johannesburg" },
  CAI: { city: "Cairo",         country: "Egypt",        name: "Cairo Intl",      lat: 30.11, lon: 31.41, tz: "EET", tzId: "Africa/Cairo" },
  NBO: { city: "Nairobi",       country: "Kenya",        name: "Jomo Kenyatta Intl", lat: -1.32, lon: 36.93, tz: "EAT", tzId: "Africa/Nairobi" },
  LOS: { city: "Lagos",         country: "Nigeria",      name: "Murtala Muhammed Intl", lat: 6.58, lon: 3.32, tz: "WAT", tzId: "Africa/Lagos" },
  ADD: { city: "Addis Ababa",   country: "Ethiopia",     name: "Bole Intl",       lat: 8.98,  lon: 38.80, tz: "EAT", tzId: "Africa/Addis_Ababa" },
  CMN: { city: "Casablanca",    country: "Morocco",      name: "Mohammed V Intl", lat: 33.37, lon: -7.59, tz: "WEST", tzId: "Africa/Casablanca" },

  // ── Wider coverage ───────────────────────────────────────────────────────
  // Anything missing from this list has no timezone, so its times get read
  // as UTC (status hours off). These fill the gaps that showed up in real
  // trips (San Salvador, Managua) plus the secondary airports families most
  // often fly. City names deliberately avoid duplicating an existing,
  // different city (no Portland ME, Birmingham AL) since placesMatch and
  // placeTzId match by city name.
  // USA
  BNA: { city: "Nashville",     country: "USA", name: "Nashville Intl",         lat: 36.12, lon: -86.68,  tz: "CDT", tzId: "America/Chicago" },
  SAT: { city: "San Antonio",   country: "USA", name: "San Antonio Intl",       lat: 29.53, lon: -98.47,  tz: "CDT", tzId: "America/Chicago" },
  HOU: { city: "Houston",       country: "USA", name: "William P. Hobby",       lat: 29.65, lon: -95.28,  tz: "CDT", tzId: "America/Chicago" },
  DAL: { city: "Dallas",        country: "USA", name: "Dallas Love Field",      lat: 32.85, lon: -96.85,  tz: "CDT", tzId: "America/Chicago" },
  MSY: { city: "New Orleans",   country: "USA", name: "Louis Armstrong Intl",   lat: 29.99, lon: -90.26,  tz: "CDT", tzId: "America/Chicago" },
  MEM: { city: "Memphis",       country: "USA", name: "Memphis Intl",           lat: 35.04, lon: -89.98,  tz: "CDT", tzId: "America/Chicago" },
  OKC: { city: "Oklahoma City", country: "USA", name: "Will Rogers World",      lat: 35.39, lon: -97.60,  tz: "CDT", tzId: "America/Chicago" },
  OMA: { city: "Omaha",         country: "USA", name: "Eppley Airfield",        lat: 41.30, lon: -95.89,  tz: "CDT", tzId: "America/Chicago" },
  MKE: { city: "Milwaukee",     country: "USA", name: "Milwaukee Mitchell",     lat: 42.95, lon: -87.90,  tz: "CDT", tzId: "America/Chicago" },
  PIT: { city: "Pittsburgh",    country: "USA", name: "Pittsburgh Intl",        lat: 40.49, lon: -80.23,  tz: "EDT", tzId: "America/New_York" },
  CLE: { city: "Cleveland",     country: "USA", name: "Cleveland Hopkins",      lat: 41.41, lon: -81.85,  tz: "EDT", tzId: "America/New_York" },
  CMH: { city: "Columbus",      country: "USA", name: "John Glenn Columbus",    lat: 39.99, lon: -82.89,  tz: "EDT", tzId: "America/New_York" },
  CVG: { city: "Cincinnati",    country: "USA", name: "Cincinnati/N. Kentucky", lat: 39.05, lon: -84.67,  tz: "EDT", tzId: "America/New_York" },
  SDF: { city: "Louisville",    country: "USA", name: "Louisville Muhammad Ali",lat: 38.17, lon: -85.74,  tz: "EDT", tzId: "America/Kentucky/Louisville" },
  BDL: { city: "Hartford",      country: "USA", name: "Bradley Intl",           lat: 41.94, lon: -72.68,  tz: "EDT", tzId: "America/New_York" },
  PVD: { city: "Providence",    country: "USA", name: "Rhode Island T.F. Green",lat: 41.72, lon: -71.43,  tz: "EDT", tzId: "America/New_York" },
  BUF: { city: "Buffalo",       country: "USA", name: "Buffalo Niagara",        lat: 42.94, lon: -78.73,  tz: "EDT", tzId: "America/New_York" },
  ALB: { city: "Albany",        country: "USA", name: "Albany Intl",            lat: 42.75, lon: -73.80,  tz: "EDT", tzId: "America/New_York" },
  SYR: { city: "Syracuse",      country: "USA", name: "Syracuse Hancock",       lat: 43.11, lon: -76.11,  tz: "EDT", tzId: "America/New_York" },
  ROC: { city: "Rochester",     country: "USA", name: "Frederick Douglass Rochester", lat: 43.12, lon: -77.67, tz: "EDT", tzId: "America/New_York" },
  HPN: { city: "White Plains",  country: "USA", name: "Westchester County",     lat: 41.07, lon: -73.71,  tz: "EDT", tzId: "America/New_York" },
  ISP: { city: "Long Island",   country: "USA", name: "Long Island MacArthur",  lat: 40.80, lon: -73.10,  tz: "EDT", tzId: "America/New_York" },
  JAX: { city: "Jacksonville",  country: "USA", name: "Jacksonville Intl",      lat: 30.49, lon: -81.69,  tz: "EDT", tzId: "America/New_York" },
  RSW: { city: "Fort Myers",    country: "USA", name: "Southwest Florida Intl", lat: 26.54, lon: -81.76,  tz: "EDT", tzId: "America/New_York" },
  PBI: { city: "West Palm Beach",country:"USA", name: "Palm Beach Intl",        lat: 26.68, lon: -80.10,  tz: "EDT", tzId: "America/New_York" },
  SAV: { city: "Savannah",      country: "USA", name: "Savannah/Hilton Head",   lat: 32.13, lon: -81.20,  tz: "EDT", tzId: "America/New_York" },
  CHS: { city: "Charleston",    country: "USA", name: "Charleston Intl",        lat: 32.90, lon: -80.04,  tz: "EDT", tzId: "America/New_York" },
  MYR: { city: "Myrtle Beach",  country: "USA", name: "Myrtle Beach Intl",      lat: 33.68, lon: -78.93,  tz: "EDT", tzId: "America/New_York" },
  ORF: { city: "Norfolk",       country: "USA", name: "Norfolk Intl",           lat: 36.90, lon: -76.21,  tz: "EDT", tzId: "America/New_York" },
  BTV: { city: "Burlington",    country: "USA", name: "Burlington Intl",        lat: 44.47, lon: -73.15,  tz: "EDT", tzId: "America/New_York" },
  SMF: { city: "Sacramento",    country: "USA", name: "Sacramento Intl",        lat: 38.70, lon: -121.59, tz: "PDT", tzId: "America/Los_Angeles" },
  SNA: { city: "Orange County", country: "USA", name: "John Wayne",             lat: 33.68, lon: -117.87, tz: "PDT", tzId: "America/Los_Angeles" },
  BUR: { city: "Burbank",       country: "USA", name: "Hollywood Burbank",      lat: 34.20, lon: -118.36, tz: "PDT", tzId: "America/Los_Angeles" },
  LGB: { city: "Long Beach",    country: "USA", name: "Long Beach Airport",     lat: 33.82, lon: -118.15, tz: "PDT", tzId: "America/Los_Angeles" },
  PSP: { city: "Palm Springs",  country: "USA", name: "Palm Springs Intl",      lat: 33.83, lon: -116.51, tz: "PDT", tzId: "America/Los_Angeles" },
  RNO: { city: "Reno",          country: "USA", name: "Reno-Tahoe Intl",        lat: 39.50, lon: -119.77, tz: "PDT", tzId: "America/Los_Angeles" },
  GEG: { city: "Spokane",       country: "USA", name: "Spokane Intl",           lat: 47.62, lon: -117.53, tz: "PDT", tzId: "America/Los_Angeles" },
  OGG: { city: "Maui",          country: "USA", name: "Kahului Airport",        lat: 20.90, lon: -156.43, tz: "HST", tzId: "Pacific/Honolulu" },
  KOA: { city: "Kona",          country: "USA", name: "Ellison Onizuka Kona",   lat: 19.74, lon: -156.05, tz: "HST", tzId: "Pacific/Honolulu" },
  LIH: { city: "Kauai",         country: "USA", name: "Lihue Airport",          lat: 21.98, lon: -159.34, tz: "HST", tzId: "Pacific/Honolulu" },
  ABQ: { city: "Albuquerque",   country: "USA", name: "Albuquerque Sunport",    lat: 35.04, lon: -106.61, tz: "MDT", tzId: "America/Denver" },
  ELP: { city: "El Paso",       country: "USA", name: "El Paso Intl",           lat: 31.81, lon: -106.38, tz: "MDT", tzId: "America/Denver" },
  TUS: { city: "Tucson",        country: "USA", name: "Tucson Intl",            lat: 32.12, lon: -110.94, tz: "MST", tzId: "America/Phoenix" },
  BOI: { city: "Boise",         country: "USA", name: "Boise Airport",          lat: 43.56, lon: -116.22, tz: "MDT", tzId: "America/Boise" },
  JAC: { city: "Jackson Hole",  country: "USA", name: "Jackson Hole Airport",   lat: 43.61, lon: -110.74, tz: "MDT", tzId: "America/Denver" },
  ASE: { city: "Aspen",         country: "USA", name: "Aspen/Pitkin County",    lat: 39.22, lon: -106.87, tz: "MDT", tzId: "America/Denver" },
  EGE: { city: "Vail",          country: "USA", name: "Eagle County Regional",  lat: 39.64, lon: -106.92, tz: "MDT", tzId: "America/Denver" },
  BZN: { city: "Bozeman",       country: "USA", name: "Bozeman Yellowstone",    lat: 45.78, lon: -111.15, tz: "MDT", tzId: "America/Denver" },
  SJU: { city: "San Juan",      country: "Puerto Rico", name: "Luis Muñoz Marín", lat: 18.44, lon: -66.00, tz: "AST", tzId: "America/Puerto_Rico" },
  STT: { city: "St. Thomas",    country: "USVI", name: "Cyril E. King",         lat: 18.34, lon: -64.97,  tz: "AST", tzId: "America/St_Thomas" },
  // Canada
  YHZ: { city: "Halifax",       country: "Canada", name: "Halifax Stanfield",   lat: 44.88, lon: -63.51,  tz: "ADT", tzId: "America/Halifax" },
  YEG: { city: "Edmonton",      country: "Canada", name: "Edmonton Intl",       lat: 53.31, lon: -113.58, tz: "MDT", tzId: "America/Edmonton" },
  YWG: { city: "Winnipeg",      country: "Canada", name: "Winnipeg Richardson", lat: 49.91, lon: -97.24,  tz: "CDT", tzId: "America/Winnipeg" },
  YQB: { city: "Quebec City",   country: "Canada", name: "Jean Lesage Intl",    lat: 46.79, lon: -71.39,  tz: "EDT", tzId: "America/Toronto" },
  YYJ: { city: "Victoria",      country: "Canada", name: "Victoria Intl",       lat: 48.65, lon: -123.43, tz: "PDT", tzId: "America/Vancouver" },
  YLW: { city: "Kelowna",       country: "Canada", name: "Kelowna Intl",        lat: 49.96, lon: -119.38, tz: "PDT", tzId: "America/Vancouver" },
  // Mexico, Central America & Caribbean
  SJD: { city: "Los Cabos",     country: "Mexico",      name: "Los Cabos Intl",      lat: 23.15, lon: -109.72, tz: "MST", tzId: "America/Mazatlan" },
  PVR: { city: "Puerto Vallarta",country:"Mexico",      name: "Gustavo Díaz Ordaz",  lat: 20.68, lon: -105.25, tz: "CST", tzId: "America/Mexico_City" },
  MTY: { city: "Monterrey",     country: "Mexico",      name: "Monterrey Intl",      lat: 25.78, lon: -100.11, tz: "CST", tzId: "America/Monterrey" },
  SAL: { city: "San Salvador",  country: "El Salvador", name: "Óscar Arnulfo Romero",lat: 13.44, lon: -89.06,  tz: "CST", tzId: "America/El_Salvador" },
  MGA: { city: "Managua",       country: "Nicaragua",   name: "Augusto C. Sandino",  lat: 12.14, lon: -86.17,  tz: "CST", tzId: "America/Managua" },
  GUA: { city: "Guatemala City",country: "Guatemala",   name: "La Aurora Intl",      lat: 14.58, lon: -90.53,  tz: "CST", tzId: "America/Guatemala" },
  SJO: { city: "San José",      country: "Costa Rica",  name: "Juan Santamaría Intl",lat: 9.99,  lon: -84.21,  tz: "CST", tzId: "America/Costa_Rica" },
  LIR: { city: "Liberia",       country: "Costa Rica",  name: "Guanacaste Airport",  lat: 10.59, lon: -85.54,  tz: "CST", tzId: "America/Costa_Rica" },
  TGU: { city: "Tegucigalpa",   country: "Honduras",    name: "Toncontín Intl",      lat: 14.06, lon: -87.22,  tz: "CST", tzId: "America/Tegucigalpa" },
  SAP: { city: "San Pedro Sula",country: "Honduras",    name: "Ramón Villeda Morales",lat: 15.45, lon: -87.92, tz: "CST", tzId: "America/Tegucigalpa" },
  BZE: { city: "Belize City",   country: "Belize",      name: "Philip S. W. Goldson",lat: 17.54, lon: -88.31,  tz: "CST", tzId: "America/Belize" },
  PUJ: { city: "Punta Cana",    country: "Dominican Republic", name: "Punta Cana Intl", lat: 18.57, lon: -68.36, tz: "AST", tzId: "America/Santo_Domingo" },
  SDQ: { city: "Santo Domingo", country: "Dominican Republic", name: "Las Américas Intl", lat: 18.43, lon: -69.67, tz: "AST", tzId: "America/Santo_Domingo" },
  MBJ: { city: "Montego Bay",   country: "Jamaica",     name: "Sangster Intl",       lat: 18.50, lon: -77.91,  tz: "EST", tzId: "America/Jamaica" },
  KIN: { city: "Kingston",      country: "Jamaica",     name: "Norman Manley Intl",  lat: 17.94, lon: -76.79,  tz: "EST", tzId: "America/Jamaica" },
  NAS: { city: "Nassau",        country: "Bahamas",     name: "Lynden Pindling Intl",lat: 25.04, lon: -77.47,  tz: "EDT", tzId: "America/Nassau" },
  AUA: { city: "Aruba",         country: "Aruba",       name: "Queen Beatrix Intl",  lat: 12.50, lon: -70.02,  tz: "AST", tzId: "America/Aruba" },
  SXM: { city: "St. Maarten",   country: "Sint Maarten",name: "Princess Juliana Intl",lat: 18.04, lon: -63.11, tz: "AST", tzId: "America/Lower_Princes" },
  HAV: { city: "Havana",        country: "Cuba",        name: "José Martí Intl",     lat: 22.99, lon: -82.41,  tz: "CDT", tzId: "America/Havana" },
  POS: { city: "Port of Spain", country: "Trinidad and Tobago", name: "Piarco Intl", lat: 10.60, lon: -61.34, tz: "AST", tzId: "America/Port_of_Spain" },
  BGI: { city: "Bridgetown",    country: "Barbados",    name: "Grantley Adams Intl", lat: 13.07, lon: -59.49,  tz: "AST", tzId: "America/Barbados" },
  // South America
  UIO: { city: "Quito",         country: "Ecuador",   name: "Mariscal Sucre Intl",   lat: -0.13, lon: -78.36,  tz: "ECT", tzId: "America/Guayaquil" },
  GYE: { city: "Guayaquil",     country: "Ecuador",   name: "José Joaquín de Olmedo",lat: -2.16, lon: -79.88,  tz: "ECT", tzId: "America/Guayaquil" },
  MDE: { city: "Medellín",      country: "Colombia",  name: "José María Córdova",    lat: 6.16,  lon: -75.42,  tz: "COT", tzId: "America/Bogota" },
  CTG: { city: "Cartagena",     country: "Colombia",  name: "Rafael Núñez Intl",     lat: 10.44, lon: -75.51,  tz: "COT", tzId: "America/Bogota" },
  CUZ: { city: "Cusco",         country: "Peru",      name: "Alejandro Velasco Astete", lat: -13.54, lon: -71.94, tz: "PET", tzId: "America/Lima" },
  MVD: { city: "Montevideo",    country: "Uruguay",   name: "Carrasco Intl",         lat: -34.84, lon: -56.03, tz: "UYT", tzId: "America/Montevideo" },
  CCS: { city: "Caracas",       country: "Venezuela", name: "Simón Bolívar Intl",    lat: 10.60, lon: -66.99,  tz: "VET", tzId: "America/Caracas" },
  // Europe
  KEF: { city: "Reykjavík",     country: "Iceland",  name: "Keflavík Intl",      lat: 63.99, lon: -22.61, tz: "GMT",  tzId: "Atlantic/Reykjavik" },
  GLA: { city: "Glasgow",       country: "UK",       name: "Glasgow Airport",    lat: 55.87, lon: -4.43,  tz: "BST",  tzId: "Europe/London" },
  NCE: { city: "Nice",          country: "France",   name: "Côte d'Azur",        lat: 43.66, lon: 7.22,   tz: "CEST", tzId: "Europe/Paris" },
  LYS: { city: "Lyon",          country: "France",   name: "Lyon-Saint Exupéry", lat: 45.73, lon: 5.08,   tz: "CEST", tzId: "Europe/Paris" },
  VCE: { city: "Venice",        country: "Italy",    name: "Marco Polo",         lat: 45.51, lon: 12.35,  tz: "CEST", tzId: "Europe/Rome" },
  NAP: { city: "Naples",        country: "Italy",    name: "Naples Intl",        lat: 40.88, lon: 14.29,  tz: "CEST", tzId: "Europe/Rome" },
  FLR: { city: "Florence",      country: "Italy",    name: "Peretola",           lat: 43.81, lon: 11.20,  tz: "CEST", tzId: "Europe/Rome" },
  OPO: { city: "Porto",         country: "Portugal", name: "Francisco Sá Carneiro", lat: 41.24, lon: -8.68, tz: "WEST", tzId: "Europe/Lisbon" },
  AGP: { city: "Málaga",        country: "Spain",    name: "Málaga-Costa del Sol", lat: 36.67, lon: -4.50, tz: "CEST", tzId: "Europe/Madrid" },
  PMI: { city: "Palma de Mallorca", country: "Spain",name: "Palma de Mallorca",  lat: 39.55, lon: 2.74,   tz: "CEST", tzId: "Europe/Madrid" },
  HAM: { city: "Hamburg",       country: "Germany",  name: "Hamburg Airport",    lat: 53.63, lon: 9.99,   tz: "CEST", tzId: "Europe/Berlin" },
  DUS: { city: "Düsseldorf",    country: "Germany",  name: "Düsseldorf Airport", lat: 51.29, lon: 6.77,   tz: "CEST", tzId: "Europe/Berlin" },
  KRK: { city: "Kraków",        country: "Poland",   name: "John Paul II Intl",  lat: 50.08, lon: 19.78,  tz: "CEST", tzId: "Europe/Warsaw" },
  OTP: { city: "Bucharest",     country: "Romania",  name: "Henri Coandă Intl",  lat: 44.57, lon: 26.09,  tz: "EEST", tzId: "Europe/Bucharest" },
  SOF: { city: "Sofia",         country: "Bulgaria", name: "Sofia Airport",      lat: 42.70, lon: 23.41,  tz: "EEST", tzId: "Europe/Sofia" },
  DBV: { city: "Dubrovnik",     country: "Croatia",  name: "Dubrovnik Airport",  lat: 42.56, lon: 18.27,  tz: "CEST", tzId: "Europe/Zagreb" },
  SPU: { city: "Split",         country: "Croatia",  name: "Split Airport",      lat: 43.54, lon: 16.30,  tz: "CEST", tzId: "Europe/Zagreb" },
  JTR: { city: "Santorini",     country: "Greece",   name: "Santorini Airport",  lat: 36.40, lon: 25.48,  tz: "EEST", tzId: "Europe/Athens" },
  JMK: { city: "Mykonos",       country: "Greece",   name: "Mykonos Airport",    lat: 37.44, lon: 25.35,  tz: "EEST", tzId: "Europe/Athens" },
  SAW: { city: "Istanbul",      country: "Turkey",   name: "Sabiha Gökçen",      lat: 40.90, lon: 29.31,  tz: "TRT",  tzId: "Europe/Istanbul" },
  MLA: { city: "Malta",         country: "Malta",    name: "Malta Intl",         lat: 35.86, lon: 14.48,  tz: "CEST", tzId: "Europe/Malta" },
  TBS: { city: "Tbilisi",       country: "Georgia",  name: "Tbilisi Intl",       lat: 41.67, lon: 44.95,  tz: "GET",  tzId: "Asia/Tbilisi" },
  // Middle East
  BAH: { city: "Bahrain",       country: "Bahrain",  name: "Bahrain Intl",       lat: 26.27, lon: 50.63,  tz: "AST",  tzId: "Asia/Bahrain" },
  KWI: { city: "Kuwait City",   country: "Kuwait",   name: "Kuwait Intl",        lat: 29.24, lon: 47.97,  tz: "AST",  tzId: "Asia/Kuwait" },
  MCT: { city: "Muscat",        country: "Oman",     name: "Muscat Intl",        lat: 23.59, lon: 58.28,  tz: "GST",  tzId: "Asia/Muscat" },
  SHJ: { city: "Sharjah",       country: "UAE",      name: "Sharjah Intl",       lat: 25.33, lon: 55.52,  tz: "GST",  tzId: "Asia/Dubai" },
  // India & South Asia
  TRV: { city: "Thiruvananthapuram", country: "India", name: "Trivandrum Intl",  lat: 8.48,  lon: 76.92,  tz: "IST", tzId: "Asia/Kolkata" },
  CJB: { city: "Coimbatore",    country: "India", name: "Coimbatore Intl",       lat: 11.03, lon: 77.04,  tz: "IST", tzId: "Asia/Kolkata" },
  IXM: { city: "Madurai",       country: "India", name: "Madurai Airport",       lat: 9.83,  lon: 78.09,  tz: "IST", tzId: "Asia/Kolkata" },
  VTZ: { city: "Visakhapatnam", country: "India", name: "Visakhapatnam Intl",    lat: 17.72, lon: 83.22,  tz: "IST", tzId: "Asia/Kolkata" },
  BBI: { city: "Bhubaneswar",   country: "India", name: "Biju Patnaik Intl",     lat: 20.24, lon: 85.82,  tz: "IST", tzId: "Asia/Kolkata" },
  NAG: { city: "Nagpur",        country: "India", name: "Dr. Babasaheb Ambedkar Intl", lat: 21.09, lon: 79.05, tz: "IST", tzId: "Asia/Kolkata" },
  IDR: { city: "Indore",        country: "India", name: "Devi Ahilya Bai Holkar",lat: 22.72, lon: 75.80,  tz: "IST", tzId: "Asia/Kolkata" },
  STV: { city: "Surat",         country: "India", name: "Surat Intl",            lat: 21.11, lon: 72.74,  tz: "IST", tzId: "Asia/Kolkata" },
  BDQ: { city: "Vadodara",      country: "India", name: "Vadodara Airport",      lat: 22.34, lon: 73.23,  tz: "IST", tzId: "Asia/Kolkata" },
  UDR: { city: "Udaipur",       country: "India", name: "Maharana Pratap",       lat: 24.62, lon: 73.90,  tz: "IST", tzId: "Asia/Kolkata" },
  ATQ: { city: "Amritsar",      country: "India", name: "Sri Guru Ram Dass Jee Intl", lat: 31.71, lon: 74.80, tz: "IST", tzId: "Asia/Kolkata" },
  SXR: { city: "Srinagar",      country: "India", name: "Srinagar Intl",         lat: 33.99, lon: 74.77,  tz: "IST", tzId: "Asia/Kolkata" },
  IXL: { city: "Leh",           country: "India", name: "Kushok Bakula Rimpochee", lat: 34.14, lon: 77.55, tz: "IST", tzId: "Asia/Kolkata" },
  DED: { city: "Dehradun",      country: "India", name: "Jolly Grant Airport",   lat: 30.19, lon: 78.18,  tz: "IST", tzId: "Asia/Kolkata" },
  VNS: { city: "Varanasi",      country: "India", name: "Lal Bahadur Shastri Intl", lat: 25.45, lon: 82.86, tz: "IST", tzId: "Asia/Kolkata" },
  PAT: { city: "Patna",         country: "India", name: "Jay Prakash Narayan",   lat: 25.59, lon: 85.09,  tz: "IST", tzId: "Asia/Kolkata" },
  IXB: { city: "Bagdogra",      country: "India", name: "Bagdogra Airport",      lat: 26.68, lon: 88.33,  tz: "IST", tzId: "Asia/Kolkata" },
  GAU: { city: "Guwahati",      country: "India", name: "Lokpriya Gopinath Bordoloi", lat: 26.11, lon: 91.59, tz: "IST", tzId: "Asia/Kolkata" },
  IXZ: { city: "Port Blair",    country: "India", name: "Veer Savarkar Intl",    lat: 11.64, lon: 92.73,  tz: "IST", tzId: "Asia/Kolkata" },
  GOX: { city: "Goa",           country: "India", name: "Manohar Intl (Mopa)",   lat: 15.73, lon: 73.86,  tz: "IST", tzId: "Asia/Kolkata" },
  MLE: { city: "Malé",          country: "Maldives", name: "Velana Intl",        lat: 4.19,  lon: 73.53,  tz: "MVT", tzId: "Indian/Maldives" },
  // East & Southeast Asia
  DPS: { city: "Bali",          country: "Indonesia",   name: "Ngurah Rai Intl",   lat: -8.75, lon: 115.17, tz: "WITA", tzId: "Asia/Makassar" },
  CEB: { city: "Cebu",          country: "Philippines", name: "Mactan-Cebu Intl",  lat: 10.31, lon: 123.98, tz: "PST",  tzId: "Asia/Manila" },
  PEN: { city: "Penang",        country: "Malaysia",    name: "Penang Intl",       lat: 5.30,  lon: 100.28, tz: "MYT",  tzId: "Asia/Kuala_Lumpur" },
  HKT: { city: "Phuket",        country: "Thailand",    name: "Phuket Intl",       lat: 8.11,  lon: 98.32,  tz: "ICT",  tzId: "Asia/Bangkok" },
  CNX: { city: "Chiang Mai",    country: "Thailand",    name: "Chiang Mai Intl",   lat: 18.77, lon: 98.96,  tz: "ICT",  tzId: "Asia/Bangkok" },
  DMK: { city: "Bangkok",       country: "Thailand",    name: "Don Mueang Intl",   lat: 13.91, lon: 100.61, tz: "ICT",  tzId: "Asia/Bangkok" },
  SAI: { city: "Siem Reap",     country: "Cambodia",    name: "Siem Reap-Angkor Intl", lat: 13.37, lon: 104.22, tz: "ICT", tzId: "Asia/Phnom_Penh" },
  RGN: { city: "Yangon",        country: "Myanmar",     name: "Yangon Intl",       lat: 16.91, lon: 96.13,  tz: "MMT",  tzId: "Asia/Yangon" },
  DAD: { city: "Da Nang",       country: "Vietnam",     name: "Da Nang Intl",      lat: 16.04, lon: 108.20, tz: "ICT",  tzId: "Asia/Ho_Chi_Minh" },
  CTS: { city: "Sapporo",       country: "Japan",       name: "New Chitose",       lat: 42.78, lon: 141.69, tz: "JST",  tzId: "Asia/Tokyo" },
  FUK: { city: "Fukuoka",       country: "Japan",       name: "Fukuoka Airport",   lat: 33.59, lon: 130.45, tz: "JST",  tzId: "Asia/Tokyo" },
  OKA: { city: "Okinawa",       country: "Japan",       name: "Naha Airport",      lat: 26.20, lon: 127.65, tz: "JST",  tzId: "Asia/Tokyo" },
  NGO: { city: "Nagoya",        country: "Japan",       name: "Chubu Centrair",    lat: 34.86, lon: 136.81, tz: "JST",  tzId: "Asia/Tokyo" },
  ITM: { city: "Osaka",         country: "Japan",       name: "Itami Airport",     lat: 34.79, lon: 135.44, tz: "JST",  tzId: "Asia/Tokyo" },
  GMP: { city: "Seoul",         country: "South Korea", name: "Gimpo Intl",        lat: 37.56, lon: 126.80, tz: "KST",  tzId: "Asia/Seoul" },
  PUS: { city: "Busan",         country: "South Korea", name: "Gimhae Intl",       lat: 35.18, lon: 128.94, tz: "KST",  tzId: "Asia/Seoul" },
  CAN: { city: "Guangzhou",     country: "China",       name: "Baiyun Intl",       lat: 23.39, lon: 113.30, tz: "CST",  tzId: "Asia/Shanghai" },
  SZX: { city: "Shenzhen",      country: "China",       name: "Bao'an Intl",       lat: 22.64, lon: 113.81, tz: "CST",  tzId: "Asia/Shanghai" },
  CTU: { city: "Chengdu",       country: "China",       name: "Shuangliu Intl",    lat: 30.58, lon: 103.95, tz: "CST",  tzId: "Asia/Shanghai" },
  MFM: { city: "Macau",         country: "Macau",       name: "Macau Intl",        lat: 22.15, lon: 113.59, tz: "CST",  tzId: "Asia/Macau" },
  TAS: { city: "Tashkent",      country: "Uzbekistan",  name: "Islam Karimov Tashkent Intl", lat: 41.26, lon: 69.28, tz: "UZT", tzId: "Asia/Tashkent" },
  // Africa
  DAR: { city: "Dar es Salaam", country: "Tanzania",     name: "Julius Nyerere Intl", lat: -6.88, lon: 39.20, tz: "EAT",  tzId: "Africa/Dar_es_Salaam" },
  ZNZ: { city: "Zanzibar",      country: "Tanzania",     name: "Abeid Amani Karume",  lat: -6.22, lon: 39.22, tz: "EAT",  tzId: "Africa/Dar_es_Salaam" },
  JRO: { city: "Kilimanjaro",   country: "Tanzania",     name: "Kilimanjaro Intl",    lat: -3.43, lon: 37.07, tz: "EAT",  tzId: "Africa/Dar_es_Salaam" },
  KGL: { city: "Kigali",        country: "Rwanda",       name: "Kigali Intl",         lat: -1.97, lon: 30.14, tz: "CAT",  tzId: "Africa/Kigali" },
  EBB: { city: "Entebbe",       country: "Uganda",       name: "Entebbe Intl",        lat: 0.04,  lon: 32.44, tz: "EAT",  tzId: "Africa/Kampala" },
  ACC: { city: "Accra",         country: "Ghana",        name: "Kotoka Intl",         lat: 5.61,  lon: -0.17, tz: "GMT",  tzId: "Africa/Accra" },
  DSS: { city: "Dakar",         country: "Senegal",      name: "Blaise Diagne Intl",  lat: 14.67, lon: -17.07, tz: "GMT", tzId: "Africa/Dakar" },
  RAK: { city: "Marrakesh",     country: "Morocco",      name: "Marrakesh Menara",    lat: 31.61, lon: -8.04, tz: "WEST", tzId: "Africa/Casablanca" },
  TUN: { city: "Tunis",         country: "Tunisia",      name: "Tunis-Carthage",      lat: 36.85, lon: 10.23, tz: "CET",  tzId: "Africa/Tunis" },
  MRU: { city: "Mauritius",     country: "Mauritius",    name: "Sir Seewoosagur Ramgoolam", lat: -20.43, lon: 57.68, tz: "MUT", tzId: "Indian/Mauritius" },
  SEZ: { city: "Mahé",          country: "Seychelles",   name: "Seychelles Intl",     lat: -4.67, lon: 55.52, tz: "SCT",  tzId: "Indian/Mahe" },
  DUR: { city: "Durban",        country: "South Africa", name: "King Shaka Intl",     lat: -29.61, lon: 31.12, tz: "SAST", tzId: "Africa/Johannesburg" },
  VFA: { city: "Victoria Falls",country: "Zimbabwe",     name: "Victoria Falls Airport", lat: -18.10, lon: 25.84, tz: "CAT", tzId: "Africa/Harare" },
  WDH: { city: "Windhoek",      country: "Namibia",      name: "Hosea Kutako Intl",   lat: -22.48, lon: 17.47, tz: "CAT",  tzId: "Africa/Windhoek" },
  // Australia & Pacific
  ADL: { city: "Adelaide",      country: "Australia",   name: "Adelaide Airport",   lat: -34.95, lon: 138.53, tz: "ACST", tzId: "Australia/Adelaide" },
  CNS: { city: "Cairns",        country: "Australia",   name: "Cairns Airport",     lat: -16.88, lon: 145.75, tz: "AEST", tzId: "Australia/Brisbane" },
  OOL: { city: "Gold Coast",    country: "Australia",   name: "Gold Coast Airport", lat: -28.16, lon: 153.51, tz: "AEST", tzId: "Australia/Brisbane" },
  CBR: { city: "Canberra",      country: "Australia",   name: "Canberra Airport",   lat: -35.31, lon: 149.19, tz: "AEST", tzId: "Australia/Sydney" },
  CHC: { city: "Christchurch",  country: "New Zealand", name: "Christchurch Intl",  lat: -43.49, lon: 172.53, tz: "NZST", tzId: "Pacific/Auckland" },
  ZQN: { city: "Queenstown",    country: "New Zealand", name: "Queenstown Airport", lat: -45.02, lon: 168.74, tz: "NZST", tzId: "Pacific/Auckland" },
  WLG: { city: "Wellington",    country: "New Zealand", name: "Wellington Intl",    lat: -41.33, lon: 174.81, tz: "NZST", tzId: "Pacific/Auckland" },
  NAN: { city: "Nadi",          country: "Fiji",        name: "Nadi Intl",          lat: -17.76, lon: 177.44, tz: "FJT",  tzId: "Pacific/Fiji" },
  PPT: { city: "Tahiti",        country: "French Polynesia", name: "Faa'a Intl",    lat: -17.55, lon: -149.61, tz: "TAHT", tzId: "Pacific/Tahiti" },
};

// Airline metadata — shows up on cards and flight detail. `icao` is the
// 3-letter code FlightAware's per-flight URLs actually key off of — its
// live-tracking idents are ICAO-based ("AIC681"), not the IATA code printed
// on the ticket ("AI681"); a plain IATA-prefixed URL resolves to the wrong
// flight (or nothing) more often than not. See flightAwareUrl below.
const AIRLINES = {
  AI: { name: "Air India",        color: "#c8102e", icao: "AIC" },
  UA: { name: "United",           color: "#005daa", icao: "UAL" },
  AS: { name: "Alaska Airlines",  color: "#003561", icao: "ASA" },
  DL: { name: "Delta",            color: "#9b1c2e", icao: "DAL" },
  BA: { name: "British Airways",  color: "#075aaa", icao: "BAW" },
  WN: { name: "Southwest",        color: "#f9b612", icao: "SWA" },
  AA: { name: "American",         color: "#0078d2", icao: "AAL" },
  EK: { name: "Emirates",         color: "#d71a21", icao: "UAE" },
  AF: { name: "Air France",       color: "#002157", icao: "AFR" },
  EY: { name: "Etihad Airways",   color: "#bd8b13", icao: "ETD" },
  QR: { name: "Qatar Airways",    color: "#5c0632", icao: "QTR" },
  LH: { name: "Lufthansa",        color: "#05164d", icao: "DLH" },
  VS: { name: "Virgin Atlantic",  color: "#e10a0a", icao: "VIR" },
  SQ: { name: "Singapore Airlines", color: "#f99f1c", icao: "SIA" },
  CX: { name: "Cathay Pacific",   color: "#00644e", icao: "CPA" },
  TK: { name: "Turkish Airlines", color: "#c70a0c", icao: "THY" },
  LX: { name: "Swiss",            color: "#cc0000", icao: "SWR" },
  KL: { name: "KLM",              color: "#00a1de", icao: "KLM" },
  "6E": { name: "IndiGo",         color: "#00205b", icao: "IGO" },
  UK: { name: "Vistara",          color: "#4c2882", icao: "VTI" },
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
// flight ages off the live board on its own after 8 hours; after that it's
// "past" and only visible in Calendar, which just lists what was actually
// logged.
//
// Compares against the flight's *real* UTC instant (see flightRealDepart/
// flightRealArrive below), not the naive stored digits — comparing naive
// digits directly against a real "now" silently drifts by the size of the
// airport's UTC offset (flips to "landed" hours early for US airports,
// hours late for India/Gulf/Asia/Australia ones) since the naive value
// isn't actually the same instant as the real clock reads.
function flightStatus(f, now = new Date()) {
  // Someone you follow but aren't in the close circle of: only the calendar
  // days are known, so the trip is just "upcoming" until its arrival day has
  // passed — never "in the air" or "landed" on a guess.
  if (f.limited) {
    const today = viewerToday(now).getTime();
    return today > Date.UTC(f.arrive.getUTCFullYear(), f.arrive.getUTCMonth(), f.arrive.getUTCDate()) ? "past" : "scheduled";
  }
  const dep = flightRealDepart(f).getTime(), arr = flightRealArrive(f).getTime(), n = now.getTime();
  if (n >= arr + hours(8))                  return "past";
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

// Two "place" values (an airport code, or a free-typed city — train/car
// legs, or a flight leg someone typed instead of picking from the airport
// list) are the same place if they're an exact match, OR if either/both
// resolve to a known airport and those airports share a city — "IST" and
// "Istanbul" need to compare equal, not look like two different places,
// or a flight landing at IST and a second one leaving from "Istanbul"
// (typed instead of picked from the list) won't be recognized as a
// connection, and a return leg logged the same loose way won't be found
// either. This is the actual fix for that mismatch; the AddTripModal
// datalist (see modals.jsx) reduces how often it happens in the first
// place, but doesn't guarantee it — someone can always just type.
function placesMatch(a, b) {
  if (!a || !b) return false;
  const normA = String(a).trim().toUpperCase();
  const normB = String(b).trim().toUpperCase();
  if (normA === normB) return true;
  return placeCityKey(a) === placeCityKey(b);
}

// Free-typed place text, reduced to the same uppercase city name AIRPORTS
// uses — "Washington, D.C.", "Washington DC" and "DCA" all come out as
// "WASHINGTON". Without this, "Washington DC" (a real saved train leg)
// matched no known city, so it had no timezone and its times were read as
// UTC — hours off for status and countdowns.
const PLACE_ALIASES = {
  "WASHINGTON DC": "WASHINGTON", "DC": "WASHINGTON",
  "NYC": "NEW YORK", "NEW YORK CITY": "NEW YORK", "MANHATTAN": "NEW YORK",
  "SF": "SAN FRANCISCO", "LA": "LOS ANGELES", "PHILLY": "PHILADELPHIA",
  "BOMBAY": "MUMBAI", "BENGALURU": "BANGALORE", "MADRAS": "CHENNAI",
  "CALCUTTA": "KOLKATA", "NEW DELHI": "DELHI", "GURGAON": "DELHI", "GURUGRAM": "DELHI",
};
function placeCityKey(place) {
  const raw = String(place).trim().toUpperCase();
  if (AIRPORTS[raw]) return AIRPORTS[raw].city.toUpperCase();
  const norm = raw.replace(/\./g, "").replace(/,.*$/, "").replace(/\s+/g, " ").trim();
  return PLACE_ALIASES[norm] ?? norm;
}

// Purely a data-completeness check, not a location claim: is there any
// other logged flight, for at least one of the same travelers, departing
// from where this one landed? If not, that's worth flagging so whoever's
// looking knows to add the return leg — not so the app can guess how long
// they're away for.
const hasLoggedReturn = (flight, allFlights) => allFlights.some((other) =>
  other.id !== flight.id &&
  placesMatch(other.from, flight.to) &&
  other.depart > flight.arrive &&
  other.travelers.some((id) => flight.travelers.includes(id))
);

// True when every traveler on this flight already lives where it lands —
// the trip needs no return leg because it *is* the return leg (or just
// doesn't need one). Only suppresses the "return not logged" nudge when
// that's true for everyone aboard; a mixed group (some home, some not)
// still gets the nudge, since it may still be missing for whoever isn't.
// Uses placesMatch (city-level, not exact code) — someone whose home
// airport is JFK is still home if they land at LGA or EWR instead; a metro
// area commonly has more than one airport, and a family member landing at
// whichever one had the better fare shouldn't read as "away from home".
const isHomeArrival = (flight) => flight.travelers.length > 0 &&
  flight.travelers.every((id) => placesMatch(familyById(id)?.homeAirport, flight.to));

// RouteMap needs real lat/lon to draw an arc — a free-typed airport code we
// don't recognize (or train/car's plain city text) has none, and feeding it
// undefined produces NaN coordinates and broken SVG. Callers should check
// this before rendering RouteMap and fall back to the mode-icon block
// (already the pattern used for train/car) when it's false.
const hasCoords = (a, b) => Number.isFinite(a?.lat) && Number.isFinite(a?.lon) && Number.isFinite(b?.lat) && Number.isFinite(b?.lon);

// ── viewer-local time ───────────────────────────────────────────────────────
// The app deliberately stores depart_at/arrive_at as "naive UTC" — the digits
// are the literal local wall-clock time at the airport, with a bare "Z"
// slapped on (see fmtTime). That's fine for showing the airport's own time,
// but showing what that same moment reads as on the *viewer's* clock needs a
// real timezone conversion: reinterpret those digits as wall-clock time in
// the airport's real IANA zone (tzId), find the actual UTC instant that
// implies, then format that instant in the viewer's own zone.
//
// Uses only Intl.DateTimeFormat (built into every modern browser) — no
// library needed. Degrades to null wherever we don't have a real zone
// (unrecognized airport, train/car's free-text place) — callers should just
// omit the second time line in that case, never guess.
function zonedWallClockToUtc(wallClockDate, tzId) {
  // wallClockDate's UTC-getters hold the "as if UTC" wall-clock digits.
  const y = wallClockDate.getUTCFullYear(), mo = wallClockDate.getUTCMonth(), d = wallClockDate.getUTCDate();
  const h = wallClockDate.getUTCHours(), mi = wallClockDate.getUTCMinutes(), s = wallClockDate.getUTCSeconds();
  const naiveUTC = Date.UTC(y, mo, d, h, mi, s);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tzId, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  // Converge in 2 passes — offsets only change across a DST boundary crossed
  // mid-iteration, which a second pass always resolves.
  let guess = naiveUTC;
  for (let i = 0; i < 2; i++) {
    const parts = dtf.formatToParts(new Date(guess)).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const hh = parts.hour === "24" ? "00" : parts.hour; // some locales format midnight as 24
    const asIfUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hh, +parts.minute, +parts.second);
    guess += naiveUTC - asIfUTC;
  }
  return new Date(guess);
}

// The viewer's own IANA zone, resolved once from the browser.
const VIEWER_TZ = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return null; }
})();

// Whole-day difference between two "YYYY-MM-DD" strings — used to turn a
// pair of calendar dates into a signed day count (+2, -1, etc.), not just a
// before/same/after sign. Date.UTC keeps this purely calendar arithmetic,
// no timezone involved (the strings are already local-to-whatever-zone).
function daysBetweenYmd(laterYmd, earlierYmd) {
  const [ly, lm, ld] = laterYmd.split("-").map(Number);
  const [ey, em, ed] = earlierYmd.split("-").map(Number);
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86400000);
}

// Given a stored "naive UTC" flight time and the airport it belongs to,
// return { time: "9:40 AM", tzAbbrev: "EST", dayShift } in the viewer's own
// zone — dayShift is a signed day count (not just -1/0/1: a long-haul
// arrival can legitimately land two calendar days after departure in one
// zone's reading and only one in another's), telling the caller how far
// this rendering's calendar date sits from `referenceTime`'s own stored
// date, so the UI can flag "+1d"/"+2d". referenceTime defaults to
// flightTime itself (comparing a rendering against its own leg's printed
// date — the original behavior, still what a departure-time call wants);
// pass the flight's *departure* time explicitly when calling this for an
// arrival, so every rendering of the arrival — this airport's own zone,
// the viewer's zone, any zone — reports its offset from the same "day 0"
// instead of each drifting against its own leg's date. The zone
// abbreviation is shown alongside the time rather than a vague "your time"
// label: if the browser's guess at the viewer's zone is ever wrong, naming
// the zone we actually used keeps the claim checkable instead of silently
// asserting a time that might not be right. Returns null when we can't do
// the conversion honestly (no known zone for this airport, or the
// browser's own zone couldn't be resolved) rather than guess.
function viewerTime(flightTime, airportEntry, referenceTime = flightTime) {
  if (!VIEWER_TZ || !airportEntry?.tzId) return null;
  if (airportEntry.tzId === VIEWER_TZ) return null; // same zone — a second line would be redundant
  const real = zonedWallClockToUtc(flightTime, airportEntry.tzId);
  // 24h, matching fmtTime's boarding-pass-style primary time elsewhere.
  const timeStr = real.toLocaleString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: VIEWER_TZ });
  const tzParts = new Intl.DateTimeFormat("en-US", { timeZone: VIEWER_TZ, timeZoneName: "short", hour: "numeric" }).formatToParts(real);
  const tzAbbrev = tzParts.find((p) => p.type === "timeZoneName")?.value || "";
  const viewerYmd = real.toLocaleString("en-CA", { timeZone: VIEWER_TZ }).slice(0, 10); // YYYY-MM-DD
  const referenceYmd = `${referenceTime.getUTCFullYear()}-${String(referenceTime.getUTCMonth() + 1).padStart(2, "0")}-${String(referenceTime.getUTCDate()).padStart(2, "0")}`;
  const dayShift = daysBetweenYmd(viewerYmd, referenceYmd);
  return { time: timeStr, tzAbbrev, dayShift };
}

// Convenience getters. Airline/airport codes can now be free-typed (see
// save-flight's stub-row upsert) or, for train/car, plain city text that was
// never meant to resolve against these small reference tables at all — both
// fall back to a bare object built from the code itself so callers can keep
// reading `.name`/`.city`/`.color` without null-checking everywhere.
const familyById  = (id) => FAMILY.find((p) => p.id === id);
const airline     = (code) => AIRLINES[code] || { code: code || "", name: code || "—", color: "var(--ink-soft)" };
const airport     = (code) => AIRPORTS[code] || { code: code || "", city: code || "—", country: "", name: code || "" };

// The flight's real UTC instants — reinterprets the stored "naive" digits as
// wall-clock time at the actual airports and converts using their real IANA
// zones (see zonedWallClockToUtc above). Anything comparing a flight's
// depart/arrive against a live `now` — status, countdowns, progress bars,
// duration — must use these, not the raw f.depart/f.arrive, or the
// comparison silently drifts by the size of whatever UTC offset the naive
// digits were never actually adjusted for. f.depart/f.arrive stay exactly
// as stored for *display* (fmtTime etc.), which is deliberately
// airport-local and doesn't need this conversion.
//
// Both ends must have a known zone before *either* gets corrected — origin
// and destination are corrected as a pair, never one alone. Shifting only
// the end we happen to recognize (e.g. a flight to an airport outside our
// 137-entry list) leaves the other end on the old naive basis, and the two
// are no longer the same kind of instant: a real depart can end up reading
// *later* than a still-naive arrival, producing a negative duration. Falling
// back to the naive value for both ends is less precise but never
// self-contradictory.
// Train/car legs store free-typed city text in from/to, not an airport code
// — airport(place) doesn't recognize "Baltimore" the way it recognizes
// "BWI", so it falls back to a bare {code, city, ...} object with no tzId.
// Without this, flightRealTimes below had no zone to correct with and fell
// back to comparing naive digits directly against a real "now" — which
// isn't a fallback so much as silently wrong for any zone that isn't UTC:
// a train stored as "18:00" Eastern gets read as 18:00 *UTC* (14:00
// Eastern), so the board can flip to "in progress" hours before it
// actually departs. This recovers a real zone the same way placesMatch
// already recognizes "Baltimore" and "BWI" as the same place: match the
// typed text against a known airport's city name. Covers the common case
// (someone types a real city) without requiring train/car legs to have
// their own timezone database.
function placeTzId(place) {
  if (!place) return null;
  const key = placeCityKey(place);
  const hit = Object.values(AIRPORTS).find((a) => a.city.toUpperCase() === key);
  return hit?.tzId ?? null;
}
const placeTz = (place) => airport(place)?.tzId ?? placeTzId(place);

function flightRealTimes(f) {
  const fromTz = placeTz(f.from);
  const toTz = placeTz(f.to);
  if (!fromTz || !toTz) return { depart: f.depart, arrive: f.arrive };
  return { depart: zonedWallClockToUtc(f.depart, fromTz), arrive: zonedWallClockToUtc(f.arrive, toTz) };
}
function flightRealDepart(f) { return flightRealTimes(f).depart; }
function flightRealArrive(f) { return flightRealTimes(f).arrive; }

// The inverse of zonedWallClockToUtc: a real instant → a Date in the app's
// naive convention, whose UTC digits are the wall clock in `tzId` at that
// instant. Used to turn an estimated real arrival back into the
// airport-local time we store.
function utcToZonedWallClock(instant, tzId) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tzId, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +hh, +parts.minute, +parts.second));
}

// ── building a leg's stored times ───────────────────────────────────────────
// Every form and the bulk upload queue funnel through resolveLegTimes, so a
// leg can't be saved landing before it takes off. Both saved flights that
// showed "Landed" before departure (JFK→BOM, arriving two calendar days
// later) were the same bug: the form could only say "next day", so the
// arrival got stored a day early — before takeoff in real time — and
// flightStatus calls anything past its arrival "landed".
//
// A single "flight" can be a whole multi-stop ticket (JFK→LHR→BOM saved as
// one leg), so the ceiling is generous; it's there to reject nonsense, not
// to judge itineraries.
const MAX_LEG_HOURS = { flight: 40, train: 72, car: 72 };
const ARRIVE_DAY_OFFSETS = [-1, 0, 1, 2, 3];

function addDaysYmd(ymd, n) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function greatCircleKm(a, b) {
  const rad = (x) => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

// When no arrival time was entered (boarding passes often don't print one):
// great-circle distance at a typical cruise speed plus 30 minutes for
// taxi/climb, for a flight between airports we can place; a flat 2 hours
// otherwise. The old default was "departure + 2 hours" on the *destination's*
// clock, which for any eastbound flight across 2+ time zones lands before
// takeoff.
function estimatedLegMs({ mode, from, to }) {
  const a = airport(from), b = airport(to);
  if ((mode || "flight") !== "flight" || !hasCoords(a, b)) return hours(2);
  return Math.max(minutes(45), Math.round(greatCircleKm(a, b) / 830 * 60 + 30) * 60000);
}

// Turns what was typed or parsed — departure date + time, arrival time, and
// which calendar day it lands relative to departure — into the stored
// depart/arrive Dates. If the chosen day can't be right (arrives before
// takeoff, or implausibly long), it picks the nearest day that is and says
// so via `adjusted`, rather than saving a leg that's wrong on the board.
// Places with no known timezone can't be checked; `unknownZone` flags that
// so the form can say so instead of silently trusting it.
function resolveLegTimes({ mode = "flight", from, to, date, departTime, arriveTime, arriveDayOffset = 0 }) {
  const depart = new Date(`${date}T${departTime}:00Z`);
  // A half-typed or oddly formatted time ("7:10") isn't a date yet — say so
  // rather than letting Intl throw on it mid-render.
  if (isNaN(depart) || (arriveTime && isNaN(new Date(`${date}T${arriveTime}:00Z`)))) {
    return { depart, arrive: depart, dayOffset: 0, durationMs: null, invalid: true };
  }
  const fromTz = placeTz(from), toTz = placeTz(to);
  const unknownZone = !fromTz || !toTz;
  const requested = Number.isFinite(arriveDayOffset) ? arriveDayOffset : 0;

  if (!arriveTime) {
    const dur = estimatedLegMs({ mode, from, to });
    const arrive = unknownZone
      ? new Date(depart.getTime() + dur)
      : utcToZonedWallClock(new Date(zonedWallClockToUtc(depart, fromTz).getTime() + dur), toTz);
    return { depart, arrive, dayOffset: daysBetweenYmd(arrive.toISOString().slice(0, 10), date), durationMs: dur, estimated: true, adjusted: false, unknownZone };
  }

  const arriveOn = (n) => new Date(`${addDaysYmd(date, n)}T${arriveTime}:00Z`);
  if (unknownZone) {
    return { depart, arrive: arriveOn(requested), dayOffset: requested, durationMs: null, estimated: false, adjusted: false, unknownZone };
  }
  const realDepart = zonedWallClockToUtc(depart, fromTz).getTime();
  const durationOf = (n) => zonedWallClockToUtc(arriveOn(n), toTz).getTime() - realDepart;
  const maxMs = hours(MAX_LEG_HOURS[mode] ?? MAX_LEG_HOURS.flight);
  const plausible = (n) => durationOf(n) > 0 && durationOf(n) <= maxMs;

  // Only a day that lands before takeoff gets corrected. A later day than
  // expected might be deliberate (someone picked it), so it stands — just
  // flagged as `long` past the ceiling so the form can ask for a second look.
  let dayOffset = requested, adjusted = false, impossible = false;
  if (durationOf(requested) <= 0) {
    const fix = ARRIVE_DAY_OFFSETS.filter(plausible).sort((x, y) => durationOf(x) - durationOf(y))[0];
    if (fix === undefined) impossible = true;
    else { dayOffset = fix; adjusted = true; }
  }
  const durationMs = durationOf(dayOffset);
  return { depart, arrive: arriveOn(dayOffset), dayOffset, durationMs, estimated: false, adjusted, impossible, long: durationMs > maxMs, unknownZone };
}

// "Today" on the viewer's own calendar, as a UTC-midnight Date (the
// Calendar's day rows are keyed that way). Using now's UTC date instead
// highlighted tomorrow for anyone in the Americas every evening.
function viewerToday(now = new Date()) {
  const ymd = now.toLocaleString("en-CA", { timeZone: VIEWER_TZ || "UTC" }).slice(0, 10);
  return new Date(`${ymd}T00:00:00Z`);
}

// How far along a flight is right now, 0..1, for the animated plane on
// RouteMap/RouteRibbon. Computed live from the real depart/arrive instants
// and `now` — there's no stored "progress" field (nothing populates one),
// so callers should always derive it this way rather than reading
// flight.progress directly.
function flightProgress(f, now = new Date()) {
  const dep = flightRealDepart(f).getTime(), arr = flightRealArrive(f).getTime();
  const total = arr - dep;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (now.getTime() - dep) / total));
}

// FlightAware live-tracking link for a given flight. FlightAware's
// per-flight idents are ICAO-based (Air India AI681 is "AIC681" there, not
// the IATA "AI681" printed on the ticket) — see the `icao` field on
// AIRLINES. Returns null rather than a link we know resolves to the wrong
// flight (or nothing) when we don't have a confirmed ICAO code for this
// airline, or there's no flight number to build an ident from. Only
// meaningful for mode: 'flight' — callers should gate on that too.
const flightAwareUrl = (f) => {
  const icao = AIRLINES[f.airline]?.icao;
  if (!icao || !f.number) return null;
  return `https://www.flightaware.com/live/flight/${icao}${f.number}`;
};

// ── connecting flights ──────────────────────────────────────────────────────
// Two legs uploaded separately (two boarding passes) are really one journey
// when they share a traveler, the first leg's destination is the second
// leg's origin, and the gap between them reads as a real layover rather than
// a separate later trip. This is only ever a *presentation* grouping — each
// leg stays its own row with its own real depart/arrive/status (see
// journeyStatus below for why: a single merged time range can't tell "still
// in the air" apart from "sitting in the connecting airport").
const CONNECTION_MIN_GAP = minutes(20);  // shorter than this reads as a data error, not a layover
const CONNECTION_MAX_GAP = hours(8);     // longer than this is a separate trip, not a connection

function isConnectionCandidate(a, b) {
  if (!a || !b || a.id === b.id) return false;
  if (a.mode !== b.mode) return false;
  if (!placesMatch(a.to, b.from)) return false;
  if (!a.travelers.some((id) => b.travelers.includes(id))) return false;
  const gap = b.depart.getTime() - a.arrive.getTime();
  return gap >= CONNECTION_MIN_GAP && gap <= CONNECTION_MAX_GAP;
}

// Find an already-logged, not-yet-linked flight that `flight` plausibly
// connects onward to (or back from) — used to offer a retroactive "link
// these as one trip?" prompt when two legs get uploaded separately rather
// than through the "add a connecting flight" flow at submit time.
function findConnectionCandidate(flight, allFlights) {
  if (flight.journeyId) return null;
  return allFlights.find((other) =>
    !other.journeyId &&
    (isConnectionCandidate(flight, other) || isConnectionCandidate(other, flight))
  ) || null;
}

// Group flights into board-ready items: solo trips stay as-is, legs sharing
// a journeyId collapse into one { kind: "journey" } item, legs sorted by
// departure. A journeyId with only one surviving leg (its partner got
// deleted) just renders as solo — nothing to collapse.
function buildJourneys(flights) {
  const byJourney = new Map();
  const items = [];
  for (const f of flights) {
    if (f.journeyId) {
      if (!byJourney.has(f.journeyId)) byJourney.set(f.journeyId, []);
      byJourney.get(f.journeyId).push(f);
    } else {
      items.push({ kind: "solo", flight: f, id: f.id });
    }
  }
  for (const [journeyId, legs] of byJourney) {
    legs.sort((a, b) => a.depart - b.depart);
    if (legs.length < 2) {
      items.push({ kind: "solo", flight: legs[0], id: legs[0].id });
    } else {
      const first = legs[0], last = legs[legs.length - 1];
      items.push({
        kind: "journey", id: journeyId, legs,
        summary: {
          mode: first.mode,
          from: first.from, to: last.to,
          depart: first.depart, arrive: last.arrive,
          travelers: first.travelers,
          // Shown in the card's boarding-pass strip alongside the overall
          // depart/arrive — the first leg's flight, same as how a nonstop
          // card shows its one flight number.
          airline: first.airline, number: first.number,
          note: first.note,
        },
      });
    }
  }
  return items;
}

// Pair up an outbound flight and its return into one "roundtrip" board item
// — same travelers, exact reversed route, return departing after outbound
// arrives — but only while *neither* has happened yet: once the outbound
// departs there's nothing left to preview together, and the return should
// just stand on its own as a normal upcoming card (see flightStatus's
// scheduled/boarding vs airborne/landed/past). Purely a presentation
// grouping over buildJourneys' output — round-trip legs aren't linked by
// any id in the database the way a connecting journey's legs are; this
// re-derives the pairing every render from what's already logged.
function pairRoundTrips(items, now = new Date()) {
  const solos = items.filter((i) => i.kind === "solo");
  const others = items.filter((i) => i.kind !== "solo");
  const future = (f) => { const s = flightStatus(f, now); return s === "scheduled" || s === "boarding"; };
  const sameTravelers = (a, b) => a.length === b.length && a.every((id) => b.includes(id));

  const used = new Set();
  const paired = [];
  for (let i = 0; i < solos.length; i++) {
    const a = solos[i].flight;
    if (used.has(a.id) || !future(a)) continue;
    for (let j = 0; j < solos.length; j++) {
      if (i === j) continue;
      const b = solos[j].flight;
      if (used.has(b.id) || !future(b)) continue;
      if (b.mode !== a.mode) continue;
      if (!sameTravelers(a.travelers, b.travelers)) continue;
      if (!placesMatch(a.to, b.from) || !placesMatch(a.from, b.to)) continue;
      if (b.depart <= a.arrive) continue; // b must be the later, returning leg
      used.add(a.id); used.add(b.id);
      paired.push({ kind: "roundtrip", id: `rt:${a.id}`, outbound: a, returnLeg: b });
      break;
    }
  }
  const remainingSolo = solos.filter((s) => !used.has(s.flight.id));
  return [...remainingSolo, ...others, ...paired];
}

// Status for a whole journey, derived purely from each real leg's own
// status — never inferred beyond what the legs themselves say. "layover" is
// new here: it only ever appears for a multi-leg journey, when now falls
// between one leg's arrival and the next leg's departure — i.e. they're
// factually on the ground in the connecting city, not "landed" (which would
// imply the trip is over) and not "airborne".
function journeyStatus(legs, now = new Date()) {
  const statuses = legs.map((l) => flightStatus(l, now));
  if (statuses.includes("airborne")) return "airborne";
  for (let i = 0; i < legs.length - 1; i++) {
    if (now >= flightRealArrive(legs[i]) && now < flightRealDepart(legs[i + 1])) return "layover";
  }
  const last = statuses[statuses.length - 1];
  if (last === "landed") return "landed";
  if (last === "past") return "past";
  if (statuses[0] === "boarding") return "boarding";
  return "scheduled";
}

// Status for a board item — solo flight or journey — one call site either way.
function itemStatus(item, now = new Date()) {
  return item.kind === "journey" ? journeyStatus(item.legs, now) : flightStatus(item.flight, now);
}

window.MGData = {
  NOW, FAMILY, AIRPORTS, AIRLINES, FLIGHTS, MODE_META,
  flightStatus, familyById, airline, airport, flightAwareUrl, modeOf, modeMeta, hasLoggedReturn, isHomeArrival, hasCoords,
  viewerTime, VIEWER_TZ, flightRealDepart, flightRealArrive, flightProgress, placeTzId, placeTz,
  resolveLegTimes, utcToZonedWallClock, daysBetweenYmd, addDaysYmd, viewerToday,
  isConnectionCandidate, findConnectionCandidate, buildJourneys, pairRoundTrips, journeyStatus, itemStatus, placesMatch,
  CONNECTION_MIN_GAP, CONNECTION_MAX_GAP,
  minutes, hours, days,
};
