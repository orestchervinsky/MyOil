import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, verifyTelegramInitData } from '../_shared/telegram.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// --- Game constants (mirrors the mock UI prototype) ---

const EXTRACT_MS = 8000
const TRANSPORT_MS = 7000
const REFINE_MS = 6000
const REST_MS = 4000
const OIL_PER_EXTRACT = 20
const OIL_PER_TRANSPORT = 25
const REFINE_OIL_INPUT = 30
const FUEL_CONVERSION_RATE = 0.6

function fuelPrice(fuelBalance: number): number {
  const base = 50
  return Math.max(5, Math.round(base / (1 + fuelBalance * 0.05)))
}

// --- Edge Function entry point ---

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const body = await req.json().catch(() => ({}))
  const { initData, action, workerId } = body as { initData?: string; action?: string; workerId?: string }

  if (typeof initData !== 'string') return json({ error: 'initData required' }, 400)

  const verified = await verifyTelegramInitData(initData, BOT_TOKEN)
  if (!verified) return json({ error: 'invalid initData' }, 401)

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('*')
    .eq('telegram_id', verified.user.id)
    .single()

  if (playerError || !player) return json({ error: 'player not found — call telegram-auth first' }, 404)

  const { data: workers } = await supabase
    .from('workers')
    .select('*')
    .eq('player_id', player.id)
    .order('position')
  const { data: field } = await supabase.from('oil_fields').select('*').eq('owner_id', player.id).single()
  const { data: refinery } = await supabase.from('refineries').select('*').eq('owner_id', player.id).single()
  const { data: transport } = await supabase.from('transports').select('*').eq('owner_id', player.id).single()

  const now = new Date()
  let playerOilDelta = 0
  let fuelDelta = 0
  let fieldStockpileDelta = 0

  // Lazy-check resolution: anything overdue gets resolved before we act on the request.
  for (const w of workers ?? []) {
    if (w.status === 'working' && w.busy_until && new Date(w.busy_until) <= now) {
      const { data: pendingExtraction } = await supabase
        .from('extraction_events')
        .select('*')
        .eq('worker_id', w.id)
        .eq('collected', false)
        .maybeSingle()
      if (pendingExtraction) {
        fieldStockpileDelta += pendingExtraction.amount_oil
        await supabase.from('extraction_events').update({ collected: true }).eq('id', pendingExtraction.id)
      }
      const { data: pendingTransport } = await supabase
        .from('transport_events')
        .select('*')
        .eq('worker_id', w.id)
        .eq('collected', false)
        .maybeSingle()
      if (pendingTransport) {
        playerOilDelta += pendingTransport.amount_oil
        await supabase.from('transport_events').update({ collected: true }).eq('id', pendingTransport.id)
      }
      const { data: pendingRefining } = await supabase
        .from('refining_events')
        .select('*')
        .eq('worker_id', w.id)
        .eq('collected', false)
        .maybeSingle()
      if (pendingRefining) {
        fuelDelta += pendingRefining.fuel_produced
        await supabase.from('refining_events').update({ collected: true }).eq('id', pendingRefining.id)
      }
      // Anchor rest to when the job actually completed, not to whenever this
      // sync happens to run — otherwise a delayed sync makes rest drift later
      // and later (backgrounded tab, slow network, etc).
      const restUntil = new Date(new Date(w.busy_until).getTime() + REST_MS)
      if (restUntil <= now) {
        await supabase.from('workers').update({ status: 'idle', busy_until: null }).eq('id', w.id)
        w.status = 'idle'
        w.busy_until = null
      } else {
        await supabase
          .from('workers')
          .update({ status: 'resting', busy_until: restUntil.toISOString() })
          .eq('id', w.id)
        w.status = 'resting'
        w.busy_until = restUntil.toISOString()
      }
    } else if (w.status === 'resting' && w.busy_until && new Date(w.busy_until) <= now) {
      await supabase.from('workers').update({ status: 'idle', busy_until: null }).eq('id', w.id)
      w.status = 'idle'
      w.busy_until = null
    }
  }

  if (playerOilDelta || fuelDelta) {
    await supabase
      .from('players')
      .update({ oil_balance: player.oil_balance + playerOilDelta, fuel_balance: player.fuel_balance + fuelDelta })
      .eq('id', player.id)
    player.oil_balance += playerOilDelta
    player.fuel_balance += fuelDelta
  }
  if (fieldStockpileDelta && field) {
    await supabase
      .from('oil_fields')
      .update({ stockpile: field.stockpile + fieldStockpileDelta })
      .eq('id', field.id)
    field.stockpile += fieldStockpileDelta
  }

  // Atomically claims a worker: the UPDATE only succeeds if it's still idle
  // at the moment the write happens, closing the same check-then-act race we
  // fixed for onboarding (two near-simultaneous requests can't both grab it).
  async function claimWorker(completesAt: string) {
    if (!workerId) return null
    const { data: claimed } = await supabase
      .from('workers')
      .update({ status: 'working', busy_until: completesAt })
      .eq('id', workerId)
      .eq('player_id', player.id)
      .eq('status', 'idle')
      .select()
      .maybeSingle()
    return claimed
  }

  if (action === 'extract') {
    if (!field || field.reserve_remaining <= 0) return json({ error: 'field depleted' }, 400)

    const amount = Math.min(OIL_PER_EXTRACT * field.pump_level, field.reserve_remaining)
    const completesAt = new Date(now.getTime() + EXTRACT_MS).toISOString()

    const claimedWorker = await claimWorker(completesAt)
    if (!claimedWorker) return json({ error: 'worker not idle' }, 400)

    await supabase
      .from('oil_fields')
      .update({ reserve_remaining: field.reserve_remaining - amount, condition: Math.max(0, field.condition - 2) })
      .eq('id', field.id)
    await supabase.from('extraction_events').insert({
      worker_id: claimedWorker.id,
      field_id: field.id,
      starts_at: now.toISOString(),
      completes_at: completesAt,
      amount_oil: amount,
      collected: false,
    })
  } else if (action === 'transport') {
    if (!field || field.stockpile <= 0) return json({ error: 'nothing to transport' }, 400)
    if (!transport) return json({ error: 'no transport' }, 400)

    const amount = Math.min(OIL_PER_TRANSPORT * transport.level, field.stockpile)
    const completesAt = new Date(now.getTime() + TRANSPORT_MS).toISOString()

    const claimedWorker = await claimWorker(completesAt)
    if (!claimedWorker) return json({ error: 'worker not idle' }, 400)

    await supabase
      .from('oil_fields')
      .update({ stockpile: field.stockpile - amount })
      .eq('id', field.id)
    await supabase
      .from('transports')
      .update({ condition: Math.max(0, transport.condition - 2) })
      .eq('id', transport.id)
    await supabase.from('transport_events').insert({
      worker_id: claimedWorker.id,
      transport_id: transport.id,
      starts_at: now.toISOString(),
      completes_at: completesAt,
      amount_oil: amount,
      collected: false,
    })
  } else if (action === 'refine') {
    if (!refinery) return json({ error: 'no refinery' }, 400)
    const amount = Math.min(REFINE_OIL_INPUT, player.oil_balance)
    if (amount <= 0) return json({ error: 'no oil to refine' }, 400)

    const fuelOut = Math.round(amount * FUEL_CONVERSION_RATE)
    const completesAt = new Date(now.getTime() + REFINE_MS).toISOString()

    const claimedWorker = await claimWorker(completesAt)
    if (!claimedWorker) return json({ error: 'worker not idle' }, 400)

    await supabase.from('players').update({ oil_balance: player.oil_balance - amount }).eq('id', player.id)
    player.oil_balance -= amount
    await supabase
      .from('refineries')
      .update({ condition: Math.max(0, refinery.condition - 2) })
      .eq('id', refinery.id)
    await supabase.from('refining_events').insert({
      worker_id: claimedWorker.id,
      refinery_id: refinery.id,
      starts_at: now.toISOString(),
      completes_at: completesAt,
      oil_consumed: amount,
      fuel_produced: fuelOut,
      collected: false,
    })
  } else if (action === 'sell') {
    if (player.fuel_balance <= 0) return json({ error: 'no fuel to sell' }, 400)
    const price = fuelPrice(player.fuel_balance)
    const proceeds = player.fuel_balance * price
    await supabase
      .from('players')
      .update({ fuel_balance: 0, token_balance: player.token_balance + proceeds })
      .eq('id', player.id)
    player.fuel_balance = 0
    player.token_balance += proceeds
  } else if (action && action !== 'sync') {
    return json({ error: `unknown action: ${action}` }, 400)
  }

  const { data: freshWorkers } = await supabase
    .from('workers')
    .select('*')
    .eq('player_id', player.id)
    .order('position')
  const { data: freshField } = await supabase.from('oil_fields').select('*').eq('owner_id', player.id).single()
  const { data: freshRefinery } = await supabase.from('refineries').select('*').eq('owner_id', player.id).single()
  const { data: freshTransport } = await supabase.from('transports').select('*').eq('owner_id', player.id).single()

  return json({
    player,
    workers: freshWorkers,
    field: freshField,
    refinery: freshRefinery,
    transport: freshTransport,
  })
})
