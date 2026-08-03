import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * The curtain. A cold load or a refresh holds it for a beat; a route change
 * gets a shorter pass so navigation still feels quick. Either way the same
 * mark is what you see between screens, which is what makes the app feel like
 * one place rather than a set of pages.
 */

const FIRST_LOAD_MS = 1000
const ROUTE_MS = 520
const FADE_MS = 260

export function Splash() {
  const { pathname } = useLocation()
  const first = useRef(true)
  const [visible, setVisible] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const hold = first.current ? FIRST_LOAD_MS : ROUTE_MS
    first.current = false

    setVisible(true)
    setLeaving(false)

    const out = window.setTimeout(() => setLeaving(true), hold)
    const gone = window.setTimeout(() => setVisible(false), hold + FADE_MS)
    return () => {
      clearTimeout(out)
      clearTimeout(gone)
    }
  }, [pathname])

  if (!visible) return null

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-[#0a0a0c]"
      style={{
        opacity: leaving ? 0 : 1,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
    >
      <div
        className="flex items-baseline gap-3"
        style={{
          transform: leaving ? 'translateY(-6px)' : 'translateY(0)',
          transition: `transform ${FADE_MS}ms ease-out`,
        }}
      >
        <span className="font-display text-[34px] font-semibold tracking-tight text-white sm:text-[44px]">
          Obolus
        </span>
        <span className="mb-1 block h-1.5 w-1.5 animate-pulse rounded-full bg-[#866FF2]" />
      </div>
    </div>
  )
}
