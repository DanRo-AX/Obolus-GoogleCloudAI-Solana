import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Clock, Coins } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/**
 * Screen 02 — Dashboard. The answerer's screen.
 * Open calls arrive with a price per question; you pick one, answer, get paid.
 * This is the open-survey slot, except the unit is one question, not a form.
 */
export default function Dashboard() {
  const { orders, memory } = useUi()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'open' | 'mine'>('open')
  const [opening, setOpening] = useState<string | null>(null)

  const open = useMemo(
    () => orders.filter((o) => !o.mine && o.answered < o.target),
    [orders],
  )
  const mine = useMemo(() => orders.filter((o) => o.mine), [orders])
  const list = tab === 'open' ? open : mine

  const earnedToday = memory
    .filter((m) => Date.now() - m.createdAt < 1000 * 60 * 60 * 24)
    .reduce((s, m) => s + m.earned, 0)

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
          <h1 className="font-sans text-base font-medium">Dashboard</h1>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
            <Coins className="size-3.5" />
            Settled today{' '}
            <span className="tabular-nums text-foreground">
              ₩{earnedToday.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('open')}
            className={cn(
              'flex h-9 cursor-pointer items-center gap-2 rounded-[2px] px-3 font-mono text-xs font-medium uppercase tracking-[1px] transition-colors',
              tab === 'open'
                ? 'border border-foreground/80 bg-foreground/85 text-background'
                : 'border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            Open to answer
            <Badge>{open.length}</Badge>
          </button>
          <button
            type="button"
            onClick={() => setTab('mine')}
            className={cn(
              'flex h-9 cursor-pointer items-center gap-2 rounded-[2px] px-3 font-mono text-xs font-medium uppercase tracking-[1px] transition-colors',
              tab === 'mine'
                ? 'border border-foreground/80 bg-foreground/85 text-background'
                : 'border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            Posted by me
            <Badge>{mine.length}</Badge>
          </button>
        </div>

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-[22vh] text-center">
            <h2 className="font-sans text-lg font-medium">
              {tab === 'open' ? 'No open calls right now' : 'You have not posted anything'}
            </h2>
            <p className="max-w-[320px] text-sm leading-relaxed text-muted-foreground">
              {tab === 'open'
                ? 'Calls that match you show up here. With enough memory, some match automatically without a call at all.'
                : 'Ask something in chat, and if the shelves come up empty you can post a call right there.'}
            </p>
            <Button asChild variant="mono" size="mono" className="mt-2">
              <Link to={tab === 'open' ? '/memory' : '/'}>
                {tab === 'open' ? 'Open my memory' : 'Ask something'}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {list.map((order) => {
              const done = order.answered >= order.target
              return (
                <div
                  key={order.id}
                  className={cn(
                    'flex flex-col rounded-[6px] border border-border bg-card p-5 transition-all duration-500',
                    opening && opening !== order.id && 'scale-[0.99] opacity-30',
                    opening === order.id && 'border-foreground/40 shadow-lg',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Badge className="px-1.5 py-0 uppercase tracking-[1px]">
                      {order.shelf}
                    </Badge>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      Per answer{' '}
                      <span className="text-foreground">
                        {order.unitPrice === 0
                          ? '₩0'
                          : `₩${order.unitPrice.toLocaleString()}`}
                      </span>
                    </span>
                  </div>

                  <p className="mt-3 text-[15px] leading-relaxed text-foreground">
                    {order.question}
                  </p>

                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-foreground/10">
                      <div
                        className="h-full rounded-full bg-[#0F766E] transition-[width] duration-500"
                        style={{
                          width: `${Math.round((order.answered / order.target) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {order.answered}/{order.target}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    <Clock className="size-3" />
                    {relative(order.createdAt)}
                    {done ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-[#0F766E]">
                        <Check className="size-3" /> Filled
                      </span>
                    ) : null}
                  </div>

                  {tab === 'open' && !done ? (
                    <Button
                      variant="monoMuted"
                      size="mono"
                      className="mt-4 self-start"
                      onClick={() => {
                        setOpening(order.id)
                        window.setTimeout(
                          () => navigate(`/answer/${order.id}`),
                          620,
                        )
                      }}
                      disabled={opening === order.id}
                    >
                      {opening === order.id ? 'Opening…' : 'Answer'}
                    </Button>
                  ) : null}

                  {tab === 'mine' && order.chatId ? (
                    <Button
                      asChild
                      variant="monoGhost"
                      size="monoSm"
                      className="mt-4 -ml-2.5 self-start"
                    >
                      <Link to={`/chat/${order.chatId}`}>Back to the chat</Link>
                    </Button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function relative(ts: number) {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 60) return `${Math.max(1, min)}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}
