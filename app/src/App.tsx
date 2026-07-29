import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

interface DbWorker {
  id: string
  status: 'idle' | 'working' | 'resting'
  busy_until: string | null
}

interface DbField {
  reserve_total: number
  reserve_remaining: number
  pump_level: number
  condition: number
}

interface DbRefinery {
  level: number
  condition: number
}

interface DbPlayer {
  id: string
  telegram_id: number
  username: string | null
  token_balance: number
  oil_balance: number
  fuel_balance: number
}

interface GameState {
  player: DbPlayer
  workers: DbWorker[]
  field: DbField
  refinery: DbRefinery
}

type Status = 'not-in-telegram' | 'loading' | 'ready' | 'error'

function fuelPrice(fuelBalance: number): number {
  const base = 50
  return Math.max(5, Math.round(base / (1 + fuelBalance * 0.05)))
}

async function errorDetail(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response; message?: string }).context
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.json()
      if (body?.error) return body.error
    } catch {
      // response body wasn't JSON — fall through to generic message
    }
  }
  return (error as { message?: string })?.message ?? String(error)
}

function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [state, setState] = useState<GameState | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)

  const initDataRef = useRef<string | null>(null)

  const addLog = useCallback((message: string) => {
    setLog((prev) => [message, ...prev].slice(0, 6))
  }, [])

  const callGameAction = useCallback(
    async (action: 'sync' | 'extract' | 'refine' | 'sell', workerId?: string) => {
      if (!initDataRef.current) return
      setBusy(true)
      const { data, error } = await supabase.functions.invoke('game-action', {
        body: { initData: initDataRef.current, action, workerId },
      })
      setBusy(false)
      if (error) {
        addLog(`Помилка: ${await errorDetail(error)}`)
        return
      }
      setState(data)
    },
    [addLog],
  )

  useEffect(() => {
    const tg = window.Telegram?.WebApp
    tg?.ready()
    const initData = tg?.initData
    if (!initData) {
      setStatus('not-in-telegram')
      return
    }
    initDataRef.current = initData

    supabase.functions
      .invoke('telegram-auth', { body: { initData } })
      .then(async ({ error }) => {
        if (error) {
          setStatus('error')
          setError(await errorDetail(error))
          return
        }
        return callGameAction('sync')
      })
      .then(() => setStatus('ready'))
      .catch(async (err) => {
        setStatus('error')
        setError(await errorDetail(err))
      })
  }, [callGameAction])

  // Client-side clock only drives the countdown display; actual resolution
  // (crediting resources, transitioning worker status) happens server-side.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // When any worker's timer looks expired locally, re-sync with the server
  // to pull the resolved state (lazy-check pattern, same as the backend).
  useEffect(() => {
    if (!state) return
    const hasExpired = state.workers.some(
      (w) => w.status !== 'idle' && w.busy_until && new Date(w.busy_until).getTime() <= now,
    )
    if (hasExpired && !busy) {
      callGameAction('sync')
    }
  }, [now, state, busy, callGameAction])

  return (
    <div className="game">
      <header>
        <h1>My Oil</h1>
      </header>

      {status === 'not-in-telegram' && (
        <section className="card">
          <p>Відкрий цей застосунок через Telegram-бота — поза Telegram гра не працює.</p>
        </section>
      )}
      {status === 'loading' && (
        <section className="card">
          <p>Завантаження…</p>
        </section>
      )}
      {status === 'error' && (
        <section className="card">
          <p className="warn">Помилка: {error}</p>
        </section>
      )}

      {status === 'ready' && state && (
        <>
          <section className="balances">
            <div>💰 {state.player.token_balance} токенів</div>
            <div>🛢️ {state.player.oil_balance} нафти</div>
            <div>⛽ {state.player.fuel_balance} палива</div>
          </section>

          <section className="card">
            <h2>Родовище</h2>
            <p>
              Резерв: {state.field.reserve_remaining} / {state.field.reserve_total}
            </p>
            <p>
              Рівень качки: {state.field.pump_level} · Цілісність: {state.field.condition}%
            </p>
            {state.field.reserve_remaining <= 0 && <p className="warn">Виснажене</p>}
          </section>

          <section className="card">
            <h2>НПЗ</h2>
            <p>
              Рівень: {state.refinery.level} · Цілісність: {state.refinery.condition}%
            </p>
            <p>Курс палива зараз: {fuelPrice(state.player.fuel_balance)} токенів/од.</p>
            <button disabled={busy || state.player.fuel_balance <= 0} onClick={() => callGameAction('sell')}>
              Продати все паливо НПС
            </button>
          </section>

          <section className="card">
            <h2>Робочі</h2>
            <div className="workers">
              {state.workers.map((w, i) => {
                const busyUntilMs = w.busy_until ? new Date(w.busy_until).getTime() : null
                const secondsLeft = busyUntilMs ? Math.max(0, Math.ceil((busyUntilMs - now) / 1000)) : 0
                const idle = w.status === 'idle'
                return (
                  <div key={w.id} className={`worker ${w.status}`}>
                    <strong>Робочий {i + 1}</strong>
                    <p>
                      {w.status === 'idle' && 'вільний'}
                      {w.status === 'working' && `працює (${secondsLeft}с)`}
                      {w.status === 'resting' && `відпочиває (${secondsLeft}с)`}
                    </p>
                    <button
                      disabled={busy || !idle || state.field.reserve_remaining <= 0}
                      onClick={() => callGameAction('extract', w.id)}
                    >
                      Видобуток
                    </button>
                    <button
                      disabled={busy || !idle || state.player.oil_balance <= 0}
                      onClick={() => callGameAction('refine', w.id)}
                    >
                      Переробка
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        </>
      )}

      <section className="card log">
        <h2>Журнал</h2>
        <ul>
          {log.map((entry, i) => (
            <li key={i}>{entry}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default App
