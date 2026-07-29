-- Starter workers were inserted in a single batch, so they all share the
-- exact same created_at (Postgres evaluates now() once per statement, not
-- per row) — ORDER BY created_at was therefore non-deterministic and workers
-- could appear to swap positions between requests. Add an explicit position.

alter table workers add column if not exists position smallint;

-- Backfill: assign a stable order to existing rows (arbitrary but consistent
-- going forward — there's no way to recover "original" order from tied
-- timestamps).
with ranked as (
  select id, row_number() over (partition by player_id order by id) - 1 as rn
  from workers
)
update workers set position = ranked.rn
from ranked
where workers.id = ranked.id;

alter table workers alter column position set not null;
