import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Check,
  Bell,
  Bot,
  ChevronDown,
  Clock,
  Coins,
  MessageSquareText,
  Mail,
  Loader2,
  Sparkles,
  ShieldAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
} from '@/components/ui/primitives'
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from '@/data/categories'
import { AGE_BANDS, HOUSEHOLDS, REGIONS, STRIKE_LIMIT } from '@/data/onboarding'
import { useLang } from '@/i18n'
import {
  ApiError,
  generateShelfStarters,
  getChatAnswers,
  listShelfStarters,
  submitShelfStarterAnswer,
  type ChatAnswer,
  type ContributorNotification,
  type ShelfStarter,
} from '@/lib/api'
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

/** How many cards sit in a row on tablet width and up. Mobile is always 1. */
type ColumnCount = 2 | 3 | 4
const COLUMNS_STORAGE_KEY = 'obolus:dashboard:columns:v1'
const GRID_COLS_CLASS: Record<ColumnCount, string> = {
  2: 'grid-cols-1 gap-4 sm:grid-cols-2',
  3: 'grid-cols-1 gap-3 sm:grid-cols-3',
  4: 'grid-cols-1 gap-3 sm:grid-cols-4',
}

function initialColumns(): ColumnCount {
  if (typeof window === 'undefined') return 2
  const saved = window.localStorage.getItem(COLUMNS_STORAGE_KEY)
  return saved === '2' || saved === '3' || saved === '4'
    ? (Number(saved) as ColumnCount)
    : 2
}

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
  const fit = o.recommendationScore ?? (o.eligible ? 0.55 : 0)
  return o.unitPrice * freshness * room * (0.75 + fit * 0.5)
}

const MIN_PAY: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Any pay' },
  { value: 500, label: '₩500+' },
  { value: 1000, label: '₩1,000+' },
]

/**
 * Marketplace-card header (variant 07 DNA): a banner strip tinted from the
 * question's category accent, soft enough to sit under a profile-style icon
 * badge rather than compete with it. Blended against --card, not the raw
 * accent, so it stays a tint even if a dark surface is added later.
 */
function categoryBannerStyle(accent?: string): CSSProperties {
  if (!accent) return { background: 'var(--muted)' }
  return {
    background: `linear-gradient(135deg, color-mix(in oklab, ${accent} 26%, var(--card)), color-mix(in oklab, ${accent} 9%, var(--card)))`,
  }
}

/**
 * Notification title/body come from the backend as fixed English literals
 * plus interpolated runtime numbers (see insert_notification's four call
 * sites in backend/src/store.rs) — there is no per-locale field to read.
 * Titles are exact literals, so they translate through the ordinary t()
 * dictionary. Bodies interpolate a price/percentage/question, so in ko mode
 * they are re-templated by parsing the four known English formats back out;
 * an unrecognised kind or format is left in English rather than mangled.
 */
const NOTIFICATION_CAPTION: Partial<Record<ContributorNotification['kind'], string>> = {
  call_available: 'New call',
  auto_matched: 'Auto-match',
  answer_received: 'New answer',
  call_filled: 'Filled',
}

function notificationCaption(kind: string, t: (en: string) => string) {
  const en = NOTIFICATION_CAPTION[kind as ContributorNotification['kind']]
  return en ? t(en) : kind
}

function notificationBody(n: ContributorNotification, lang: 'en' | 'ko'): string {
  if (lang !== 'ko') return n.body
  if (n.kind === 'auto_matched') {
    const m = n.body.match(
      /^A (\d+)% match reused your original answer and earned ₩([\d,]+)\.$/,
    )
    if (m) return `일치율 ${m[1]}%로 예전 답변이 재사용돼 ₩${m[2]}을 벌었어요.`
  } else if (n.kind === 'answer_received') {
    const m = n.body.match(/^(\d+)\/(\d+) answers collected for (.+)$/)
    if (m) return `${m[1]}/${m[2]}건 모였어요 · ${m[3]}`
  } else if (n.kind === 'call_filled') {
    const m = n.body.match(/^All (\d+) answers are ready to read\.$/)
    if (m) return `답변 ${m[1]}건, 이제 다 읽을 수 있어요.`
  } else if (n.kind === 'call_available') {
    const m = n.body.match(/^₩([\d,]+) per answer · (.+)$/)
    if (m) return `답변당 ₩${m[1]} · ${m[2]}`
  }
  return n.body
}

