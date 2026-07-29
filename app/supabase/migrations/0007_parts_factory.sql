-- Parts factory: produces деталі (parts) from tokens + worker time. Simplified
-- for this MVP phase — no "потяг" raw-material NPC event yet (design doc
-- section 2/6), parts are made directly from tokens for now.

alter table players add column if not exists parts_balance numeric not null default 0;

create table if not exists parts_factories (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references players(id) on delete cascade,
  level int not null default 1,
  condition numeric not null default 100 check (condition >= 0 and condition <= 100),
  created_at timestamptz not null default now()
);
alter table parts_factories enable row level security;

create table if not exists parts_production_events (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references workers(id) on delete cascade,
  factory_id uuid not null references parts_factories(id) on delete cascade,
  starts_at timestamptz not null default now(),
  completes_at timestamptz not null,
  tokens_spent numeric not null,
  parts_produced numeric not null,
  collected boolean not null default false
);
alter table parts_production_events enable row level security;
create index if not exists parts_production_events_pending_idx
  on parts_production_events (completes_at) where not collected;

insert into parts_factories (owner_id)
select id from players where onboarded = true
on conflict (owner_id) do nothing;
