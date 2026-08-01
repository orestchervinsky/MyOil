-- P2P resource market: players list oil/fuel/parts for sale at a token
-- price; other players buy. Listed amount is escrowed out of the seller's
-- balance immediately (on list) so it can't be double-spent or oversold.

create table if not exists market_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references players(id) on delete cascade,
  resource_type text not null check (resource_type in ('oil', 'fuel', 'parts')),
  amount numeric not null check (amount > 0),
  price_per_unit numeric not null check (price_per_unit > 0),
  status text not null default 'open' check (status in ('open', 'sold', 'cancelled')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table market_listings enable row level security;
create index if not exists market_listings_open_idx on market_listings (status, created_at desc) where status = 'open';
