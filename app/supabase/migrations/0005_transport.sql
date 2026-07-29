-- Adds the transport business: extracted oil now piles up at the field
-- (stockpile) instead of teleporting straight into the player's balance —
-- a worker has to physically move it via a transport vehicle, matching the
-- design doc's видобуток -> транспортування -> переробка chain.

alter table oil_fields add column if not exists stockpile numeric not null default 0;

create table if not exists transports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references players(id) on delete cascade,
  level int not null default 1,
  condition numeric not null default 100 check (condition >= 0 and condition <= 100),
  created_at timestamptz not null default now()
);
alter table transports enable row level security;

create table if not exists transport_events (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  transport_id uuid not null references transports(id) on delete cascade,
  starts_at timestamptz not null default now(),
  completes_at timestamptz not null,
  amount_oil numeric not null,
  collected boolean not null default false
);
alter table transport_events enable row level security;
create index if not exists transport_events_pending_idx on transport_events (completes_at) where not collected;

-- Backfill: give already-onboarded players (who registered before this
-- migration) a transport too, so they aren't stuck without one.
insert into transports (owner_id)
select id from players where onboarded = true
on conflict (owner_id) do nothing;
