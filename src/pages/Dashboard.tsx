import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Check,
  ChevronDown,
  Clock,
  Coins,
  ShieldAlert,
  UserRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/primitives'
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from '@/data/categories'
import { STRIKE_LIMIT } from '@/data/onboarding'
import { cn } from '@/lib/utils'
import { useUi, type Order } from '@/state/ui'

/**
 * Screen 02 — Dashboard. The answerer's screen.
 * Open calls arrive with a price per question; you pick one, answer, get paid.
 * This is the open-survey slot, except the unit is one question, not a form.
 */

type SortId = 'top' | 'pay' | 'new' | 'closing'

const SORTS: Array<{ id: SortId; label: string; hint: string }> = [
  { id: 'top', label: 'Top', hint: 'Pay, discounted by how long it has sat' },
  { id: 'pay', label: 'Highest pay', hint: 'Most per answer, however old' },
  { id: 'new', label: 'Newest', hint: 'Just posted, whatever it pays' },
  { id: 'closing', label: 'Closing soon', hint: 'Fewest slots left' },
]

/**
 * The default ranking.
 *
 * Sorting purely by price freezes the board — one ₩1,500 call from three days
 * ago outranks everything forever while a fresh ₩600 call is never seen, and it
 * is the asker waiting on that one who gives up on us. Sorting purely by time
 * buries the calls actually worth answering. So: pay, halved for every day it
 * has sat, nudged up when there is still room to get in.
 */
function topScore(o: Order) {
  const hours = (Date.now() - o.createdAt) / 3600000
  const freshness = 1 / (1 + hours / 24)
  const room = 1 + ((o.target - o.answered) / o.target) * 0.5
  return o.unitPrice * freshness * room
}

const MIN_PAY: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Any pay' },
  { value: 500, label: '₩500+' },
  { value: 1000, label: '₩1,000+' },
]

