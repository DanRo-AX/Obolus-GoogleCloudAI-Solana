import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * The split-flap / slot-machine text used for the provider ticker. Each glyph
 * lives in its own clipped slot; when the string changes the outgoing face rolls
 * up and the incoming face rolls in from below, staggered left to right.
 */

function Slot({ char, delay }: { char: string; delay: number }) {
  const [shown, setShown] = useState(char)
  const [offset, setOffset] = useState(0)
  const target = useRef(char)
  const timers = useRef<number[]>([])

  useEffect(() => {
    if (target.current === char) return
    target.current = char

    // Cancel any roll still in flight, then run this one end to end. `shown` is
    // deliberately not a dependency: updating it mid-roll would otherwise tear
    // down the timer that restores the face to its resting position.
    timers.current.forEach(clearTimeout)
    timers.current = [
      window.setTimeout(() => setOffset(-1), delay),
      window.setTimeout(() => {
        setShown(char)
        setOffset(1)
      }, delay + 130),
      window.setTimeout(() => setOffset(0), delay + 155),
    ]
  }, [char, delay])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const glyph = shown === ' ' ? ' ' : shown

  return (
    <span className="char-slot">
      <span className="char-sizer">{glyph}</span>
      <span
        className="char-face"
        style={{
          transform: `translateY(${offset * 110}%)`,
          opacity: offset === 0 ? 1 : 0,
          transition:
            offset === 1
              ? 'none'
              : 'transform 140ms cubic-bezier(0.4,0,0.2,1), opacity 140ms linear',
        }}
      >
        {glyph}
      </span>
    </span>
  )
}

export function SlotText({
  text,
  className,
  stagger = 22,
}: {
  text: string
  className?: string
  stagger?: number
}) {
  const [width, setWidth] = useState(text.length)

  // Grow immediately, shrink only after the roll finishes, so slots never clip.
  useEffect(() => {
    if (text.length >= width) {
      setWidth(text.length)
      return
    }
    const id = window.setTimeout(
      () => setWidth(text.length),
      stagger * text.length + 260,
    )
    return () => clearTimeout(id)
  }, [text, width, stagger])

  const chars = Array.from({ length: width }, (_, i) => text[i] ?? ' ')

  return (
    <span className={cn('slot-text', className)}>
      {chars.map((c, i) => (
        <Slot key={i} char={c} delay={i * stagger} />
      ))}
    </span>
  )
}
