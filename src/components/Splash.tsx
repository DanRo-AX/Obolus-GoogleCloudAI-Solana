import { useEffect, useState } from 'react'

/**
 * A short cold-load curtain. Internal navigation stays immediate; replaying a
 * full-screen brand animation on every route made the product feel slower than
 * the underlying transition.
 */

const HOLD_MS = 280
const FADE_MS = 180

export function Splash() {
  const [visible, setVisible] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisible(false)
      return
    }
    const out = window.setTimeout(() => setLeaving(true), HOLD_MS)
    const gone = window.setTimeout(() => setVisible(false), HOLD_MS + FADE_MS)
    return () => {
      clearTimeout(out)
      clearTimeout(gone)
    }
  }, [])

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
          OPENSHELF
        </span>
        <span className="mb-1 block h-1.5 w-1.5 animate-pulse rounded-full bg-[#866FF2]" />
      </div>
    </div>
  )
}
