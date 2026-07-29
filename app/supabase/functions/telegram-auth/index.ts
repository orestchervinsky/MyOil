import { createClient } from 'npm:@supabase/supabase-js@2'

// --- Telegram initData verification ---
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

interface TelegramUser {
  id: number
  username?: string
  first_name?: string
  last_name?: string
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60

async function hmacSha256(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function verifyTelegramInitData(
  initData: string,
  botToken: string,
): Promise<{ user: TelegramUser } | null> {
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return null
  params.delete('hash')

  const authDate = params.get('auth_date')
  if (!authDate) return null
  const ageSeconds = Math.floor(Date.now() / 1000) - Number(authDate)
  if (ageSeconds > MAX_AUTH_AGE_SECONDS || ageSeconds < 0) return null

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')

  const secretKey = await hmacSha256(new TextEncoder().encode('WebAppData'), botToken)
  const computedHash = toHex(await hmacSha256(secretKey, dataCheckString))

  if (computedHash !== hash) return null

  const userRaw = params.get('user')
  if (!userRaw) return null

  return { user: JSON.parse(userRaw) as TelegramUser }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// --- Edge Function entry point ---

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
      Array.from({ length: 4 }, () => ({ player_id: player.id })),
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