export default function Dashboard() {
  const {
    orders,
    memory,
    earnings,
    account,
    profile,
    suspended,
    cancelOrder,
    balance,
    chats,
    refreshLedger,
    agents,
    setAgents,
    notifications,
    markNotificationsRead,
    setBrowserAlerts,
    setEmailAlerts,
  } = useUi()
  const { t, lang } = useLang()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [tab, setTab] = useState<'open' | 'mine'>('open')
  // The landing links straight into a field, so honour ?category= on entry.
  const [category, setCategory] = useState<CategoryId | 'all'>(() => {
    const q = params.get('category')
    return CATEGORIES.some((c) => c.id === q) ? (q as CategoryId) : 'all'
  })
  const [sort, setSort] = useState<SortId>('top')
  const [columns, setColumns] = useState<ColumnCount>(initialColumns)
  const [minPay, setMinPay] = useState(0)
  const [fitsMe, setFitsMe] = useState(false)
  const [hideFilled, setHideFilled] = useState(true)
  const [opening, setOpening] = useState<string | null>(null)
  const [answerPanels, setAnswerPanels] = useState<Record<string, ChatAnswer[]>>({})
  const [answersLoading, setAnswersLoading] = useState<string | null>(null)
  const [answersError, setAnswersError] = useState<Record<string, string>>({})
  const [alertError, setAlertError] = useState<string | null>(null)
  const [starters, setStarters] = useState<ShelfStarter[]>([])
  const [startersLoading, setStartersLoading] = useState(false)
  const [starterError, setStarterError] = useState<string | null>(null)
  const [starterAnswers, setStarterAnswers] = useState<Record<string, string>>({})
  const [starterPrices, setStarterPrices] = useState<Record<string, number>>({})
  const [submittingStarter, setSubmittingStarter] = useState<string | null>(null)

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, String(columns))
    } catch {
      /* storage disabled — the choice just will not survive a reload */
    }
  }, [columns])

  useEffect(() => {
    if (!profile) {
      setStarters([])
      return
    }
    let cancelled = false
    void listShelfStarters()
      .then((items) => {
        if (!cancelled) setStarters(items)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [profile])

  async function createStarters() {
    setStartersLoading(true)
    setStarterError(null)
    try {
      const result = await generateShelfStarters()
      setStarters(result.starters)
      if (result.status === 'unavailable') {
        setStarterError(t('Vertex AI interview prompts are unavailable. No buyer demand or paid call was created.'))
      }
    } catch (error) {
      setStarterError(error instanceof Error ? error.message : t('Could not create shelf starters.'))
    } finally {
      setStartersLoading(false)
    }
  }

  async function publishStarter(starter: ShelfStarter) {
    const answer = starterAnswers[starter.id]?.trim() ?? ''
    if (!answer) {
      setStarterError(t('Write a firsthand answer before publishing it to your shelf.'))
      return
    }
    setSubmittingStarter(starter.id)
    setStarterError(null)
    try {
      await submitShelfStarterAnswer(
        starter.id,
        answer,
        starterPrices[starter.id] ?? 300,
      )
      setStarters((current) => current.filter((item) => item.id !== starter.id))
      setStarterAnswers((current) => {
        const next = { ...current }
        delete next[starter.id]
        return next
      })
      await refreshLedger()
    } catch (error) {
      setStarterError(error instanceof Error ? error.message : t('Could not publish this answer.'))
    } finally {
      setSubmittingStarter(null)
    }
  }

  async function toggleAnswers(order: Order) {
    if (!order.chatId) return
    if (answerPanels[order.id]) {
      setAnswerPanels((current) => {
        const next = { ...current }
        delete next[order.id]
        return next
      })
      return
    }

    setAnswersLoading(order.id)
    setAnswersError((current) => ({ ...current, [order.id]: '' }))
    try {
      const answers = await getChatAnswers(order.chatId)
      setAnswerPanels((current) => ({ ...current, [order.id]: answers }))
      void refreshLedger().catch(() => undefined)
    } catch (error) {
      setAnswersError((current) => ({
        ...current,
        [order.id]:
          error instanceof ApiError
            ? error.message
            : t('The answers did not load. Try that button again.'),
      }))
    } finally {
      setAnswersLoading((current) => (current === order.id ? null : current))
    }
  }

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
  // 3-4 columns need the card chrome a size down so nothing overflows a
  // narrower card — 2 columns keeps the original, roomier sizing.
  const compactCards = columns >= 3
  const unread = notifications.filter((notification) => !notification.readAt)
  const emailAlertsAvailable = Boolean(
    account && !/@wallet\.(?:obolus|openshelf)\.local$/i.test(account.email),
  )

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-4">
          <h1 className="font-sans text-base font-medium">{t('Open calls')}</h1>
          <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[1px] text-muted-foreground">
            <Coins className="size-3.5" />
            {t('Earned today')}{' '}
            <span className="tabular-nums text-foreground">
              ₩{earnedToday.toLocaleString()}
            </span>
            {balance ? (
              <span className="text-muted-foreground">
                · {t('Off-chain call credit')} ₩{balance.availableKrw.toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>

        {profile ? (
          <div className="divide-y divide-border border-y border-border lg:divide-y-0 lg:divide-x lg:flex">
            <div className="py-3 lg:flex-1 lg:px-4 lg:first:pl-0 lg:py-0">
              <AlertPreference
                icon={Bell}
                label={t('Browser alerts')}
                detail={t('Alerts this browser when an open call in your fields is posted.')}
                checked={
                  profile.browserAlerts === true &&
                  typeof Notification !== 'undefined' &&
                  Notification.permission === 'granted'
                }
                onChange={(value) => {
                  setAlertError(null)
                  void setBrowserAlerts(value).catch((error) =>
                    setAlertError(error instanceof Error ? error.message : t('The switch did not move. Try it again.')),
                  )
                }}
              />
            </div>
            {emailAlertsAvailable ? (
              <div className="py-3 lg:flex-1 lg:px-4">
                <AlertPreference
                  icon={Mail}
                  label={t('Email alerts')}
                  detail={t('Emails you the open calls that match your fields.')}
                  checked={profile.emailAlerts === true}
                  onChange={(value) => {
                    setAlertError(null)
                    void setEmailAlerts(value).catch((error) =>
                      setAlertError(error instanceof Error ? error.message : t('The switch did not move. Try it again.')),
                    )
                  }}
                />
              </div>
            ) : null}
            <div className="py-3 lg:flex-1 lg:px-4 lg:last:pr-0">
              <AlertPreference
                icon={Bot}
                label={t('Reuse from my shelf')}
                detail={t('Reuses an answer you already wrote, only when a call matches it 82% or more.')}
                checked={agents}
                onChange={setAgents}
              />
            </div>
            {alertError ? (
              <p className="pb-3 text-sm text-destructive lg:px-4">{alertError}</p>
            ) : null}
          </div>
        ) : null}

        {unread.length ? (
          <div>
            <div className="flex items-center gap-2 pb-2">
              <Bell className="size-3.5 text-[#0F766E]" />
              <span className="font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                {unread.length} {unread.length > 1 ? t('new updates') : t('new update')}
              </span>
              <button
                type="button"
                className="ml-auto cursor-pointer font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground hover:text-foreground"
                onClick={() => void markNotificationsRead()}
              >
                {t('Mark all read')}
              </button>
            </div>
            <div className="divide-y divide-border border-y border-border">
              {unread.slice(0, 3).map((notification) => (
                <Link
                  key={notification.id}
                  to={notification.kind === 'call_available' && notification.openCallId
                    ? `/answer/${notification.openCallId}`
                    : '/dashboard'}
                  onClick={() => void markNotificationsRead([notification.id])}
                  className="flex items-center gap-3 py-2.5 transition-colors hover:bg-foreground/[0.03]"
                >
                  <span className="size-1.5 shrink-0 rounded-full bg-[#0F766E]" />
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                    {notificationCaption(notification.kind, t)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {notificationBody(notification, lang)}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {relative(notification.createdAt, t)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {profile && tab === 'open' ? (
          <section className="rounded-[6px] border border-[#6D5BD0]/25 bg-[#6D5BD0]/[0.035] p-4">
            <div className="flex flex-wrap items-start gap-3">
              <Sparkles className="mt-0.5 size-4 text-[#5540BE]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('Build human supply before a buyer arrives')}</p>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  {t('Gemini on Vertex AI receives only your broad field and opted-in categories and creates interview prompts only. There is no buyer waiting and no guaranteed upfront reward. Your firsthand answer—not the AI prompt—becomes a priced human document that can earn when opened later.')}
                </p>
              </div>
              <Button
                variant="monoMuted"
                size="monoSm"
                onClick={() => void createStarters()}
                disabled={startersLoading || starters.length > 0}
              >
                {startersLoading ? (
                  <><Loader2 className="size-3 animate-spin" /> {t('Interviewing…')}</>
                ) : starters.length ? t('3 prompts ready') : t('Create 3 shelf starters')}
              </Button>
            </div>

            {starters.length ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {starters.map((starter) => (
                  <div key={starter.id} className="flex flex-col rounded-[5px] border border-border bg-card p-4">
                    <div className="font-mono text-[9px] uppercase tracking-[1px] text-[#5540BE]">
                      {t('AI interview prompt')} · {t(CATEGORY_BY_ID[starter.category]?.label ?? starter.category)}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-foreground">{starter.prompt}</p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{starter.rationale}</p>
                    <textarea
                      value={starterAnswers[starter.id] ?? ''}
                      onChange={(event) => setStarterAnswers((current) => ({
                        ...current,
                        [starter.id]: event.target.value,
                      }))}
                      placeholder={t('Write what actually happened. Include a place, time, number, or concrete outcome.')}
                      className="mt-3 min-h-28 resize-y rounded-[4px] border border-border bg-background p-3 text-sm leading-6 outline-none focus:border-foreground/35"
                      maxLength={10000}
                    />
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {[100, 300, 500].map((price) => (
                        <button
                          key={price}
                          type="button"
                          className={cn(
                            'rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.7px]',
                            (starterPrices[starter.id] ?? 300) === price
                              ? 'border-foreground/60 text-foreground'
                              : 'border-border text-muted-foreground',
                          )}
                          onClick={() => setStarterPrices((current) => ({
                            ...current,
                            [starter.id]: price,
                          }))}
                        >
                          ₩{price} {t('future open')}
                        </button>
                      ))}
                    </div>
                    <Button
                      variant="mono"
                      size="monoSm"
                      className="mt-3 self-start"
                      disabled={submittingStarter === starter.id}
                      onClick={() => void publishStarter(starter)}
                    >
                      {submittingStarter === starter.id ? t('Publishing…') : t('Publish my human answer')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            {starterError ? (
              <p className="mt-3 text-xs leading-relaxed text-destructive">{starterError}</p>
            ) : null}
          </section>
        ) : null}

        {/* tab + sort ---------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2">
          <SegTab
            active={tab === 'open'}
            onClick={() => setTab('open')}
            label={t('Open to answer')}
            count={openCount}
          />
          <SegTab
            active={tab === 'mine'}
            onClick={() => setTab('mine')}
            label={t('Posted by me')}
            count={mineCount}
          />

          <div className="ml-auto flex items-center gap-2">
            <ColumnToggle value={columns} onChange={setColumns} t={t} />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-11 cursor-pointer items-center gap-2 rounded-[2px] border border-border px-3 font-mono text-xs uppercase tracking-[1px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9"
                >
                  {t('Sort')}
                  <span className="text-foreground">{t(activeSort.label)}</span>
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
                      {t(s.label)}
                      {sort === s.id ? (
                        <Check className="ml-auto size-3.5" />
                      ) : null}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(s.hint)}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* category rail --------------------------------------------------
            A vertical rail instead of a horizontal strip: eleven fields never
            fit across the top without truncating or scrolling sideways, and a
            field you cannot see is a field nobody filters by. On a phone the
            rail lies down and scrolls sideways, so the swipe cue still has a
            job — it only shows where the scrolling actually happens. */}
        <p className="-mb-3 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground sm:hidden">
          {t('Swipe to browse fields')} →
        </p>
        <div className="-mx-4 grid gap-6 sm:-mx-6 lg:grid-cols-[184px_1fr] lg:gap-0">
          <nav className="flex gap-1 overflow-x-auto px-4 pb-1 sm:px-6 lg:min-h-[70vh] lg:flex-col lg:overflow-visible lg:border-r lg:border-border lg:px-2 lg:pb-0">
            <CatTab
              active={category === 'all'}
              onClick={() => setCategory('all')}
              label={t('All')}
              count={preCategory.length}
            />
            {CATEGORIES.map((c) => (
              <CatTab
                key={c.id}
                active={category === c.id}
                onClick={() => setCategory(c.id)}
                label={t(c.label)}
                count={counts.get(c.id) ?? 0}
                accent={c.accent}
              />
            ))}
          </nav>

          <div className="min-w-0 space-y-6 px-4 sm:px-6 lg:pl-6">
        {/* filters ------------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-2">
          {MIN_PAY.map((p) => (
            <FilterChip
              key={p.value}
              active={minPay === p.value}
              onClick={() => setMinPay(p.value)}
              label={t(p.label)}
            />
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <FilterChip
            active={hideFilled}
            onClick={() => setHideFilled((v) => !v)}
            label={t('Hide filled')}
          />
          <FilterChip
            active={fitsMe}
            onClick={() => {
              if (!profile) navigate('/onboarding')
              else setFitsMe((v) => !v)
            }}
            label={t('Fits me')}
            muted={!profile}
          />
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
            {list.length} {list.length === 1 ? t('call') : t('calls')}
          </span>
        </div>

        {suspended ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-destructive/30 bg-destructive/[0.05] px-4 py-3">
            <ShieldAlert className="size-4 shrink-0 text-destructive" />
            <p className="text-sm leading-relaxed text-muted-foreground">
              <span className="font-medium text-destructive">
                {t('Account suspended —')} {STRIKE_LIMIT} {t('strikes.')}
              </span>{' '}
              {t('You cannot pick up calls, and SHELF has stopped quoting your documents. USDC that already settled stays in your wallet.')}
            </p>
            <Button asChild variant="monoMuted" size="monoSm" className="ml-auto">
              <Link to="/memory">{t('Review the strikes')}</Link>
            </Button>
          </div>
        ) : null}

        {!profile && tab === 'open' ? (
          <div className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border bg-foreground/[0.03] px-4 py-3">
            <UserRound className="size-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {/* Signed in already? Then never ask for another account — the
                  only thing missing is the profile. */}
              {account
                ? t('Your account is ready. Name your fields, and calls in them sort to the top.')
                : t('You are reading signed out. Connect a wallet, name your fields, and calls in them sort to the top.')}
            </p>
            <Button
              asChild
              variant="monoMuted"
              size="monoSm"
              className="ml-auto"
            >
              <Link to={account ? '/onboarding' : '/login'}>
                {account ? t('Set up profile') : t('Connect wallet')}
              </Link>
            </Button>
          </div>
        ) : null}

        {list.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-[16vh] text-center">
            <h2 className="font-sans text-lg font-medium">
              {tab === 'open'
                ? t('Nothing open here right now')
                : t('You have not posted anything')}
            </h2>
            <p className="max-w-[340px] text-sm leading-relaxed text-muted-foreground">
              {tab === 'open'
                ? t('No call matches these filters. Widen the category, or look at where the shelves are thin.')
                : t('Ask something in chat, and if the shelves come up empty you can post a call right there.')}
            </p>
            <Button asChild variant="mono" size="mono" className="mt-2">
              <Link to={tab === 'open' ? '/coverage' : '/'}>
                {tab === 'open' ? t('See thin shelves') : t('Ask something')}
              </Link>
            </Button>
          </div>
        ) : (
          // Marketplace card grid (variant 07 DNA): two cards per row from
          // tablet width up, one per row only at phone width — not a dense
          // hairline list. Each card gets a profile-style header, a banner
          // strip tinted from the category accent with a circular icon
          // badge overlapping its left-bottom edge, like an avatar.
          <div className={cn('grid', GRID_COLS_CLASS[columns])}>
            {list.map((order) => {
              const done = order.answered >= order.target
              const cancelled = order.status === 'cancelled'
              const cat = CATEGORY_BY_ID[order.category]
              const fits = order.eligible ?? profile?.speaksTo.includes(order.category)
              const remaining = Math.max(0, order.target - order.answered)
              const reservedByOthers = Math.max(
                0,
                (order.reservedSlots ?? 0) - (order.reservationExpiresAt ? 1 : 0),
              )
              const fullyReserved = reservedByOthers >= remaining && !order.reservationExpiresAt
              return (
                <div
                  key={order.id}
                  className={cn(
                    'flex flex-col overflow-hidden rounded-[10px] border border-border bg-card transition-colors duration-300',
                    opening && opening !== order.id && 'opacity-30',
                    opening === order.id && 'bg-foreground/[0.03]',
                    (done || cancelled) && 'opacity-70',
                  )}
                >
                  <div
                    className={cn('relative shrink-0', compactCards ? 'h-11' : 'h-14')}
                    style={categoryBannerStyle(cat?.accent)}
                  >
                    <span
                      className={cn(
                        'absolute flex items-center justify-center rounded-full border border-border bg-card shadow-[0_1px_3px_rgba(20,20,25,0.12)]',
                        compactCards ? '-bottom-4 left-3 size-8' : '-bottom-5 left-4 size-10',
                      )}
                    >
                      <CategoryIcon
                        id={order.category}
                        className={compactCards ? 'size-4' : 'size-5'}
                        style={{ color: cat?.accent ?? 'var(--muted-foreground)' }}
                      />
                    </span>
                  </div>
                  <div
                    className={cn(
                      'flex flex-1 flex-col',
                      compactCards ? 'px-3 pb-3 pt-6' : 'px-4 pb-4 pt-7',
                    )}
                  >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                      <span
                        className="size-2 shrink-0 rounded-[1px]"
                        style={{ backgroundColor: cat?.accent }}
                      />
                      <span className="truncate font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                        {cat?.label ? t(cat.label) : null}
                      </span>
                      <Badge
                        className={cn(
                          'min-w-0 truncate px-1.5 py-0 uppercase tracking-[1px]',
                          compactCards && 'hidden',
                        )}
                        title={order.shelf}
                      >
                        {order.shelf}
                      </Badge>
                    </span>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {t('Per answer')}{' '}
                      <span className="text-foreground">
                        {order.unitPrice === 0
                          ? '₩0'
                          : `₩${order.unitPrice.toLocaleString()}`}
                      </span>
                    </span>
                  </div>

                  <p
                    className={cn(
                      'mt-1.5 leading-relaxed text-foreground',
                      compactCards ? 'text-[13px]' : 'text-[15px]',
                    )}
                  >
                    {order.question}
                  </p>
                  {order.filters && Object.values(order.filters).some(Boolean) ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                      {t('Who answers')} · {Object.entries(order.filters)
                        .filter(([, value]) => Boolean(value))
                        .map(([key, value]) => {
                          if (key === 'category' || key === 'field') {
                            const filterCat = CATEGORY_BY_ID[value as CategoryId]
                            const prefix = key === 'field' ? t('Field') : t('Category')
                            return `${prefix} ${filterCat?.label ? t(filterCat.label) : value}`
                          }
                          if (key === 'ageBand' || key === 'region' || key === 'household') {
                            const options =
                              key === 'ageBand' ? AGE_BANDS : key === 'region' ? REGIONS : HOUSEHOLDS
                            const prefix =
                              key === 'ageBand' ? t('Age') : key === 'region' ? t('Region') : t('Household')
                            const filterOption = options.find((o) => o.value === value)
                            return `${prefix} ${filterOption ? t(filterOption.label) : value}`
                          }
                          return `${key.replace(/([A-Z])/g, ' $1')} ${value}`
                        })
                        .join(' · ')}
                    </p>
                  ) : null}
                  {profile && fits && (order.recommendationScore ?? 0) > 0 ? (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[1px] text-[#0F766E]">
                      {t('Recommended')} · {Math.round((order.recommendationScore ?? 0) * 100)}% {t('fit')}
                      {order.recommendationReason?.[1]
                        ? ` · ${order.recommendationReason[1]}`
                        : ''}
                    </p>
                  ) : null}

                  <div className="mt-3 flex items-center gap-3">
                    {/* A thin, square-ended bar rather than a pill — Linear's
                        progress language stays close to a hairline rule. */}
                    <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-foreground/10">
                      <div
                        className="h-full rounded-[2px] bg-[#0F766E] transition-[width] duration-500"
                        style={{
                          width: `${Math.round((order.answered / order.target) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                      {order.answered}/{order.target}
                      {reservedByOthers > 0 ? (
                        <> · {reservedByOthers} {t('slots held')}</>
                      ) : null}
                    </span>
                  </div>

                  {/* Meta + the per-row CTA share one line — a quiet trailing
                      action instead of a full-width button block repeated
                      down the page for every open call. */}
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
                    <Clock className="size-3" />
                    {relative(order.createdAt, t)}
                    {order.escrowMode === 'x402_solana_escrow' && !cancelled ? (
                      <span className="text-[#0F766E]">{t('Devnet USDC escrow')}</span>
                    ) : null}
                    {cancelled ? (
                      <span className="ml-auto text-muted-foreground">
                        {t('Cancelled · refund in your wallet')}
                      </span>
                    ) : done ? (
                      <span className="ml-auto inline-flex items-center gap-1 text-[#0F766E]">
                        <Check className="size-3" /> {t('Filled')}
                      </span>
                    ) : profile && tab === 'open' ? (
                      <span
                        className={cn(
                          'ml-auto',
                          fits ? 'text-[#0F766E]' : 'text-muted-foreground/70',
                        )}
                      >
                        {fits ? t('Fits you') : t('Outside your fields')}
                      </span>
                    ) : null}

                    {tab === 'open' && !done ? (
                      <Button
                        variant="monoMuted"
                        size="monoSm"
                        className="ml-auto shrink-0 font-sans normal-case tracking-normal"
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
                        disabled={
                          opening === order.id ||
                          suspended ||
                          Boolean(profile && !fits) ||
                          fullyReserved
                        }
                      >
                        {opening === order.id
                          ? t('Picking it up…')
                          : fullyReserved
                            ? t('All remaining slots held')
                            : profile && !fits
                              ? t('Outside your fields')
                              : t('Answer')}
                      </Button>
                    ) : null}
                  </div>

                  {tab === 'mine' ? (
                    <div className="mt-3 space-y-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        {order.chatId ? (
                          <Button
                            variant="monoGhost"
                            size="monoSm"
                            onClick={() => void toggleAnswers(order)}
                            disabled={answersLoading === order.id}
                          >
                            <MessageSquareText className="size-3.5" />
                            {answersLoading === order.id
                              ? t('Loading answers…')
                              : answerPanels[order.id]
                                ? t('Hide the answers')
                                : <>{t('Read the answers')} · {order.answered}</>}
                          </Button>
                        ) : null}
                        {order.chatId && chats.some((chat) => chat.id === order.chatId) ? (
                          <Button asChild variant="monoGhost" size="monoSm">
                            <Link to={`/chat/${order.chatId}`}>{t('Back to the question')}</Link>
                          </Button>
                        ) : null}
                        {order.status !== 'filled' && order.status !== 'cancelled' ? (
                          <Button
                            variant="monoMuted"
                            size="monoSm"
                            onClick={() => void cancelOrder(order.id)}
                          >
                            {t('Cancel')} · ₩{(order.escrowRemainingKrw ?? 0).toLocaleString()} {t('back to your wallet')}
                          </Button>
                        ) : null}
                      </div>

                      {answersError[order.id] ? (
                        <p className="text-xs leading-relaxed text-destructive">
                          {answersError[order.id]}
                        </p>
                      ) : null}

                      {answerPanels[order.id] ? (
                        answerPanels[order.id].length > 0 ? (
                          <div className="space-y-2 border-t border-border pt-3">
                            {answerPanels[order.id].map((answer) => (
                              <div
                                key={answer.id}
                                className="rounded-[4px] border border-border bg-background/70 p-3"
                              >
                                <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                                  <span className="text-foreground">{answer.handle}</span>
                                  <span>· {answer.shelf}</span>
                                  {answer.demographics ? (
                                    <span>
                                      · {answer.demographics.ageBand} · {answer.demographics.region}
                                    </span>
                                  ) : null}
                                  <span className="ml-auto tabular-nums">
                                    ₩{answer.price.toLocaleString()} {t('settled')}
                                  </span>
                                </div>
                                <p className="mt-2 text-sm leading-relaxed text-foreground">
                                  {answer.excerpt}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                            {t('No answers in yet. The call stays open, and it is here on any device you sign in from.')}
                          </p>
                        )
                      ) : null}
                    </div>
                  ) : null}
                  </div>
                </div>
              )
            })}
          </div>
          )}
          </div>
        </div>
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
        'flex h-11 cursor-pointer items-center gap-2 rounded-[2px] px-3 font-mono text-xs font-medium uppercase tracking-[1px] transition-colors sm:h-9',
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
        // min-h-11 is the accessible touch target, kept over the tighter h-8:
        // on a phone this rail is the horizontal strip you thumb through.
        'flex min-h-11 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[4px] px-2.5 text-[13px] tracking-[-0.006em] transition-colors lg:w-full',
        active
          ? 'bg-background font-medium text-foreground shadow-[0_1px_2px_rgba(20,20,25,0.05)] lg:bg-muted-2'
          : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
        count === 0 && !active && 'opacity-45',
      )}
    >
      {accent ? (
        <span
          className="size-1.5 shrink-0 rounded-[1px]"
          style={{ backgroundColor: accent }}
        />
      ) : (
        /* The 'All' tab has no accent, but the rail still needs its labels
           to start on the same vertical line. */
        <span className="size-1.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
      <span className="ml-auto pl-1 font-mono text-[11px] tabular-nums text-muted-foreground">
        {count}
      </span>
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
        // Linear's filter row uses small rectangular toggles, not pills —
        // pill radius is reserved for status/count tokens (see Badge).
        'h-10 cursor-pointer rounded-[6px] border px-3 font-mono text-[11px] uppercase tracking-[1px] transition-colors sm:h-7',
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

/**
 * A segmented 2/3/4 control, same hairline-border-and-tiny-radius language
 * as FilterChip, just compact enough to sit next to the Sort trigger instead
 * of taking a filter-row slot of its own.
 */
function ColumnToggle({
  value,
  onChange,
  t,
}: {
  value: ColumnCount
  onChange: (value: ColumnCount) => void
  t: (en: string) => string
}) {
  const optionClass = (n: ColumnCount, withDivider: boolean) =>
    cn(
      'flex min-w-9 cursor-pointer items-center justify-center px-2 font-mono text-xs tabular-nums transition-colors',
      withDivider && 'border-l border-border',
      value === n
        ? 'bg-foreground/[0.06] text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
    )
  return (
    <div
      role="group"
      aria-label={t('Columns per row')}
      className="flex h-11 items-stretch overflow-hidden rounded-[2px] border border-border sm:h-9"
    >
      <button
        type="button"
        aria-label={t('2 columns per row')}
        aria-pressed={value === 2}
        onClick={() => onChange(2)}
        className={optionClass(2, false)}
      >
        2
      </button>
      <button
        type="button"
        aria-label={t('3 columns per row')}
        aria-pressed={value === 3}
        onClick={() => onChange(3)}
        className={optionClass(3, true)}
      >
        3
      </button>
      <button
        type="button"
        aria-label={t('4 columns per row')}
        aria-pressed={value === 4}
        onClick={() => onChange(4)}
        className={optionClass(4, true)}
      >
        4
      </button>
    </div>
  )
}

function AlertPreference({
  icon: Icon,
  label,
  detail,
  checked,
  onChange,
}: {
  icon: LucideIcon
  label: string
  detail: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

/** Not a component, so the translator arrives as an argument, not a hook. */
function relative(ts: number, t: (en: string) => string) {
  const min = Math.round((Date.now() - ts) / 60000)
  if (min < 60) return `${Math.max(1, min)}${t('m ago')}`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}${t('h ago')}`
  return `${Math.round(hr / 24)}${t('d ago')}`
}