export default function Dashboard() {
  const { orders, memory, earnings, profile, suspended, cancelOrder, balance } = useUi()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [tab, setTab] = useState<'open' | 'mine'>('open')
  // The landing links straight into a field, so honour ?category= on entry.
  const [category, setCategory] = useState<CategoryId | 'all'>(() => {
    const q = params.get('category')
    return CATEGORIES.some((c) => c.id === q) ? (q as CategoryId) : 'all'
  })
  const [sort, setSort] = useState<SortId>('top')
  const [minPay, setMinPay] = useState(0)
  const [fitsMe, setFitsMe] = useState(false)
  const [hideFilled, setHideFilled] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)

  const base = useMemo(
    () =>
      orders.filter(
        (o) =>
          tab === 'mine'
            ? o.mine
            : !o.mine && o.status !== 'cancelled',
      ),
    [orders, tab],
  )

  /** Everything except the category tab, so the tab counts stay honest. */
  const preCategory = useMemo(
    () =>
      base.filter((o) => {
        if (o.unitPrice < minPay) return false
        if (hideFilled && o.answered >= o.target) return false
        if (fitsMe && profile && !(o.eligible ?? profile.speaksTo.includes(o.category)))
          return false
        return true
      }),
    [base, minPay, hideFilled, fitsMe, profile],
  )

  const counts = useMemo(() => {
    const map = new Map<CategoryId, number>()
    for (const o of preCategory) map.set(o.category, (map.get(o.category) ?? 0) + 1)
    return map
  }, [preCategory])

  const list = useMemo(() => {
    const rows = preCategory.filter(
      (o) => category === 'all' || o.category === category,
    )
    const sorted = [...rows]
    if (sort === 'top') sorted.sort((a, b) => topScore(b) - topScore(a))
    if (sort === 'pay')
      sorted.sort(
        (a, b) => b.unitPrice - a.unitPrice || b.createdAt - a.createdAt,
      )
    if (sort === 'new') sorted.sort((a, b) => b.createdAt - a.createdAt)
    if (sort === 'closing')
      sorted.sort(
        (a, b) =>
          a.target - a.answered - (b.target - b.answered) ||
          b.unitPrice - a.unitPrice,
      )
    return sorted
  }, [preCategory, category, sort])

  const openCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          !o.mine && o.status !== 'cancelled' && o.answered < o.target,
      ).length,
    [orders],
  )
  const mineCount = useMemo(() => orders.filter((o) => o.mine).length, [orders])

  const earnedToday = earnings
    ? earnings.events
        .filter((event) => Date.now() - event.createdAt < 1000 * 60 * 60 * 24)
        .reduce((sum, event) => sum + event.amountKrw, 0)
    : memory
        .filter((m) => Date.now() - m.createdAt < 1000 * 60 * 60 * 24)
        .reduce((sum, m) => sum + m.earned, 0)

  const activeSort = SORTS.find((s) => s.id === sort) ?? SORTS[0]

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
          <h1 className="font-sans text-base font-medium">Dashboard</h1>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
            <Coins className="size-3.5" />
            Accrued today{' '}
            <span className="tabular-nums text-foreground">
              ₩{earnedToday.toLocaleString()}
            </span>
            {balance ? (
              <span className="text-muted-foreground">· ₩{balance.availableKrw.toLocaleString()} available</span>
            ) : null}
          </div>
        </div>

        {/* tab + sort ---------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2">
          <SegTab
            active={tab === 'open'}
            onClick={() => setTab('open')}
            label="Open to answer"
            count={openCount}
          />
          <SegTab
            active={tab === 'mine'}
            onClick={() => setTab('mine')}
            label="Posted by me"
            count={mineCount}
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="ml-auto flex h-9 cursor-pointer items-center gap-2 rounded-[2px] border border-border px-3 font-mono text-xs uppercase tracking-[1px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Sort
                <span className="text-foreground">{activeSort.label}</span>
                <ChevronDown className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[248px]">
              {SORTS.map((s) => (
                <DropdownMenuItem
                  key={s.id}
                  onClick={() => setSort(s.id)}
                  className="flex-col items-start gap-0.5"
                >
                  <span className="flex w-full items-center gap-2 text-sm">
                    {s.label}
                    {sort === s.id ? (
                      <Check className="ml-auto size-3.5" />
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {s.hint}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* category tabs ------------------------------------------------- */}
        <div className="-mx-4 overflow-x-auto px-4 sm:-mx-6 sm:px-6">
          <div className="flex w-max items-center gap-1 border-b border-border pb-px">
            <CatTab
              active={category === 'all'}
              onClick={() => setCategory('all')}
              label="All"
              count={preCategory.length}
            />
            {CATEGORIES.map((c) => (
              <CatTab
                key={c.id}
                active={category === c.id}
                onClick={() => setCategory(c.id)}
                label={c.label}
                count={counts.get(c.id) ?? 0}
                accent={c.accent}
              />
            ))}
          </div>
        </div>

        {/* filters ------------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2">
          {MIN_PAY.map((p) => (
            <FilterChip
              key={p.value}
              active={minPay === p.value}
              onClick={() => setMinPay(p.value)}
              label={p.label}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <FilterChip
            active={hideFilled}
            onClick={() => setHideFilled((v) => !v)}
            label="Hide filled"
          />
          <FilterChip
            active={fitsMe}
            onClick={() => {
              if (!profile) navigate('/onboarding')
              else setFitsMe((v) => !v)
            }}
            label="Fits me"
            muted={!profile}
          />
          <span className="ml-auto font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            {list.length} {list.length === 1 ? 'call' : 'calls'}
          </span>
        </div>

        {suspended ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-destructive/30 bg-destructive/[0.05] px-4 py-3">
            <ShieldAlert className="size-4 shrink-0 text-destructive" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-destructive">
                Account suspended — {STRIKE_LIMIT} strikes.
              </span>{' '}
              You cannot pick up calls, and your documents have stopped being
              quoted. Anything already settled is still paid out.
            </p>
            <Button asChild variant="monoMuted" size="monoSm" className="ml-auto">
              <Link to="/memory">Review the strikes</Link>
            </Button>
          </div>
        ) : null}

        {!profile && tab === 'open' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border bg-foreground/[0.03] px-4 py-3">
            <UserRound className="size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              You are browsing signed out. Set up a profile and calls in your
              fields sort to the top.
            </p>
            <Button
              asChild
              variant="monoMuted"
              size="monoSm"
              className="ml-auto"
            >
              <Link to="/login?mode=signup">Create account</Link>
            </Button>
          </div>
        ) : null}

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-[16vh] text-center">
            <h2 className="font-sans text-lg font-medium">
              {tab === 'open'
                ? 'Nothing open here right now'
                : 'You have not posted anything'}
            </h2>
            <p className="max-w-[340px] text-sm leading-relaxed text-muted-foreground">
              {tab === 'open'
                ? 'No call matches these filters. Widen the category, or look at where the shelves are thin.'
                : 'Ask something in chat, and if the shelves come up empty you can post a call right there.'}
            </p>
            <Button asChild variant="mono" size="mono" className="mt-2">
              <Link to={tab === 'open' ? '/coverage' : '/'}>
                {tab === 'open' ? 'See coverage' : 'Ask something'}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {list.map((order) => {
              const done = order.answered >= order.target
              const cancelled = order.status === 'cancelled'
              const cat = CATEGORY_BY_ID[order.category]
              const fits = order.eligible ?? profile?.speaksTo.includes(order.category)
              return (
                <div
                  key={order.id}
                  className={cn(
                    'flex flex-col rounded-[6px] border border-border bg-card p-5 transition-all duration-500',
                    opening && opening !== order.id && 'scale-[0.99] opacity-30',
                    opening === order.id && 'border-foreground/40 shadow-lg',
                    (done || cancelled) && 'opacity-70',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="size-2 shrink-0 rounded-[1px]"
                        style={{ backgroundColor: cat?.accent }}
                      />
                      <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                        {cat?.label}
                      </span>
                      <Badge className="truncate px-1.5 py-0 uppercase tracking-[1px]">
                        {order.shelf}
                      </Badge>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
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
                  {order.filters && Object.values(order.filters).some(Boolean) ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                      Target · {Object.entries(order.filters)
                        .filter(([, value]) => Boolean(value))
                        .map(([key, value]) => `${key.replace(/([A-Z])/g, ' $1')} ${value}`)
                        .join(' · ')}
                    </p>
                  ) : null}

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
                    {cancelled ? (
                      <span className="ml-auto text-muted-foreground">
                        Cancelled · unused escrow refunded
                      </span>
                    ) : done ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-[#0F766E]">
                        <Check className="size-3" /> Filled
                      </span>
                    ) : profile && tab === 'open' ? (
                      <span
                        className={cn(
                          'ml-auto',
                          fits ? 'text-[#0F766E]' : 'text-muted-foreground/70',
                        )}
                      >
                        {fits ? 'Fits you' : 'Outside your fields'}
                      </span>
                    ) : null}
                  </div>

                  {tab === 'open' && !done ? (
                    <Button
                      variant="monoMuted"
                      size="mono"
                      className="mt-4 self-start"
                      onClick={() => {
                        if (!profile) {
                          navigate('/onboarding')
                          return
                        }
                        setOpening(order.id)
                        window.setTimeout(
                          () => navigate(`/answer/${order.id}`),
                          620,
                        )
                      }}
                      disabled={opening === order.id || suspended || Boolean(profile && !fits)}
                    >
                      {opening === order.id
                        ? 'Opening…'
                        : profile
                          ? fits
                            ? 'Answer'
                            : 'Profile does not match'
                          : 'Set up profile'}
                    </Button>
                  ) : null}

                  {tab === 'mine' ? (
                    <div className="mt-4 flex items-center gap-2">
                      {order.chatId ? (
                        <Button asChild variant="monoGhost" size="monoSm">
                          <Link to={`/chat/${order.chatId}`}>Back to the chat</Link>
                        </Button>
                      ) : null}
                      {order.status !== 'filled' && order.status !== 'cancelled' ? (
                        <Button
                          variant="monoMuted"
                          size="monoSm"
                          onClick={() => void cancelOrder(order.id)}
                        >
                          Cancel · refund ₩{(order.escrowRemainingKrw ?? 0).toLocaleString()}
                        </Button>
                      ) : null}
                    </div>
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

function SegTab({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2 rounded-[2px] px-3 font-mono text-xs font-medium uppercase tracking-[1px] transition-colors',
        active
          ? 'border border-foreground/80 bg-foreground/85 text-background'
          : 'border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {label}
      <Badge>{count}</Badge>
    </button>
  )
}

function CatTab({
  active,
  onClick,
  label,
  count,
  accent,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  accent?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative flex cursor-pointer items-center gap-1.5 whitespace-nowrap px-3 pb-2.5 pt-1 text-sm transition-colors',
        active
          ? 'font-medium text-foreground'
          : 'text-muted-foreground hover:text-foreground',
        count === 0 && !active && 'opacity-40',
      )}
    >
      {accent ? (
        <span
          className="size-1.5 rounded-[1px]"
          style={{ backgroundColor: accent }}
        />
      ) : null}
      {label}
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
        {count}
      </span>
      {active ? (
        <span className="absolute inset-x-2 -bottom-px h-0.5 bg-foreground" />
      ) : null}
    </button>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  muted,
}: {
  active: boolean
  onClick: () => void
  label: string
  muted?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'h-7 cursor-pointer rounded-full border px-3 font-mono text-[11px] uppercase tracking-[1px] transition-colors',
        active
          ? 'border-foreground/70 bg-foreground/[0.06] text-foreground'
          : 'border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground',
        muted && 'opacity-60',
      )}
    >
      {label}
    </button>
  )
}

function relative(ts: number) {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 60) return `${Math.max(1, min)}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.round(hr / 24)}d ago`
}
