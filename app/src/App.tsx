import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'

type WorkerStatus = 'idle' | 'working' | 'resting'

interface PendingJob {
  type: 'extract' | 'refine'
  oilDelta: number
  fuelDelta: number
}

interface Worker {
  id: number
  status: WorkerStatus
  busyUntil: number | null
  label: string
  job: PendingJob | null
}

interface Field {
  reserveTotal: number
  reserveRemaining: number
  pumpLevel: number
  condition: number
}

interface Refinery {
  level: number
  condition: number
}

const EXTRACT_MS = 8000
const REFINE_MS = 6000
const REST_MS = 4000
const OIL_PER_EXTRACT = 20
const FUEL_CONVERSION_RATE = 0.6

function fuelPrice(fuelBalance: number): number {
  // internal bonding-style curve: less fuel in your reserve -> higher price
  const base = 50
  return Math.max(5, Math.round(base / (1 + fuelBalance * 0.05)))
}

function makeWorkers(): Worker[] {
  return Array.from({ length: 4 }, (_, i) => ({
    id: i,
    status: 'idle',
    busyUntil: null,
    label: `Робочий ${i + 1}`,
    job: null,
  }))
}

function App() {
  const [supabaseStatus, setSupabaseStatus] = useState<'checking' | 'ok' | 'error'>('checking')

  const [workers, setWorkers] = useState<Worker[]>(makeWorkers)
  const [field, setField] = useState<Field>({
    reserveTotal: 1200,
    reserveRemaining: 1200,
    pumpLevel: 1,
    condition: 100,
  })
  const [refinery, setRefinery] = useState<Refinery>({ level: 1, condition: 100 })
  const [tokenBalance, setTokenBalance] = useState(0)
  const [oilBalance, setOilBalance] = useState(0)
  const [fuelBalance, setFuelBalance] = useState(0)
  const [now, setNow] = useState(Date.now())
  const [log, setLog] = useState<string[]>([])

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ error }) => setSupabaseStatus(error ? 'error' : 'ok'))
      .catch(() => setSupabaseStatus('error'))
  }, [])

  // Lazy-check timer tick: resolve any worker whose busyUntil has passed —
  // same starts_at/completes_at pattern the real backend will use (design doc, section 7).
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const justFinishedWork = workers.filter(
      (w) => w.status === 'working' && w.busyUntil !== null && now >= w.busyUntil,
    )
    for (const w of justFinishedWork) {
      if (!w.job) continue
      if (w.job.oilDelta) setOilBalance((v) => v + w.job!.oilDelta)
      if (w.job.fuelDelta) setFuelBalance((v) => v + w.job!.fuelDelta)
      addLog(
        w.job.type === 'extract'
          ? `Видобуток завершено: +${w.job.oilDelta} нафти (${w.label}).`
          : `Переробка завершена: +${w.job.fuelDelta} палива (${w.label}).`,
      )
    }

    if (justFinishedWork.length === 0 && !workers.some((w) => w.status === 'resting' && w.busyUntil !== null && now >= w.busyUntil)) {
      return
    }

    setWorkers((prev) =>
      prev.map((w) => {
        if (w.status === 'working' && w.busyUntil !== null && now >= w.busyUntil) {
          return { ...w, status: 'resting', busyUntil: now + REST_MS, job: null }
        }
        if (w.status === 'resting' && w.busyUntil !== null && now >= w.busyUntil) {
          return { ...w, status: 'idle', busyUntil: null, job: null }
        }
        return w
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, workers])

  function addLog(message: string) {
    setLog((prev) => [message, ...prev].slice(0, 6))
  }

  function extract(workerId: number) {
    if (field.reserveRemaining <= 0) {
      addLog('Родовище виснажене — видобуток неможливий.')
      return
    }
    const amount = Math.min(OIL_PER_EXTRACT * field.pumpLevel, field.reserveRemaining)
    setField((f) => ({ ...f, reserveRemaining: f.reserveRemaining - amount, condition: Math.max(0, f.condition - 2) }))
    setWorkers((prev) =>
      prev.map((w) =>
        w.id === workerId
          ? { ...w, status: 'working', busyUntil: Date.now() + EXTRACT_MS, job: { type: 'extract', oilDelta: amount, fuelDelta: 0 } }
          : w,
      ),
    )
    addLog(`Робочий вирушив на видобуток (+${amount} нафти після завершення).`)
  }

  function refine(workerId: number) {
    const amount = Math.min(30, oilBalance)
    if (amount <= 0) {
      addLog('Немає нафти для переробки.')
      return
    }
    const fuelOut = Math.round(amount * FUEL_CONVERSION_RATE)
    setOilBalance((v) => v - amount)
    setRefinery((r) => ({ ...r, condition: Math.max(0, r.condition - 2) }))
    setWorkers((prev) =>
      prev.map((w) =>
        w.id === workerId
          ? { ...w, status: 'working', busyUntil: Date.now() + REFINE_MS, job: { type: 'refine', oilDelta: 0, fuelDelta: fuelOut } }
          : w,
      ),
    )
    addLog(`Переробка запущена: ${amount} нафти → ${fuelOut} палива (після завершення).`)
  }

  function sellFuel() {
    if (fuelBalance <= 0) return
    const price = fuelPrice(fuelBalance)
    const amount = fuelBalance
    setTokenBalance((v) => v + amount * price)
    setFuelBalance(0)
    addLog(`Продано ${amount} палива по ${price} за одиницю → +${amount * price} токенів.`)
  }

  return (
    <div className="game">
      <header>
        <h1>My Oil — прототип</h1>
        <span className={`supabase-badge ${supabaseStatus}`}>
          Supabase: {supabaseStatus === 'checking' ? '…' : supabaseStatus === 'ok' ? 'ok' : 'error'}
        </span>
      </header>

      <section className="balances">
        <div>💰 {tokenBalance} токенів</div>
        <div>🛢️ {oilBalance} нафти</div>
        <div>⛽ {fuelBalance} палива</div>
      </section>

      <section className="card">
        <h2>Родовище</h2>
        <p>Резерв: {field.reserveRemaining} / {field.reserveTotal}</p>
        <p>Рівень качки: {field.pumpLevel} · Цілісність: {field.condition}%</p>
        {field.reserveRemaining <= 0 && <p className="warn">Виснажене</p>}
      </section>

      <section className="card">
        <h2>НПЗ</h2>
        <p>Рівень: {refinery.level} · Цілісність: {refinery.condition}%</p>
        <p>Курс палива зараз: {fuelPrice(fuelBalance)} токенів/од.</p>
        <button disabled={fuelBalance <= 0} onClick={sellFuel}>
          Продати все паливо НПС
        </button>
      </section>

      <section className="card">
        <h2>Робочі</h2>
        <div className="workers">
          {workers.map((w) => {
            const secondsLeft = w.busyUntil ? Math.max(0, Math.ceil((w.busyUntil - now) / 1000)) : 0
            return (
              <div key={w.id} className={`worker ${w.status}`}>
                <strong>{w.label}</strong>
                <p>
                  {w.status === 'idle' && 'вільний'}
                  {w.status === 'working' && `працює (${secondsLeft}с)`}
                  {w.status === 'resting' && `відпочиває (${secondsLeft}с)`}
                </p>
                <button disabled={w.status !== 'idle'} onClick={() => extract(w.id)}>
                  Видобуток
                </button>
                <button disabled={w.status !== 'idle'} onClick={() => refine(w.id)}>
                  Переробка
                </button>
              </div>
            )
          })}
        </div>
      </section>

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
