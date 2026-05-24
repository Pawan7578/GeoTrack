import { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastContext = createContext(null)

let idCounter = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t))
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 280)
  }, [])

  const addToast = useCallback((toast) => {
    const id = ++idCounter
    setToasts((prev) => [{ ...toast, id, exiting: false }, ...prev].slice(0, 6))
    if (toast.duration !== Infinity) {
      setTimeout(() => dismiss(id), toast.duration ?? 5000)
    }
    return id
  }, [dismiss])

  const success = useCallback((msg, opts) => addToast({ type: 'success', message: msg, ...opts }), [addToast])
  const error   = useCallback((msg, opts) => addToast({ type: 'error',   message: msg, ...opts }), [addToast])
  const info    = useCallback((msg, opts) => addToast({ type: 'info',    message: msg, ...opts }), [addToast])
  const alert   = useCallback((msg, opts) => addToast({ type: 'alert',   message: msg, duration: 6000, ...opts }), [addToast])

  return (
    <ToastContext.Provider value={{ toasts, success, error, info, alert, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

// ── Toast UI ──────────────────────────────────────────────────────────────
const icons = {
  success: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#10b981" strokeWidth="1.5"/>
      <path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#f43f5e" strokeWidth="1.5"/>
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#f43f5e" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  info: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" stroke="#0ea5e9" strokeWidth="1.5"/>
      <path d="M8 7v4M8 5.5v.5" stroke="#0ea5e9" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  alert: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 2L14 13H2L8 2z" stroke="#f59e0b" strokeWidth="1.5" strokeLinejoin="round"/>
      <path d="M8 6v3M8 11v.5" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
}

const borderColors = {
  success: 'rgba(16,185,129,0.35)',
  error:   'rgba(244,63,94,0.35)',
  info:    'rgba(14,165,233,0.35)',
  alert:   'rgba(245,158,11,0.45)',
}

function ToastContainer({ toasts, dismiss }) {
  return (
    <div style={{
      position: 'fixed', top: 20, right: 20, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 8, minWidth: 320, maxWidth: 400,
    }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className={t.exiting ? 'toast-exit' : 'toast-enter'}
          style={{
            background: 'rgba(13,18,32,0.96)',
            border: `1px solid ${borderColors[t.type]}`,
            borderRadius: 10,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            backdropFilter: 'blur(12px)',
            boxShadow: `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${borderColors[t.type]}`,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 2 }}>{icons[t.type]}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {t.title && (
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2, color: '#e8eaf2' }}>
                {t.title}
              </div>
            )}
            <div style={{ fontSize: 13, color: '#8892a4', lineHeight: 1.4 }}>{t.message}</div>
            {t.sub && (
              <div style={{ fontSize: 11, color: '#4a5568', marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>
                {t.sub}
              </div>
            )}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: '#4a5568', padding: 2, flexShrink: 0,
              fontSize: 16, lineHeight: 1,
            }}
          >×</button>
        </div>
      ))}
    </div>
  )
}
