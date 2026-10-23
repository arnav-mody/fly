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

-- ── Never retain the uploaded boarding pass ──────────────────────────────────
-- source_image_path pointed at a copy of the boarding pass kept in Storage
-- so a failed parse could be retried without re-uploading. A boarding pass
-- can carry a booking reference or other identifying detail, and that's not
-- worth retaining just for a retry convenience — parse-flight no longer
-- writes to Storage at all (the image only ever exists in memory for the
-- one request that reads it), and this column has nothing left to point to.
alter table flights drop column if exists source_image_path;

-- ── Guest travelers ───────────────────────────────────────────────────────────
-- A traveler added just for one trip (someone's friend flying with them once,
-- say) still needs a real family_members row — flight_travelers.family_member_id
-- is a hard foreign key, and a guest needs the exact same avatar/name/lookup
-- machinery a real roster member gets. is_guest is what keeps a guest out of
-- the roster-facing surfaces (Travelers tab, the person filter, the default
-- "who's traveling" picker) while still resolving correctly wherever a
-- specific flight's travelers are shown. Promoting a guest to a full member
-- later is just flipping this flag — no data migration, their whole travel
-- history is already attached to the same row.
alter table family_members add column if not exists is_guest boolean not null default false;

-- ════════════════════════════════════════════════════════════════════════════
-- V2 — accounts, follows, close circle, invites
-- ════════════════════════════════════════════════════════════════════════════
-- Applied to the "Fly - Test" project only until sign-in launches. Running
-- this on the live project ENDS open read access (see "Lock down reads"
-- below) — the live page must be on the signed-in build first, and the
-- family's follows/close circle seeded, or the board goes blank for everyone.
--
-- Identity is a verified email (Supabase Auth, 6-digit login codes), never an
-- invite link — two invites to the same person can't make two accounts. A
-- profile (family_members row) can exist before anyone signs in as it
-- (grandparents, kids, guests); signing in "claims" it by setting user_id.

-- ── Profiles ↔ accounts ──────────────────────────────────────────────────────
alter table family_members add column if not exists user_id uuid unique references auth.users(id) on delete set null;
-- Signing in with this email claims the profile automatically — set when
-- someone is invited by email, or for the first account on a fresh project.
alter table family_members add column if not exists claim_email text;
create unique index if not exists family_members_claim_email_idx
  on family_members (lower(claim_email)) where claim_email is not null;
alter table family_members add column if not exists created_by text references family_members(id) on delete set null;

-- ── Follows ──────────────────────────────────────────────────────────────────
-- follower sees followee's trips (dates and cities) once accepted. Requests
-- from a shared follow link start pending; a personal invite is accepted
-- both ways on the spot, since the inviter chose that person deliberately.
create table if not exists follows (
  follower_id text not null references family_members(id) on delete cascade,
  followee_id text not null references family_members(id) on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on follows (followee_id);

-- ── Close circle ─────────────────────────────────────────────────────────────
-- The owner's choice of who sees full details (airline, flight number,
-- times) and who can add or edit trips on the owner's behalf — the "family
-- group". One-directional, like Instagram's Close Friends.
create table if not exists close_circle (
  owner_id   text not null references family_members(id) on delete cascade,
  member_id  text not null references family_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, member_id),
  check (owner_id <> member_id)
);
create index if not exists close_circle_member_idx on close_circle (member_id);

-- ── Invites ──────────────────────────────────────────────────────────────────
-- personal: single-use, expires, optionally claims a specific not-yet-
-- claimed profile (inviting Grandma to her own profile, history and all).
-- link: a reusable follow link; each use creates a pending request.
create table if not exists invites (
  token      text primary key,
  kind       text not null check (kind in ('personal', 'link')),
  inviter_id text not null references family_members(id) on delete cascade,
  profile_id text references family_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at    timestamptz,
  used_by    uuid
);

alter table follows      enable row level security;
alter table close_circle enable row level security;
alter table invites      enable row level security;
-- No policies on any of the three: they're read through the functions below
-- and written only by Edge Functions (secret key), like flights.

-- ── Lock down reads ──────────────────────────────────────────────────────────
-- Replaces "anyone with the publishable key can read everything." From here
-- the board and the roster are only reachable through get_board() and
-- get_people(), which decide per viewer. Airports/airlines stay public —
-- reference data, nothing personal.
drop policy if exists "public read" on family_members;
drop policy if exists "public read" on flights;
drop policy if exists "public read" on flight_travelers;
drop policy if exists "public read" on flight_status_cache;

-- The signed-in viewer's own profile id, or null.
create or replace function my_profile_id() returns text
language sql stable security definer set search_path = public as $$
  select id from family_members where user_id = auth.uid()
$$;

