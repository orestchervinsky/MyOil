-- Server-side "heartbeat": resolves overdue worker timers even when no one
-- has the Mini App open (the game-action Edge Function only resolves on
-- request — this is the safety net described in the design doc, section 7).

create extension if not exists pg_cron with schema extensions;

create or replace function resolve_overdue_workers() returns void
language plpgsql
as $$
declare
  w record;
  ev record;
  rest_ms constant int := 4000; -- REST_MS in game-action/index.ts — keep in sync
  rest_until timestamptz;
begin
  for w in
    select * from workers
    where status in ('working', 'resting') and busy_until <= now()
    for update
  loop
    if w.status = 'working' then
      for ev in
        select * from extraction_events where worker_id = w.id and collected = false
      loop
        update players set oil_balance = oil_balance + ev.amount_oil where id = w.player_id;
        update extraction_events set collected = true where id = ev.id;
      end loop;

      for ev in
        select * from refining_events where worker_id = w.id and collected = false
      loop
        update players set fuel_balance = fuel_balance + ev.fuel_produced where id = w.player_id;
        update refining_events set collected = true where id = ev.id;
      end loop;

      rest_until := w.busy_until + make_interval(secs => rest_ms / 1000.0);
      if rest_until <= now() then
        update workers set status = 'idle', busy_until = null where id = w.id;
      else
        update workers set status = 'resting', busy_until = rest_until where id = w.id;
      end if;
    else
      update workers set status = 'idle', busy_until = null where id = w.id;
    end if;
  end loop;
end;
$$;

select cron.schedule(
  'resolve-overdue-workers',
  '* * * * *',
  $$select resolve_overdue_workers();$$
);
