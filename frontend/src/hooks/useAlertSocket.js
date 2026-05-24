import { useEffect, useRef, useCallback, useState } from 'react'
import { getWsUrl } from '../services/api'

// How many consecutive failed reconnect attempts before we consider the backend
// to be "waking up" (i.e. Render free tier cold-starting) rather than just
// temporarily unavailable.
const WAKING_THRESHOLD = 3

/**
 * useAlertSocket — connects to /ws/alerts and auto-reconnects on drop.
 *
 * @param {function} onAlert  Called with each parsed alert object.
 * @returns {{ status: string, isWaking: boolean }}
 *   status   — 'connecting' | 'open' | 'closed'
 *   isWaking — true when the backend appears to be cold-starting
 */
export function useAlertSocket(onAlert) {
  const wsRef = useRef(null)
  const retryRef = useRef(null)
  const retries = useRef(0)
  const onAlertRef = useRef(onAlert)

  useEffect(() => {
    onAlertRef.current = onAlert
  }, [onAlert])

  const [status, setStatus] = useState('connecting')
  const [isWaking, setIsWaking] = useState(false)

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState < 2) {
      return
    }

    const url = getWsUrl()
    console.log('[WS] Connecting to:', url)

    setStatus('connecting')
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      console.log('[WS] Connected')
      retries.current = 0
      setStatus('open')
      setIsWaking(false)
    }

    ws.onmessage = (event) => {
      // Messages may be newline-separated (hub flushes batched payloads)
      const lines = event.data.split('\n').filter(Boolean)
      for (const line of lines) {
        try {
          onAlertRef.current(JSON.parse(line))
        } catch (err) {
          console.error('[WS] Parse error:', err)
        }
      }
    }

    ws.onclose = () => {
      console.log('[WS] Closed')
      setStatus('closed')

      retries.current += 1

      // After WAKING_THRESHOLD failures assume the backend is cold-starting
      // and expose that state so the UI can show a friendly message.
      if (retries.current >= WAKING_THRESHOLD) {
        setIsWaking(true)
      }

      // Exponential back-off: 2s → 3s → 4.5s … capped at 30s
      const delay = Math.min(2000 * Math.pow(1.5, retries.current - 1), 30000)
      console.log(`[WS] Retry in ${Math.round(delay / 1000)}s`)
      retryRef.current = setTimeout(connect, delay)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(retryRef.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect])

  return { status, isWaking }
}
