-- Fixes a race condition where two near-simultaneous telegram-auth calls
-- (e.g. React Strict Mode double-invoking the mount effect) both saw
-- "no workers yet" and both granted starting workers/field/refinery.

alter table players add column if not exists onboarded boolean not null default false;

-- Existing players that already have a field are clearly onboarded already —
-- mark them so telegram-auth doesn't try to onboard them again.
update players set onboarded = true
where id in (select owner_id from oil_fields);

-- Clean up duplicate workers created by the race: keep only the 4 earliest
-- per player.
delete from workers w
using (
  select id, row_number() over (partition by player_id order by created_at) as rn
  from workers
) ranked
where w.id = ranked.id and ranked.rn > 4;
