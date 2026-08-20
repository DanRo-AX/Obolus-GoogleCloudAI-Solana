import * as React from 'react'
import { cn } from '@/lib/utils'

const COLORS = ['#6f6cff', '#ae6cff', '#ef6fae', '#54c9d8', '#54c98e', '#f0b86b']
const STYLE_ID = 'obulus-aurora-credit-card'

const STYLES = `
@keyframes obulus-card-flow {
  from { transform: rotate(-18deg) translate3d(0, -22%, 0); }
  to { transform: rotate(-18deg) translate3d(0, 22%, 0); }
}
@keyframes obulus-card-caustic {
  from { transform: rotate(-18deg) translate3d(0, 16%, 0); }
  to { transform: rotate(-18deg) translate3d(0, -16%, 0); }
}
@keyframes obulus-card-fibre {
  from { background-position: 0 0; }
  to { background-position: 92px 0; }
}
.obulus-card__flow { animation: obulus-card-flow 24s linear infinite alternate; }
.obulus-card__caustic { animation: obulus-card-caustic 18s linear infinite alternate; }
.obulus-card__fibre { animation: obulus-card-fibre 30s linear infinite; }
.obulus-card__tilt {
  transform: perspective(1000px) rotateX(var(--card-rx, 0deg)) rotateY(var(--card-ry, 0deg));
  transition: transform 420ms cubic-bezier(.22,.7,.28,1);
}
@media (prefers-reduced-motion: reduce) {
  .obulus-card__flow, .obulus-card__caustic, .obulus-card__fibre { animation: none; }
  .obulus-card__tilt { transform: none; transition: none; }
}
`

function useStyles() {
  React.useEffect(() => {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = STYLES
    document.head.appendChild(style)
  }, [])
}

function bandGradient(colors: string[]) {
  const stops = colors.map((color, index) => `${color} ${index * 18}%`)
  return `linear-gradient(180deg, ${stops.join(', ')}, ${colors[0]} 108%)`
}

export interface AuroraCreditCardProps
  extends Omit<React.ComponentProps<'div'>, 'title'> {
  amount: string
  label?: string
  handle?: string
  wallet?: string
  network?: string
  verified?: boolean
  colors?: string[]
}

/**
 * The aurora material from the supplied bento, reduced to the payment-card
 * face itself. It is informational rather than clickable: earnings, payout
 * identity and network come from the existing account ledger.
 */
export function AuroraCreditCard({
  amount,
  label = 'Earned to date',
  handle = 'OBULUS MEMBER',
  wallet = 'Wallet not set',
  network = 'Solana Devnet',
  verified = false,
  colors = COLORS,
  className,
  onPointerMove,
  onPointerLeave,
  ...props
}: AuroraCreditCardProps) {
  useStyles()
  const rootRef = React.useRef<HTMLDivElement>(null)
  const frameRef = React.useRef(0)

  const resetTilt = React.useCallback(() => {
    const root = rootRef.current
    if (!root) return
    root.style.setProperty('--card-rx', '0deg')
    root.style.setProperty('--card-ry', '0deg')
  }, [])

  React.useEffect(() => () => cancelAnimationFrame(frameRef.current), [])

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event)
    const root = rootRef.current
    if (!root) return
    cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      const bounds = root.getBoundingClientRect()
      const x = (event.clientX - bounds.left) / bounds.width - 0.5
      const y = (event.clientY - bounds.top) / bounds.height - 0.5
      root.style.setProperty('--card-rx', `${y * -5}deg`)
      root.style.setProperty('--card-ry', `${x * 6}deg`)
      root.style.setProperty('--card-mx', `${event.clientX - bounds.left}px`)
      root.style.setProperty('--card-my', `${event.clientY - bounds.top}px`)
    })
  }

  const leave = (event: React.PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event)
    cancelAnimationFrame(frameRef.current)
    resetTilt()
  }

  return (
    <div
      ref={rootRef}
      onPointerMove={move}
      onPointerLeave={leave}
      className={cn(
        'obulus-card__tilt group relative isolate aspect-[1.586/1] w-full overflow-hidden rounded-[24px] bg-[#100d21] text-white',
        'shadow-[0_28px_80px_-34px_rgba(48,35,105,0.65)]',
        className,
      )}
      aria-label={`${label}: ${amount}. ${network}.`}
      {...props}
    >
      <div
        aria-hidden="true"
        className="obulus-card__flow absolute -inset-[95%] blur-[24px] saturate-[1.08]"
        style={{ background: bandGradient(colors) }}
      />
      <div
        aria-hidden="true"
        className="obulus-card__caustic absolute -inset-[70%] opacity-60 mix-blend-screen blur-[8px]"
        style={{
          background:
            'repeating-linear-gradient(180deg, transparent 0%, transparent 8%, rgba(255,255,255,.86) 9%, transparent 10%, transparent 21%)',
        }}
      />
      <div
        aria-hidden="true"
        className="obulus-card__fibre absolute inset-0 opacity-25 mix-blend-overlay"
        style={{
          backgroundImage:
            'repeating-linear-gradient(98deg, transparent 0px, rgba(255,255,255,.25) 1px, transparent 2px, transparent 13px, rgba(0,0,0,.22) 14px, transparent 15px, transparent 23px)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-20 mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(145deg,rgba(255,255,255,.28),transparent_23%,transparent_62%,rgba(7,4,20,.56))]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(260px circle at var(--card-mx, 50%) var(--card-my, 50%), rgba(255,255,255,.2), transparent 72%)',
        }}
      />
      <div aria-hidden="true" className="absolute inset-px rounded-[23px] ring-1 ring-inset ring-white/25" />

      <div className="relative flex h-full flex-col justify-between p-[7.5%]">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-white/92 shadow-sm">
              <img src="/OBOLUS-MARK.svg" alt="" className="size-5" />
            </span>
            <div>
              <p className="text-[13px] font-semibold tracking-[-0.01em]">Obulus</p>
              <p className="font-mono text-[8px] uppercase tracking-[1.4px] text-white/65">
                Human evidence
              </p>
            </div>
          </div>
          <span className="rounded-full bg-black/18 px-2.5 py-1 font-mono text-[8px] uppercase tracking-[1px] text-white/75 backdrop-blur-md">
            {network}
          </span>
        </div>

        <div>
          <div className="mb-[7%] flex items-center gap-2" aria-hidden="true">
            <span className="grid h-8 w-11 grid-cols-3 grid-rows-2 overflow-hidden rounded-[7px] border border-white/30 bg-white/30 p-1 shadow-inner backdrop-blur-sm">
              {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className="border border-white/25" />
              ))}
            </span>
            <svg viewBox="0 0 22 30" className="h-7 w-5 text-white/75" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M2 11a7 7 0 0 1 0 8" />
              <path d="M8 7a13 13 0 0 1 0 16" />
              <path d="M14 3a19 19 0 0 1 0 24" />
            </svg>
          </div>
          <p className="font-mono text-[9px] uppercase tracking-[1.5px] text-white/65">
            {label}
          </p>
          <p className="mt-1 text-[clamp(28px,5.3vw,46px)] font-medium leading-none tracking-[-0.05em] tabular-nums">
            {amount}
          </p>
        </div>

        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate font-mono text-[9px] uppercase tracking-[1.3px] text-white/60">
              {handle}
            </p>
            <p className="mt-1 truncate font-mono text-[10px] tracking-[.8px] text-white/90">
              {wallet}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-[1px] text-white/75">
            {verified ? 'Verified' : 'Setup required'}
          </span>
        </div>
      </div>
    </div>
  )
}

export default AuroraCreditCard
