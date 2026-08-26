-- Mody-Gandhi Travel Tracker — initial schema
-- Run this once in the Supabase Dashboard → SQL Editor (paste + Run).
-- Safe to re-run: every statement is idempotent.

-- ── Reference data ──────────────────────────────────────────────────────────
create table if not exists airlines (
  code  text primary key,        -- IATA airline code, e.g. 'UA'
  name  text not null,
  color text not null            -- hex, used for card accents
);

create table if not exists airports (
  code    text primary key,      -- IATA airport code, e.g. 'SFO'
  city    text not null,
  country text not null,
  name    text not null,
  lat     double precision,
  lon     double precision,
  tz      text                   -- display label only (e.g. 'PDT'), not authoritative
);

-- ── Family roster ────────────────────────────────────────────────────────────
create table if not exists family_members (
  id           text primary key,   -- short slug, e.g. 'bharat'
  first_name   text not null,
  last_name    text not null,
  nickname     text,
  role         text,
  home_city    text,
  home_airport text references airports(code),
  tone         int not null default 1,   -- monogram color index (1..10)
  created_at   timestamptz not null default now()
);

-- ── Flights ───────────────────────────────────────────────────────────────────
create table if not exists flights (
  id               uuid primary key default gen_random_uuid(),
  airline_code     text references airlines(code),
  flight_number    text not null,
  from_airport     text references airports(code),
  to_airport       text references airports(code),
  depart_at        timestamptz not null,
  arrive_at        timestamptz not null,
  note             text,
  source           text not null default 'manual',  -- 'manual' | 'upload' | 'paste'
  source_image_path text,          -- Storage path in the boarding-passes bucket, if applicable
  created_at       timestamptz not null default now()
);

-- Many-to-many: a flight can have multiple travelers (e.g. Priya & Raj together).
create table if not exists flight_travelers (
  flight_id        uuid references flights(id) on delete cascade,
  family_member_id text references family_members(id),
  primary key (flight_id, family_member_id)
);

-- ── Live-status cache ─────────────────────────────────────────────────────────
-- Populated by a scheduled backend job that polls FlightAware for near-term
-- flights only. The frontend reads this table, never the flight-status API
-- directly — that's what keeps us inside the free/cheap tier regardless of
-- how many family members have the page open at once.
create table if not exists flight_status_cache (
  flight_id  uuid primary key references flights(id) on delete cascade,
  status     jsonb not null,       -- shaped for the UI: { status, progress, gate, etc. }
  fetched_at timestamptz not null default now()
);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Reads are open to anyone holding the publishable key (no family login exists
-- yet — see chat for the tradeoff). Writes have NO policy for that role at all,
-- so every insert/update must go through the backend Edge Function using the
-- secret key, which bypasses RLS. That's the choke point where we validate
-- and sanitize whatever the AI parsed before it ever reaches this table.
alter table airlines            enable row level security;
alter table airports            enable row level security;
alter table family_members      enable row level security;
alter table flights             enable row level security;
alter table flight_travelers    enable row level security;
alter table flight_status_cache enable row level security;

do $$ begin
  create policy "public read" on airlines            for select using (true);
  create policy "public read" on airports            for select using (true);
  create policy "public read" on family_members      for select using (true);
  create policy "public read" on flights             for select using (true);
  create policy "public read" on flight_travelers    for select using (true);
  create policy "public read" on flight_status_cache for select using (true);
exception when duplicate_object then null; -- safe to re-run
end $$;

-- ── Seed: reference data + family roster (mirrors data.js) ──────────────────
insert into airports (code, city, country, name, lat, lon, tz) values
  ('JFK','New York','USA','John F. Kennedy Intl',40.64,-73.78,'EDT'),
  ('EWR','Newark','USA','Newark Liberty',40.69,-74.17,'EDT'),
  ('SFO','San Francisco','USA','San Francisco Intl',37.62,-122.38,'PDT'),
  ('LAX','Los Angeles','USA','Los Angeles Intl',33.94,-118.41,'PDT'),
  ('SEA','Seattle','USA','Seattle-Tacoma Intl',47.45,-122.31,'PDT'),
  ('PHX','Phoenix','USA','Sky Harbor',33.43,-112.01,'MST'),
  ('ATL','Atlanta','USA','Hartsfield-Jackson',33.64,-84.43,'EDT'),
  ('AUS','Austin','USA','Austin-Bergstrom',30.20,-97.67,'CDT'),
  ('ORD','Chicago','USA','O''Hare Intl',41.98,-87.91,'CDT'),
  ('LHR','London','UK','Heathrow',51.47,-0.45,'BST'),
  ('CDG','Paris','France','Charles de Gaulle',49.01,2.55,'CEST'),
  ('DEL','Delhi','India','Indira Gandhi Intl',28.55,77.10,'IST'),
  ('BLR','Bangalore','India','Kempegowda Intl',13.20,77.71,'IST'),
  ('BOM','Mumbai','India','Chhatrapati Shivaji',19.09,72.87,'IST'),
  ('DXB','Dubai','UAE','Dubai Intl',25.25,55.36,'GST'),
  ('NRT','Tokyo','Japan','Narita Intl',35.77,140.39,'JST')
