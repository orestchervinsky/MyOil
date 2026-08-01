import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { buildingArt } from './buildings'
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
  stockpile: number
}

interface DbRefinery {
  level: number
  condition: number
}

interface DbTransport {
  level: number
  condition: number
}

interface DbPartsFactory {
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
  parts_balance: number
}

interface GameState {
  player: DbPlayer
  workers: DbWorker[]
  field: DbField
  refinery: DbRefinery
  transport: DbTransport
  partsFactory: DbPartsFactory
}

type Status = 'not-in-telegram' | 'loading' | 'ready' | 'error'
type Action = 'sync' | 'extract' | 'transport' | 'refine' | 'produce_parts' | 'sell'
export type BuildingKey = 'field' | 'refinery' | 'transport' | 'warehouse' | 'bank' | 'partsFactory'

const MAP_SIZE = 7
const TILE_PX = 64
const FOCUS_ROW = 3.5
const FOCUS_COL = 3.5

const BUILDING_POSITIONS: Record<BuildingKey, [number, number]> = {
  field: [3, 2],
  refinery: [3, 3],
  transport: [3, 4],
  warehouse: [2, 3],
  bank: [4, 3],
  partsFactory: [4, 4],
}
const BUILDING_LABELS: Record<BuildingKey, string> = {
  field: 'Родовище',
  refinery: 'НПЗ',
  transport: 'Транспорт',
  warehouse: 'Склад',
  bank: 'Банк',
  partsFactory: 'Завод деталей',
}
const BUILDING_AT_POSITION = new Map<string, BuildingKey>(
  (Object.entries(BUILDING_POSITIONS) as [BuildingKey, [number, number]][]).map(([key, [r, c]]) => [
    `${r}-${c}`,
    key,
  ]),
)

function fuelPrice(fuelBalance: number): number {
  const base = 50
  return Math.max(5, Math.round(base / (1 + fuelBalance * 0.05)))
}