-- Whether p_viewer may add, edit or delete trips that include p_person:
-- themselves, anyone whose close circle they're in, or a guest.
create or replace function can_manage(p_viewer text, p_person text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_viewer is not null and (
    p_viewer = p_person
    or exists (select 1 from family_members m where m.id = p_person and m.is_guest)
    or exists (select 1 from close_circle c where c.owner_id = p_person and c.member_id = p_viewer)
  )
$$;

-- Every flight the viewer may see. 'full' when the viewer is aboard or in a
-- traveler's close circle; 'limited' when they only follow a traveler — then
-- airline, flight number, clock times and the note are withheld, and
-- depart/arrive carry just the calendar day (still airport-local digits).
create or replace function get_board()
returns table (
  id uuid, mode text, airline_code text, flight_number text,
  from_airport text, to_airport text, depart_at timestamptz, arrive_at timestamptz,
  journey_id uuid, note text, return_dismissed boolean, travelers text[], detail text
)
language sql stable security definer set search_path = public as $$
  with me as (select my_profile_id() as id),
  aboard as (
    select ft.flight_id, array_agg(ft.family_member_id order by ft.family_member_id) as travelers
    from flight_travelers ft group by ft.flight_id
  ),
  access as (
    select a.flight_id, a.travelers,
      bool_or(t = me.id or exists (select 1 from close_circle c where c.owner_id = t and c.member_id = me.id)) as full_detail,
      bool_or(exists (select 1 from follows fo where fo.followee_id = t and fo.follower_id = me.id and fo.status = 'accepted')) as following
    from aboard a cross join me cross join lateral unnest(a.travelers) as t
    where me.id is not null
    group by a.flight_id, a.travelers
  )
  select f.id, f.mode,
    case when x.full_detail then f.airline_code end,
    case when x.full_detail then f.flight_number end,
    f.from_airport, f.to_airport,
    case when x.full_detail then f.depart_at else date_trunc('day', f.depart_at at time zone 'UTC') at time zone 'UTC' end,
    case when x.full_detail then f.arrive_at else date_trunc('day', f.arrive_at at time zone 'UTC') at time zone 'UTC' end,
    f.journey_id,
    case when x.full_detail then f.note end,
    f.return_dismissed, x.travelers,
    case when x.full_detail then 'full' else 'limited' end
  from flights f join access x on x.flight_id = f.id
  where x.full_detail or x.following
$$;

-- Everyone the viewer has a reason to see: themselves, anyone they follow or
-- who follows them (including pending requests, so a request shows a name),
-- either side of a close circle, people they added, and fellow travelers on
-- flights they can see — with how each one relates to the viewer.
create or replace function get_people()
returns table (
  id text, first_name text, last_name text, nickname text, role text,
  home_city text, home_airport text, tone int, is_guest boolean, claimed boolean,
  is_me boolean, i_follow text, follows_me text, in_my_circle boolean, in_their_circle boolean,
  can_manage boolean
)
language sql stable security definer set search_path = public as $$
  with me as (select my_profile_id() as id),
  related as (
    select me.id as pid from me where me.id is not null
    union select fo.followee_id from follows fo, me where fo.follower_id = me.id
    union select fo.follower_id from follows fo, me where fo.followee_id = me.id
    union select c.member_id from close_circle c, me where c.owner_id = me.id
    union select c.owner_id from close_circle c, me where c.member_id = me.id
    union select m.id from family_members m, me where m.created_by = me.id
    union select unnest(b.travelers) from get_board() b
  )
  select m.id, m.first_name, m.last_name, m.nickname, m.role, m.home_city, m.home_airport, m.tone,
    m.is_guest, m.user_id is not null,
    m.id = me.id,
    (select fo.status from follows fo where fo.follower_id = me.id and fo.followee_id = m.id),
    (select fo.status from follows fo where fo.follower_id = m.id and fo.followee_id = me.id),
    exists (select 1 from close_circle c where c.owner_id = me.id and c.member_id = m.id),
    exists (select 1 from close_circle c where c.owner_id = m.id and c.member_id = me.id),
    can_manage(me.id, m.id)
  from family_members m cross join me
  where me.id is not null and m.id in (select pid from related)
$$;

revoke all on function get_board(), get_people(), my_profile_id(), can_manage(text, text) from public, anon;
grant execute on function get_board(), get_people(), my_profile_id() to authenticated;

-- Profile photos (public bucket, looked up by person id — see Avatar).
insert into storage.buckets (id, name, public) values ('family-photos', 'family-photos', true)
on conflict (id) do nothing;

-- Edge Functions (secret key) check permissions through can_manage; revoking
-- it from public above also took it away from the service role.
grant execute on function can_manage(text, text) to service_role;

-- A personal invite can also put the invitee in the inviter's close circle
-- (full flight details) — the usual choice when inviting family.
alter table invites add column if not exists close_circle boolean not null default false;

-- get_people() also says whether the viewer added each person — so someone
-- you added (but chose not to manage) can still be invited to their profile.
-- Changing a function's columns needs a drop first.
drop function if exists get_people();
create or replace function get_people()
returns table (
  id text, first_name text, last_name text, nickname text, role text,
  home_city text, home_airport text, tone int, is_guest boolean, claimed boolean,
  is_me boolean, i_follow text, follows_me text, in_my_circle boolean, in_their_circle boolean,
  can_manage boolean, added_by_me boolean
)
language sql stable security definer set search_path = public as $$
  with me as (select my_profile_id() as id),
  related as (
    select me.id as pid from me where me.id is not null
    union select fo.followee_id from follows fo, me where fo.follower_id = me.id
    union select fo.follower_id from follows fo, me where fo.followee_id = me.id
    union select c.member_id from close_circle c, me where c.owner_id = me.id
    union select c.owner_id from close_circle c, me where c.member_id = me.id
    union select m.id from family_members m, me where m.created_by = me.id
    union select unnest(b.travelers) from get_board() b
  )
  select m.id, m.first_name, m.last_name, m.nickname, m.role, m.home_city, m.home_airport, m.tone,
    m.is_guest, m.user_id is not null,
    m.id = me.id,
    (select fo.status from follows fo where fo.follower_id = me.id and fo.followee_id = m.id),
    (select fo.status from follows fo where fo.follower_id = m.id and fo.followee_id = me.id),
    exists (select 1 from close_circle c where c.owner_id = me.id and c.member_id = m.id),
    exists (select 1 from close_circle c where c.owner_id = m.id and c.member_id = me.id),
    can_manage(me.id, m.id),
    m.created_by is not null and m.created_by = me.id
  from family_members m cross join me
  where me.id is not null and m.id in (select pid from related)
$$;
revoke all on function get_people() from public, anon;
grant execute on function get_people() to authenticated;
