// Verifies Telegram WebApp initData per Telegram's official algorithm:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// This is the single source of truth — telegram-auth and game-action each
// import it from src.ts, and `npm run bundle:functions` inlines it into the
// deployable index.ts (the Supabase dashboard editor doesn't support
// relative imports across files, so each function must ship as one file).

export interface TelegramUser {
  id: number
  username?: string
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

export async function verifyTelegramInitData(
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

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
