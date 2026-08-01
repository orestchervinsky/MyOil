import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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

type ResourceType = 'oil' | 'fuel' | 'parts'

interface MarketListing {
  id: string
  seller_id: string
  resource_type: ResourceType
  amount: number
  price_per_unit: number
  created_at: string
  players: { username: string | null } | null
}

interface GameState {
  player: DbPlayer
  workers: DbWorker[]
  field: DbField
  refinery: DbRefinery
  transport: DbTransport
  partsFactory: DbPartsFactory
  marketListings: MarketListing[]
}

type Status = 'not-in-telegram' | 'loading' | 'ready' | 'error'
type Action = 'sync' | 'extract' | 'transport' | 'refine' | 'produce_parts' | 'sell' | 'market_list' | 'market_cancel' | 'market_buy'
export type BuildingKey = 'field' | 'refinery' | 'transport' | 'warehouse' | 'bank' | 'partsFactory'

const RESOURCE_LABELS: Record<ResourceType, string> = { oil: 'нафта', fuel: 'паливо', parts: 'деталі' }
const RESOURCE_ICONS: Record<ResourceType, string> = { oil: '🛢️', fuel: '⛽', parts: '🔧' }

const MAP_SIZE = 20
const TILE_PX = 64
const FOCUS_ROW = 9.5
const FOCUS_COL = 9.5

const BUILDING_POSITIONS: Record<BuildingKey, [number, number]> = {
  field: [9, 8],
  refinery: [9, 9],
  transport: [9, 10],
  warehouse: [8, 9],
  bank: [10, 9],
  partsFactory: [10, 10],
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

function resourceBalance(player: DbPlayer, type: ResourceType): number {
  if (type === 'oil') return player.oil_balance
  if (type === 'fuel') return player.fuel_balance
  return player.parts_balance
}

function MarketPanel({
  state,
  busy,
  onClose,
  onList,
  onCancel,
  onBuy,
}: {
  state: GameState
  busy: boolean
  onClose: () => void
  onList: (resourceType: ResourceType, amount: number, pricePerUnit: number) => void
  onCancel: (listingId: string) => void
  onBuy: (listingId: string) => void
}) {
  const [resourceType, setResourceType] = useState<ResourceType>('fuel')
  const [amount, setAmount] = useState('')
  const [price, setPrice] = useState('')

  const maxAmount = resourceBalance(state.player, resourceType)
  const amountNum = Number(amount)
  const priceNum = Number(price)
  const canList = amountNum > 0 && amountNum <= maxAmount && priceNum > 0

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>🏪 Ринок</h2>

        <p className="modal-hint">Виставити на продаж:</p>
        <div className="market-form">
          <select value={resourceType} onChange={(e) => setResourceType(e.target.value as ResourceType)}>
            <option value="oil">🛢️ нафта</option>
            <option value="fuel">⛽ паливо</option>
            <option value="parts">🔧 деталі</option>
          </select>
          <input
            type="number"
            placeholder="кількість"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            min={1}
            max={maxAmount}
          />
          <input
            type="number"
            placeholder="ціна/од."
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min={1}
          />
        </div>
        <p className="modal-hint">У вас: {maxAmount}</p>
        <button
          disabled={busy || !canList}
          onClick={() => {
            onList(resourceType, amountNum, priceNum)
            setAmount('')
            setPrice('')
          }}
        >
          Виставити
        </button>

        <p className="modal-hint" style={{ marginTop: 16 }}>
          Відкриті лоти:
        </p>
        <div className="market-listings">
          {state.marketListings.length === 0 && <p className="warn">Порожньо</p>}
          {state.marketListings.map((l) => {
            const isMine = l.seller_id === state.player.id
            return (
              <div key={l.id} className="market-listing">
                <span>
                  {RESOURCE_ICONS[l.resource_type]} {l.amount} {RESOURCE_LABELS[l.resource_type]} по{' '}
                  {l.price_per_unit}/од. ({l.amount * l.price_per_unit} токенів) —{' '}
                  {isMine ? 'ви' : l.players?.username ?? 'гравець'}
                </span>
                {isMine ? (
                  <button disabled={busy} onClick={() => onCancel(l.id)}>
                    Скасувати
                  </button>
                ) : (
                  <button
                    disabled={busy || state.player.token_balance < l.amount * l.price_per_unit}
                    onClick={() => onBuy(l.id)}
                  >
                    Купити
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <button className="modal-close" onClick={onClose}>
          Закрити
        </button>
      </div>
    </div>
  )
}

function App() {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [state, setState] = useState<GameState | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingKey | null>(null)
  const [marketOpen, setMarketOpen] = useState(false)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const initDataRef = useRef<string | null>(null)
  const dragStartRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const addLog = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3000)
  }, [])

  const callGameAction = useCallback(
    async (action: Action, extra?: Record<string, unknown>) => {
      if (!initDataRef.current) return
      setBusy(true)
      const { data, error } = await supabase.functions.invoke('game-action', {
        body: { initData: initDataRef.current, action, ...extra },
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
    tg?.expand()
    tg?.disableVerticalSwipes?.()
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
    callGameAction(action, { workerId })
    setSelectedBuilding(null)
  }

  function requestMarket(buildingLabel: string) {
    addLog(`Ринок праці для "${buildingLabel}" ще не реалізовано. Ринок ресурсів уже є — кнопка "🏪 Ринок" внизу.`)
    setSelectedBuilding(null)
  }

  function onMapPointerDown(e: ReactPointerEvent) {
    // Let taps on a building button behave like a normal button — skip
    // drag-tracking entirely so there's no interference with its click
    // (this only showed up on real touch devices, not synthetic tests).
    if ((e.target as HTMLElement).closest('.tile.building')) return
    dragStartRef.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y }
  }

  function onMapPointerMove(e: ReactPointerEvent) {
    const start = dragStartRef.current
    if (!start) return
    setPan({ x: start.panX + (e.clientX - start.x), y: start.panY + (e.clientY - start.y) })
  }

  function onMapPointerUp() {
    dragStartRef.current = null
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

          <div
            className="map-viewport"
            onPointerDown={onMapPointerDown}
            onPointerMove={onMapPointerMove}
            onPointerUp={onMapPointerUp}
            onPointerLeave={onMapPointerUp}
          >
            <Mountains />
            <div className="map-world" style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
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
            <button className="worker-chip market-chip" title="Ринок" onClick={() => setMarketOpen(true)}>
              <span className="worker-chip-icon">🏪</span>
            </button>
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

          {marketOpen && (
            <MarketPanel
              state={state}
              busy={busy}
              onClose={() => setMarketOpen(false)}
              onList={(resourceType, amount, pricePerUnit) =>
                callGameAction('market_list', { resourceType, amount, pricePerUnit })
              }
              onCancel={(listingId) => callGameAction('market_cancel', { listingId })}
              onBuy={(listingId) => callGameAction('market_buy', { listingId })}
            />
          )}
        </>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

export default App
