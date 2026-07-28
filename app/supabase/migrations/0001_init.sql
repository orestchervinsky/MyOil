-- My Oil — MVP schema (v0, single core loop: extraction -> refining -> sell)
-- Scope: 1 oil field + 1 refinery per player, 4 workers, no P2P/market/rental yet.

create extension if not exists pgcrypto;

create table players (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null unique,
  username text,
  token_balance numeric not null default 0,
  oil_balance numeric not null default 0,
  fuel_balance numeric not null default 0,
  created_at timestamptz not null default now()
);

create table workers (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  status text not null default 'idle' check (status in ('idle', 'working', 'resting')),
  busy_until timestamptz,
  created_at timestamptz not null default now()
);

create table oil_fields (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references players(id) on delete cascade,
  reserve_total numeric not null,
  reserve_remaining numeric not null,
  pump_level int not null default 1,
  condition numeric not null default 100 check (condition >= 0 and condition <= 100),
  created_at timestamptz not null default now()
);

create table refineries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references players(id) on delete cascade,
  level int not null default 1,
  condition numeric not null default 100 check (condition >= 0 and condition <= 100),
  created_at timestamptz not null default now()
);

-- Lazy-check timer engine: rows carry starts_at/completes_at, state is derived
-- at read time by comparing now() to completes_at (see design doc, section 7).
create table extraction_events (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  field_id uuid not null references oil_fields(id) on delete cascade,
  starts_at timestamptz not null default now(),
  completes_at timestamptz not null,
  amount_oil numeric not null,
  collected boolean not null default false
);

create table refining_events (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  refinery_id uuid not null references refineries(id) on delete cascade,
  starts_at timestamptz not null default now(),
  completes_at timestamptz not null,
  oil_consumed numeric not null,
  fuel_produced numeric not null,
  collected boolean not null default false
);

create index extraction_events_pending_idx on extraction_events (completes_at) where not collected;
create index refining_events_pending_idx on refining_events (completes_at) where not collected;
create index workers_busy_idx on workers (busy_until) where status <> 'idle';

alter table players enable row level security;
alter table workers enable row level security;
alter table oil_fields enable row level security;
alter table refineries enable row level security;
alter table extraction_events enable row level security;
alter table refining_events enable row level security;

-- No client-facing policies yet: RLS is enabled with zero policies, so anon/
-- authenticated roles have no access at all. All game actions go through
-- Edge Functions using the service_role key (bypasses RLS) until the Telegram
-- initData auth bridge is wired up — then per-player SELECT policies get added.
