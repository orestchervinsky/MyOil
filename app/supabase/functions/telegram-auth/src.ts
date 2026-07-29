import { createClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, verifyTelegramInitData } from '../_shared/telegram.ts'

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders })
  }

  const { initData } = await req.json().catch(() => ({}))
  if (typeof initData !== 'string') {
    return new Response(JSON.stringify({ error: 'initData required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const verified = await verifyTelegramInitData(initData, BOT_TOKEN)
  if (!verified) {
    return new Response(JSON.stringify({ error: 'invalid initData' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: player, error: playerError } = await supabase
    .from('players')
    .upsert(
      { telegram_id: verified.user.id, username: verified.user.username ?? null },
      { onConflict: 'telegram_id' },
    )
    .select()
    .single()

  if (playerError) {
    return new Response(JSON.stringify({ error: playerError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // First login: grant starting workers + one oil field + one refinery (MVP —
  // no auction/onboarding-tiers yet, see design doc section 5 for the future flow).
  // The update below only succeeds for whichever concurrent request gets there
  // first (WHERE onboarded = false), so two near-simultaneous calls — e.g.
  // React Strict Mode double-invoking the mount effect — can't both onboard.
  const { data: claimedOnboarding } = await supabase
    .from('players')
    .update({ onboarded: true })
    .eq('id', player.id)
    .eq('onboarded', false)
    .select()
    .maybeSingle()

  if (claimedOnboarding) {
    await supabase.from('workers').insert(
      Array.from({ length: 4 }, (_, i) => ({ player_id: player.id, position: i })),
    )

    const reserve = Math.floor(500 + Math.random() * 1500)
    await supabase.from('oil_fields').insert({
      owner_id: player.id,
      reserve_total: reserve,
      reserve_remaining: reserve,
    })

    await supabase.from('refineries').insert({ owner_id: player.id })
  }

  return new Response(JSON.stringify({ player }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
