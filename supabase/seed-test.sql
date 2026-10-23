-- supabase/seed-test.sql — made-up people and trips for the "Fly - Test"
-- project only. Never run this on the live project. Safe to re-run.
--
-- Shaped to exercise every visibility rule in schema.sql's V2 section:
--   Arnav (the real you; signing in with arnavmody@gmail.com claims it)
--   Maya, Dev, Leela — family: in each other's close circle, so full detail
--   Leela              — not claimed by any account: the invite-to-profile case
--   Sam                — a friend: follows Arnav and vice versa, no close circle,
--                        so each sees the other's trips as dates + cities only
--   Jordan             — no connection to anyone: their trip must never show

insert into airlines (code, name, color) values ('VS', 'Virgin Atlantic', '#e10a0a')
on conflict (code) do nothing;

insert into family_members (id, first_name, last_name, home_airport, tone, is_guest, claim_email) values
  ('arnav',  'Arnav',  'Mody',   'JFK', 1, false, 'arnavmody@gmail.com'),
  ('maya',   'Maya',   'Patel',  'ORD', 2, false, null),
  ('dev',    'Dev',    'Patel',  'BOM', 4, false, null),
  ('leela',  'Leela',  'Shah',   'BOM', 7, false, null),
  ('sam',    'Sam',    'Rivera', 'SFO', 6, false, null),
  ('jordan', 'Jordan', 'Lee',    'LAX', 9, false, null)
on conflict (id) do nothing;

-- Family: everyone in everyone's close circle.
insert into close_circle (owner_id, member_id)
select a, b from unnest(array['arnav','maya','dev','leela']) a, unnest(array['arnav','maya','dev','leela']) b
where a <> b
on conflict do nothing;

insert into follows (follower_id, followee_id, status)
select a, b, 'accepted' from unnest(array['arnav','maya','dev','leela']) a, unnest(array['arnav','maya','dev','leela']) b
where a <> b
on conflict do nothing;

-- Sam and Arnav follow each other — friends, not family.
insert into follows (follower_id, followee_id, status) values
  ('sam', 'arnav', 'accepted'), ('arnav', 'sam', 'accepted')
on conflict do nothing;

-- Trips. Times are airport-local digits stored "as if UTC" (see data.js).
insert into flights (id, mode, airline_code, flight_number, from_airport, to_airport, depart_at, arrive_at, journey_id, note, source) values
  ('00000000-0000-4000-8000-000000000001', 'flight', 'UA', '1234', 'ORD', 'AUS', '2026-11-06T08:10:00Z', '2026-11-06T11:05:00Z', null, 'Wedding weekend!', 'manual'),
  ('00000000-0000-4000-8000-000000000002', 'flight', 'VS', '10',   'JFK', 'LHR', '2026-11-20T21:10:00Z', '2026-11-21T09:25:00Z', null, null, 'manual'),
  ('00000000-0000-4000-8000-000000000003', 'flight', 'VS', '3',    'LHR', 'JFK', '2026-11-28T13:00:00Z', '2026-11-28T16:10:00Z', null, null, 'manual'),
  ('00000000-0000-4000-8000-000000000004', 'flight', 'EK', '501',  'BOM', 'DXB', '2026-12-02T03:40:00Z', '2026-12-02T05:20:00Z', '00000000-0000-4000-9000-000000000001', 'Visiting the grandkids', 'manual'),
  ('00000000-0000-4000-8000-000000000005', 'flight', 'EK', '225',  'DXB', 'SFO', '2026-12-02T08:50:00Z', '2026-12-02T13:20:00Z', '00000000-0000-4000-9000-000000000001', null, 'manual'),
  ('00000000-0000-4000-8000-000000000006', 'flight', 'AA', '20',   'SFO', 'JFK', '2026-11-19T07:00:00Z', '2026-11-19T15:35:00Z', null, 'Coming to NYC — dinner?', 'manual'),
  ('00000000-0000-4000-8000-000000000007', 'flight', 'UA', '1175', 'LAX', 'SEA', '2026-11-15T09:00:00Z', '2026-11-15T11:50:00Z', null, null, 'manual')
on conflict (id) do nothing;

insert into flight_travelers (flight_id, family_member_id) values
  ('00000000-0000-4000-8000-000000000001', 'maya'),
  ('00000000-0000-4000-8000-000000000002', 'arnav'),
  ('00000000-0000-4000-8000-000000000003', 'arnav'),
  ('00000000-0000-4000-8000-000000000004', 'leela'),
  ('00000000-0000-4000-8000-000000000004', 'dev'),
  ('00000000-0000-4000-8000-000000000005', 'leela'),
  ('00000000-0000-4000-8000-000000000005', 'dev'),
  ('00000000-0000-4000-8000-000000000006', 'sam'),
  ('00000000-0000-4000-8000-000000000007', 'jordan')
on conflict do nothing;