function conditionClass(condition: number): string {
  if (condition >= 60) return 'good'
  if (condition >= 30) return 'worn'
  return 'bad'
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

function Mountains() {
  return (
    <svg className="map-backdrop" viewBox="0 0 400 200" preserveAspectRatio="xMidYMax slice">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a1f3a" />
          <stop offset="55%" stopColor="#6b3f3a" />
          <stop offset="100%" stopColor="#c9793f" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="400" height="200" fill="url(#sky)" />
      <polygon points="0,150 60,70 130,150" fill="#3a2f4a" opacity="0.55" />
      <polygon points="90,150 170,50 250,150" fill="#332742" opacity="0.65" />
      <polygon points="210,150 290,80 400,150" fill="#2c2138" opacity="0.75" />
      <circle cx="330" cy="45" r="18" fill="#f2c168" opacity="0.85" />
    </svg>
  )
}

function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [state, setState] = useState<GameState | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingKey | null>(null)

  const initDataRef = useRef<string | null>(null)

  const addLog = useCallback((message: string) => {
    setLog((prev) => [message, ...prev].slice(0, 6))
  }, [])

  const callGameAction = useCallback(
    async (action: Action, workerId?: string) => {
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

  function runOnWorker(action: Action, workerId: string) {
    callGameAction(action, workerId)
    setSelectedBuilding(null)
  }

  function requestMarket(buildingLabel: string) {
    addLog(`Заявку на ринок для "${buildingLabel}" ще не реалізовано — скоро.`)
    setSelectedBuilding(null)
  }

  function onBuildingClick(key: BuildingKey) {
    setSelectedBuilding(key)
  }

  const idleWorkers = state?.workers.filter((w) => w.status === 'idle') ?? []

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
            <div>💰 {state.player.token_balance}</div>
            <div>🛢️ {state.player.oil_balance}</div>
            <div>⛽ {state.player.fuel_balance}</div>
            <div>🔧 {state.player.parts_balance}</div>
          </section>

          <div className="map-viewport">
            <Mountains />
            <div className="map-world">
              <div
                className="map-grid"
                style={{
                  width: MAP_SIZE * TILE_PX,
                  height: MAP_SIZE * TILE_PX,
                  left: `calc(50% - ${FOCUS_COL * TILE_PX}px)`,
                  top: `calc(50% - ${FOCUS_ROW * TILE_PX}px)`,
                  transformOrigin: `${FOCUS_COL * TILE_PX}px ${FOCUS_ROW * TILE_PX}px`,
                }}
              >
                {Array.from({ length: MAP_SIZE }, (_, row) =>
                  Array.from({ length: MAP_SIZE }, (_, col) => {
                    const key = BUILDING_AT_POSITION.get(`${row}-${col}`)
                    const tileStyle = { left: col * TILE_PX, top: row * TILE_PX, width: TILE_PX, height: TILE_PX }

                    if (!key) {
                      const shade = (row * 3 + col * 7) % 3
                      return (
                        <div
                          key={`${row}-${col}`}
                          className={`tile terrain terrain-${shade}`}
                          style={tileStyle}
                        >
                          <div className="tile-block" />
                        </div>
                      )
                    }

                    const cond =
                      key === 'field'
                        ? state.field.condition
                        : key === 'refinery'
                          ? state.refinery.condition
                          : key === 'transport'
                            ? state.transport.condition
                            : key === 'partsFactory'
                              ? state.partsFactory.condition
                              : null

                    return (
                      <button
                        key={`${row}-${col}`}
                        className={`tile building ${cond !== null ? conditionClass(cond) : ''}`}
                        style={tileStyle}
                        onClick={() => onBuildingClick(key)}
                      >
                        <div className="tile-block" />
                        <div className="tile-content">
                          <div className="tile-art">{buildingArt(key)}</div>
                          <span className="tile-label">{BUILDING_LABELS[key]}</span>
                        </div>
                        {key === 'warehouse' && <span className="tile-badge">{state.field.stockpile}</span>}
                        {key === 'field' && state.field.reserve_remaining <= 0 && (
                          <span className="tile-badge warn">0</span>
                        )}
                      </button>
                    )
                  }),
                )}
              </div>
            </div>
          </div>

          <div className="worker-tray">
            {state.workers.map((w, i) => {
              const busyUntilMs = w.busy_until ? new Date(w.busy_until).getTime() : null
              const secondsLeft = busyUntilMs ? Math.max(0, Math.ceil((busyUntilMs - now) / 1000)) : 0
              return (
                <div key={w.id} className={`worker-chip ${w.status}`} title={`Робочий ${i + 1}: ${w.status}`}>
                  <span className="worker-chip-icon">👷</span>
                  {w.status !== 'idle' && <span className="worker-chip-timer">{secondsLeft}с</span>}
                </div>
              )
            })}
          </div>

          {selectedBuilding && (
            <div className="modal-backdrop" onClick={() => setSelectedBuilding(null)}>
              <div className="modal" onClick={(e) => e.stopPropagation()}>
                {selectedBuilding === 'field' && (
                  <>
                    <h2>Родовище</h2>
                    <p>
                      Резерв: {state.field.reserve_remaining} / {state.field.reserve_total} · Цілісність:{' '}
                      {state.field.condition}%
                    </p>
                    <p className="modal-hint">Оберіть робочого для видобутку:</p>
                    <div className="worker-picker">
                      {idleWorkers.length === 0 && <p className="warn">Немає вільних робочих</p>}
                      {idleWorkers.map((w) => (
                        <button
                          key={w.id}
                          disabled={busy || state.field.reserve_remaining <= 0}
                          onClick={() => runOnWorker('extract', w.id)}
                        >
                          Робочий {state.workers.indexOf(w) + 1}
                        </button>
                      ))}
                    </div>
                    <button className="market-btn" onClick={() => requestMarket('Родовище')}>
                      Подати заявку на ринок
                    </button>
                  </>
                )}

                {selectedBuilding === 'refinery' && (
                  <>
                    <h2>НПЗ</h2>
                    <p>Цілісність: {state.refinery.condition}%</p>
                    <p className="modal-hint">Оберіть робочого для переробки:</p>
                    <div className="worker-picker">
                      {idleWorkers.length === 0 && <p className="warn">Немає вільних робочих</p>}
                      {idleWorkers.map((w) => (
                        <button
                          key={w.id}
                          disabled={busy || state.player.oil_balance <= 0}
                          onClick={() => runOnWorker('refine', w.id)}
                        >
                          Робочий {state.workers.indexOf(w) + 1}
                        </button>
                      ))}
                    </div>
                    <button className="market-btn" onClick={() => requestMarket('НПЗ')}>
                      Подати заявку на ринок
                    </button>
                  </>
                )}

                {selectedBuilding === 'transport' && (
                  <>
                    <h2>Транспорт</h2>
                    <p>Цілісність: {state.transport.condition}%</p>
                    <p>На складі чекає: {state.field.stockpile}</p>
                    <p className="modal-hint">Оберіть робочого для перевезення:</p>
                    <div className="worker-picker">
                      {idleWorkers.length === 0 && <p className="warn">Немає вільних робочих</p>}
                      {idleWorkers.map((w) => (
                        <button
                          key={w.id}
                          disabled={busy || state.field.stockpile <= 0}
                          onClick={() => runOnWorker('transport', w.id)}
                        >
                          Робочий {state.workers.indexOf(w) + 1}
                        </button>
                      ))}
                    </div>
                    <button className="market-btn" onClick={() => requestMarket('Транспорт')}>
                      Подати заявку на ринок
                    </button>
                  </>
                )}

                {selectedBuilding === 'partsFactory' && (
                  <>
                    <h2>Завод деталей</h2>
                    <p>Цілісність: {state.partsFactory.condition}%</p>
                    <p>Виробництво: 50 токенів → 5 деталей</p>
                    <p className="modal-hint">Оберіть робочого для виробництва:</p>
                    <div className="worker-picker">
                      {idleWorkers.length === 0 && <p className="warn">Немає вільних робочих</p>}
                      {idleWorkers.map((w) => (
                        <button
                          key={w.id}
                          disabled={busy || state.player.token_balance < 50}
                          onClick={() => runOnWorker('produce_parts', w.id)}
                        >
                          Робочий {state.workers.indexOf(w) + 1}
                        </button>
                      ))}
                    </div>
                    <button className="market-btn" onClick={() => requestMarket('Завод деталей')}>
                      Подати заявку на ринок
                    </button>
                  </>
                )}

                {selectedBuilding === 'warehouse' && (
                  <>
                    <h2>Склад</h2>
                    <p>Накопичена нафта, що чекає на перевезення: {state.field.stockpile}</p>
                  </>
                )}

                {selectedBuilding === 'bank' && (
                  <>
                    <h2>Банк</h2>
                    <p>Курс палива зараз: {fuelPrice(state.player.fuel_balance)} токенів/од.</p>
                    <p>У вас: {state.player.fuel_balance} палива</p>
                    <button
                      disabled={busy || state.player.fuel_balance <= 0}
                      onClick={() => {
                        callGameAction('sell')
                        setSelectedBuilding(null)
                      }}
                    >
                      Продати все паливо
                    </button>
                  </>
                )}

                <button className="modal-close" onClick={() => setSelectedBuilding(null)}>
                  Закрити
                </button>
              </div>
            </div>
          )}
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