on conflict (code) do nothing;

insert into airlines (code, name, color) values
  ('AI','Air India','#c8102e'),
  ('UA','United','#005daa'),
  ('AS','Alaska Airlines','#003561'),
  ('DL','Delta','#9b1c2e'),
  ('BA','British Airways','#075aaa'),
  ('WN','Southwest','#f9b612'),
  ('AA','American','#0078d2'),
  ('EK','Emirates','#d71a21'),
  ('AF','Air France','#002157')
on conflict (code) do nothing;

-- Nickname/role/home_city/home_airport are left unset (nullable) — none of
-- that is known yet for the real roster. Update these rows by hand (or via
-- a follow-up UPDATE) once real home cities/airports are known; the
-- Calendar view's "away from home" detection depends on home_airport.
insert into family_members (id, first_name, last_name, tone) values
  ('arnav','Arnav','Mody',1),
  ('esha','Esha','Mody',2),
  ('roopal','Roopal','Mody',3),
  ('nihar','Nihar','Mody',4),
  ('ashok','Ashok','Mody',5),
  ('rohan','Rohan','Gandhi',6),
  ('avani','Avani','Gandhi',7),
  ('sanjay','Sanjay','Gandhi',8),
  ('charu','Charu','Gandhi',9),
  ('navin','Navin','Gandhi',10),
  ('ramila','Ramila','Gandhi',11)
on conflict (id) do nothing;

-- Note: FLIGHTS is intentionally NOT seeded — those were fictional demo data
-- pinned to a fake "NOW" for the prototype. Real flights start empty and get
-- added by the family from here on.

-- ── Loosen reference-table constraints ───────────────────────────────────────
-- Letting people free-type an airline/airport we don't already have means
-- save-flight needs somewhere to land it: it upserts a bare-bones stub row
-- (code only, nothing else) the first time a new code is used. These
-- descriptive columns can no longer be NOT NULL as a result — they just stay
-- blank until someone fills them in by hand later.
alter table airlines alter column name  drop not null;
alter table airlines alter column color drop not null;
alter table airports alter column city    drop not null;
alter table airports alter column country drop not null;
alter table airports alter column name    drop not null;

-- ── Journey modes (flight / train / car) ─────────────────────────────────────
-- Train and car journeys aren't flights: no airline, no flight number, no
-- IATA code. They reuse from_airport/to_airport as a general "place"
-- reference — free-text city name instead of a code — via the same stub-row
-- mechanism above, and simply leave the flight-only columns null.
alter table flights add column if not exists mode text not null default 'flight';
do $$ begin
  alter table flights add constraint flights_mode_check check (mode in ('flight','train','car'));
exception when duplicate_object then null; -- safe to re-run
end $$;
alter table flights alter column flight_number drop not null;

-- ── Connecting flights ────────────────────────────────────────────────────────
-- Two (or more) legs that are really one journey (e.g. SFO→JFK, then JFK→LHR
-- a couple hours later) share a journey_id so the frontend can present them
-- as one card instead of two independent trips. Each leg stays its own real
-- row with its own accurate depart/arrive/status — this is purely a grouping
-- key, not a merge of the underlying data (merging would make "currently on
-- the ground during the layover" indistinguishable from "airborne").
alter table flights add column if not exists journey_id uuid;
create index if not exists flights_journey_id_idx on flights (journey_id) where journey_id is not null;

-- ── Drop unused columns ───────────────────────────────────────────────────────
-- aircraft/seat/gate/terminal/confirmation/submitted_by were collected by the
-- AI parser and/or defined in this schema early on, but nothing ever actually
-- wrote or displayed them (save-flight never persisted them; cruisingAlt/speed
-- shown alongside "aircraft" in the UI weren't even real columns — leftovers
-- from the original fictional prototype data). Dropping rather than leaving
-- them as always-null cruft.
alter table flights drop column if exists aircraft;
alter table flights drop column if exists seat;
alter table flights drop column if exists gate;
alter table flights drop column if exists terminal;
alter table flights drop column if exists confirmation;
alter table flights drop column if exists submitted_by;

-- ── "Return not logged" dismissal ────────────────────────────────────────────
-- The nudge is usually right, but not always (a family member landing
-- somewhere with no return planned on purpose, or a home-city match the app
-- doesn't know about yet) — this lets anyone dismiss it for a specific
-- flight rather than just living with a wrong prompt forever. A real,
-- shared decision recorded once, not an inferred guess or a per-device
-- localStorage flag only one person would see.
alter table flights add column if not exists return_dismissed boolean not null default false;
