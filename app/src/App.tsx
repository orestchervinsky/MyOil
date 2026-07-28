import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [detail, setDetail] = useState('')

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ error }) => {
        if (error) {
          setStatus('error')
          setDetail(error.message)
        } else {
          setStatus('ok')
        }
      })
      .catch((err) => {
        setStatus('error')
        setDetail(String(err))
      })
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>My Oil — dev skeleton</h1>
      <p>
        Supabase connection:{' '}
        {status === 'checking' && 'перевіряю…'}
        {status === 'ok' && '✅ підключено'}
        {status === 'error' && `❌ помилка: ${detail}`}
      </p>
    </div>
  )
}

export default App
