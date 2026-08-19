import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Check,
  Bell,
  Bot,
  ChevronDown,
  Coins,
  MessageSquareText,
  Mail,
  Loader2,
  Search,
  Sparkles,
  ShieldAlert,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CategoryIcon } from '@/components/CategoryIcon'
import {
  Badge,
  Banner,
  bannerToneStyle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Switch,
} from '@/components/ui/primitives'
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from '@/data/categories'
import { AGE_BANDS, HOUSEHOLDS, REGIONS, STRIKE_LIMIT } from '@/data/onboarding'
import { useLang } from '@/i18n'
import { cardGradient, cardTexture } from '@/lib/cardGradient'
import { Avatar } from '@/components/Avatar'
import { deterministicAvatar } from '@/lib/avatar'
import {
  ApiError,
  generateShelfStarters,
  getChatAnswers,
  listShelfStarters,
  submitShelfStarterAnswer,
  type ChatAnswer,
  type ShelfStarter,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import { useUi, type Order } from '@/state/ui'

/**
 * Screen 02 — Dashboard. The answerer's screen.
 * Open calls arrive with a price per question; you pick one, answer, get paid.
 * This is the open-survey slot, except the unit is one question, not a form.
 */

type SortId = 'new' | 'popular' | 'pay' | 'fit'

const SORTS: Array<{ id: SortId; label: string; hint: string }> = [
  { id: 'new', label: 'Newest', hint: 'Just posted, whatever it pays' },
  { id: 'popular', label: 'Most popular', hint: 'Most answers collected so far' },
  { id: 'pay', label: 'Highest pay', hint: 'Most per answer, however old' },
  { id: 'fit', label: 'Best fit', hint: 'Closest match to your fields' },
]

/**
 * The fit signal `topScore` used to blend into its combined ranking, now
 * standalone as the "적합도순" sort — a recommendation score when the backend
 * has one, else a flat bump for a call inside a field the profile lists.
 */
function fitScore(o: Order) {
  return o.recommendationScore ?? (o.eligible ? 0.55 : 0)
}

/**
 * Callout-badge header: a banner patch tinted from a fixed accent, soft
 * enough to sit under a profile-style icon badge rather than compete with
 * it. Blended against --card, not the raw accent, so it stays a tint even
 * if a dark surface is added later.
 *
 * The open-calls card banner below no longer uses this — it paints with
 * `cardGradient` (src/lib/cardGradient.ts) instead, a keyword-hashed
 * multicolor gradient per variant 7 ("Airbnb 리스팅"). This helper stays for
 * the "Build human supply" callout's leading avatar, which still wants a
 * single-accent tint.
 */
function categoryBannerStyle(accent?: string): CSSProperties {
  if (!accent) return { background: 'var(--muted)' }
  return {
    background: `linear-gradient(135deg, color-mix(in oklab, ${accent} 26%, var(--card)), color-mix(in oklab, ${accent} 9%, var(--card)))`,
  }
}

/**
 * Search matches the translated category label or the raw question text —
 * a case-insensitive substring check, not fuzzy matching. `query` arrives
 * already trimmed and lower-cased by the caller.
 */
function matchesSearch(order: Order, query: string, t: (en: string) => string): boolean {
  const label = CATEGORY_BY_ID[order.category]?.label
  const haystack = `${label ? t(label) : ''} ${order.question}`.toLowerCase()
  return haystack.includes(query)
}

/**
 * The "Who answers" targeting line — shared by the card body and the
 * question-preview modal so both read an order's filters the same way.
 * `null` when the call has no active filters, so callers can skip the row.
 */
function whoAnswersLine(order: Order, t: (en: string) => string): string | null {
  if (!order.filters || !Object.values(order.filters).some(Boolean)) return null
  return Object.entries(order.filters)
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
    .join(' · ')
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
    setBrowserAlerts,
    setEmailAlerts,
  } = useUi()
  const { t } = useLang()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [tab, setTab] = useState<'open' | 'mine'>('open')
  // The landing links straight into a field, so honour ?category= on entry.
  const [category, setCategory] = useState<CategoryId | 'all'>(() => {
    const q = params.get('category')
    return CATEGORIES.some((c) => c.id === q) ? (q as CategoryId) : 'all'
  })
  const [sort, setSort] = useState<SortId>('new')
  const [query, setQuery] = useState('')
  const [hideFilled, setHideFilled] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null)
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

  /** Runs after "참여 시작" is confirmed in the question-preview modal. */
  function startAnswering(order: Order) {
    setPreviewOrder(null)
    setOpening(order.id)
    window.setTimeout(() => navigate(`/answer/${order.id}`), 620)
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

  const q = query.trim().toLowerCase()

  /** Everything except the category tab, so the tab counts stay honest. */
  const preCategory = useMemo(
    () =>
      base.filter((o) => {
        if (q && !matchesSearch(o, q, t)) return false
        // "진행 중인 설문만 보기" only has teeth while searching — it hides
        // filled calls from the results, not from the board at large.
        if (q && hideFilled && o.answered >= o.target) return false
        return true
      }),
    [base, q, hideFilled, t],
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
    if (sort === 'new') sorted.sort((a, b) => b.createdAt - a.createdAt)
    // 인기순: we have no view/click telemetry per call, so "popular" is
    // defined as the number of answers already collected — the one signal
    // that actually reflects other contributors choosing this call.
    if (sort === 'popular') sorted.sort((a, b) => b.answered - a.answered)
    if (sort === 'pay')
      sorted.sort(
        (a, b) => b.unitPrice - a.unitPrice || b.createdAt - a.createdAt,
      )
    if (sort === 'fit') sorted.sort((a, b) => fitScore(b) - fitScore(a))
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
  const emailAlertsAvailable = Boolean(
    account && !/@wallet\.(?:obolus|openshelf)\.local$/i.test(account.email),
  )

  // Hidden pending design review — code kept intact, just not rendered.
  const SHOW_ALERT_SETTINGS = false
  const SHOW_SHELF_STARTERS = false

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

        {SHOW_ALERT_SETTINGS && profile ? (
          <Banner tone="neutral" className="overflow-hidden p-0">
            <div className="divide-y divide-border/60 lg:divide-y-0 lg:divide-x lg:divide-border/60 lg:flex">
              <div className="px-4 py-3 lg:flex-1">
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
                <div className="px-4 py-3 lg:flex-1">
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
              <div className="px-4 py-3 lg:flex-1">
                <AlertPreference
                  icon={Bot}
                  label={t('Reuse from my shelf')}
                  detail={t('Reuses an answer you already wrote, only when a call matches it 82% or more.')}
                  checked={agents}
                  onChange={setAgents}
                />
              </div>
            </div>
            {alertError ? (
              <p className="border-t border-border/60 px-4 py-2.5 text-sm text-destructive">{alertError}</p>
            ) : null}
          </Banner>
        ) : null}

        {SHOW_SHELF_STARTERS && profile && tab === 'open' ? (
          <section
            className="rounded-[6px] border p-4"
            style={bannerToneStyle('violet')}
          >
            <div className="flex flex-wrap items-start gap-3">
              {/* Same gradient-patch-plus-overlapping-badge grammar as the
                  card header (categoryBannerStyle), miniaturised into a
                  leading avatar — this callout is not a category, but it
                  should still visually rhyme with the cards below it. */}
              <span
                className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px]"
                style={categoryBannerStyle('#6D5BD0')}
              >
                <span className="absolute -bottom-1 -left-1 flex size-6 items-center justify-center rounded-full border border-border bg-card shadow-[0_1px_3px_rgba(20,20,25,0.12)]">
                  <Sparkles className="size-3.5 text-[#5540BE]" />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{t('Build human supply before a buyer arrives')}</p>
                <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  {t('Gemini on Vertex AI receives only your broad field and opted-in categories, and creates interview prompts. There is no buyer waiting and no guaranteed upfront reward. Your firsthand answer—not the AI prompt—becomes a priced human document that can earn when opened later.')}
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

        {/* tabs ------------------------------------------------------------ */}
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
        </div>

        {/* A quiet editorial index. Colour belongs to the work cards below,
            not to navigation, so fields are plain text with one active rule. */}
        <p className="-mb-3 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground sm:hidden">
          {t('Swipe to browse fields')} →
        </p>
        <div className="space-y-5">
          <nav className="-mx-4 flex gap-6 overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:px-6 lg:mx-0 lg:overflow-visible lg:px-0">
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
              />
            ))}
          </nav>

          <div className="min-w-0 space-y-6">
        {/* toolbar ----------------------------------------------------------
            Search replaces the old value/hide-filled/fits-me chip row; sort
            moves down here from the tab row now that the column switcher —
            and the ml-auto slot it shared with sort — is gone. */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('Search category or title')}
              className="h-10 w-full rounded-md border border-border bg-background pl-9 pr-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground/70 focus:border-foreground/35 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.035)]"
            />
          </div>
          {q ? (
            <label className="flex h-11 cursor-pointer select-none items-center gap-1.5 px-1 font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground transition-colors hover:text-foreground sm:h-9">
              <input
                type="checkbox"
                checked={hideFilled}
                onChange={(event) => setHideFilled(event.target.checked)}
                className="size-3.5 accent-foreground"
              />
              {t('Show open surveys only')}
            </label>
          ) : null}
          <span className="ml-auto font-mono text-[11px] uppercase tracking-[1px] text-muted-foreground">
            {list.length} {list.length === 1 ? t('call') : t('calls')}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
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

        {suspended ? (
          <Banner tone="destructive" className="flex flex-wrap items-center gap-3 px-4 py-3">
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
          </Banner>
        ) : null}

        {!profile && tab === 'open' ? (
          <Banner tone="neutral" className="flex flex-wrap items-center gap-3 px-4 py-3">
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
          </Banner>
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
          // Editorial case-study grid: a generous visual thumbnail first,
          // then the question and only the marketplace facts needed to act.
          // This deliberately avoids the bordered "dashboard widget" look.
          <div className="grid grid-cols-1 gap-x-5 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
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
              const who = whoAnswersLine(order, t)
              // The who-answers line only earns its place when it adds real
              // targeting beyond the category badge already shown above —
              // a call filtered on nothing but its own category would just
              // repeat the meta row as noise.
              const hasNarrowFilters = Boolean(
                order.filters &&
                  (order.filters.ageBand ||
                    order.filters.region ||
                    order.filters.household ||
                    order.filters.field),
              )
              return (
                <div
                  key={order.id}
                  className={cn(
                    'group flex min-w-0 flex-col overflow-hidden rounded-[3px] border border-black/10 bg-white shadow-none transition-[opacity,box-shadow] duration-200 ease-out hover:shadow-[0_3px_0_rgba(17,17,17,0.72)] motion-reduce:transition-none',
                    opening && opening !== order.id && 'opacity-30',
                    (done || cancelled) && 'opacity-70',
                  )}
                >
                  <div
                    className="relative aspect-[16/10] shrink-0 overflow-hidden bg-muted"
                    style={{ background: cardGradient(`${order.shelf}::${order.question}`, 'deep') }}
                  >
                    <div className="pointer-events-none absolute inset-0 bg-black/[0.03]" />
                    <div
                      className="pointer-events-none absolute inset-0 opacity-80"
                      style={{
                        backgroundImage: cardTexture(`${order.shelf}::${order.question}`),
                        backgroundPosition: 'center',
                        backgroundSize: 'cover',
                      }}
                    />

                    <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center text-white drop-shadow-[0_1px_12px_rgba(0,0,0,0.28)]">
                      <CategoryIcon
                        id={order.category}
                        className="size-9 stroke-[1.5]"
                      />
                    </div>

                    <span className="absolute bottom-3 left-3 flex items-center gap-2 text-white">
                      <span className="flex size-7 items-center justify-center overflow-hidden rounded-full border border-white/70 bg-white">
                        <Avatar config={deterministicAvatar(order.shelf)} size={24} />
                      </span>
                      <span className="max-w-[12rem] truncate text-[11px] font-medium drop-shadow-sm">
                        {order.shelf}
                      </span>
                    </span>

                    {Math.round(fitScore(order) * 100) > 0 ? (
                      <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2 py-1 font-mono text-[9px] font-medium tabular-nums text-foreground shadow-sm backdrop-blur-sm">
                        {t('Fit')} {Math.round(fitScore(order) * 100)}%
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-1 flex-col bg-white px-5 pb-4 pt-5">
                  <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[-0.01em] text-neutral-700">
                    <span>{cat?.label ? t(cat.label) : t('Open call')}</span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{relative(order.createdAt, t)}</span>
                  </div>

                  <p className="mt-4 line-clamp-3 min-h-[4.5rem] text-[17px] font-bold leading-[1.42] tracking-[-0.025em] text-neutral-950">
                    {order.question}
                  </p>

                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-black/10 pt-3.5">
                    <div className="flex items-baseline gap-1">
                      <span className="text-[15px] font-semibold tabular-nums text-foreground">
                        {order.unitPrice === 0
                          ? '₩0'
                          : `₩${order.unitPrice.toLocaleString()}`}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        {t('Per answer')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                        {order.answered}/{order.target} {t('answered')}
                      </span>
                      {reservedByOthers > 0 ? (
                        <span className="font-mono text-[9px] uppercase tracking-[1px] text-muted-foreground">
                          {reservedByOthers} {t('slots held')}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {who && hasNarrowFilters ? (
                    <p className="mt-2 line-clamp-1 font-mono text-[9px] uppercase tracking-[0.9px] text-muted-foreground/85">
                      {t('Who answers')} · {who}
                    </p>
                  ) : null}

                  <div className="mt-2 flex min-h-7 flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
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
                    ) : null}

                    {tab === 'open' && !done ? (
                      <Button
                        variant="monoGhost"
                        size="monoSm"
                        className="ml-auto -mr-2 shrink-0 px-2 font-sans normal-case tracking-normal"
                        onClick={() => {
                          if (!profile) {
                            navigate('/onboarding')
                            return
                          }
                          setPreviewOrder(order)
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
                            : <>{t('Answer')} <span aria-hidden="true">→</span></>}
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

      {previewOrder ? (
        <QuestionPreviewModal
          order={previewOrder}
          t={t}
          onClose={() => setPreviewOrder(null)}
          onStart={() => startAnswering(previewOrder)}
        />
      ) : null}
    </div>
  )
}

/**
 * The question-preview step "참여하기" opens before it commits to
 * `/answer/:id` — a hand-rolled overlay (no Dialog primitive in the app)
 * that shows the full, unclamped question plus everything the card itself
 * only summarises. Esc and a backdrop click both cancel; only "참여 시작"
 * hands off to `onStart`, which runs the existing pick-up-and-navigate flow.
 */
function QuestionPreviewModal({
  order,
  onClose,
  onStart,
  t,
}: {
  order: Order
  onClose: () => void
  onStart: () => void
  t: (en: string) => string
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const cat = CATEGORY_BY_ID[order.category]
  const who = whoAnswersLine(order, t)
  const remaining = Math.max(0, order.target - order.answered)
  const reservedByOthers = Math.max(
    0,
    (order.reservedSlots ?? 0) - (order.reservationExpiresAt ? 1 : 0),
  )

  useEffect(() => {
    panelRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      className="animate-modal-backdrop-in fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="survey-preview-question"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="animate-modal-panel-in max-h-[85vh] w-full max-w-md overflow-y-auto rounded-[10px] border border-border bg-card p-5 shadow-lg outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            {t('Survey preview')}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close')}
            className="-m-1.5 flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 flex min-w-0 items-center gap-2 overflow-hidden">
          <CategoryIcon
            id={order.category}
            className="size-3.5 shrink-0"
            style={{ color: cat?.accent ?? 'var(--muted-foreground)' }}
          />
          <span className="truncate font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            {cat?.label ? t(cat.label) : null}
          </span>
          <Badge className="min-w-0 truncate px-1.5 py-0 uppercase tracking-[1px]" title={order.shelf}>
            {order.shelf}
          </Badge>
        </div>

        {/* The full question, never clamped — the card's line-clamp-2 is
            purely a list-density concession. */}
        <h2 id="survey-preview-question" className="mt-3 text-base font-medium leading-snug text-foreground">
          {order.question}
        </h2>

        <p className="mt-3 border-t border-border/60 pt-3 font-mono text-xs text-muted-foreground">
          {t('Per answer')}{' '}
          <span className="text-foreground">
            {order.unitPrice === 0 ? '₩0' : `₩${order.unitPrice.toLocaleString()}`}
          </span>
        </p>

        {who ? (
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
            {t('Who answers')} · {who}
          </p>
        ) : null}

        <div className="mt-3 flex items-center gap-3">
          <div className="h-1 flex-1 overflow-hidden rounded-[2px] bg-foreground/10">
            <div
              className="h-full rounded-[2px] bg-[#0F766E] transition-[width] duration-500"
              style={{ width: `${Math.round((order.answered / order.target) * 100)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {order.answered}/{order.target}
            {reservedByOthers > 0 ? (
              <> · {reservedByOthers} {t('slots held')}</>
            ) : null}
          </span>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="monoGhost" size="mono" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="mono" size="mono" onClick={onStart} disabled={remaining <= 0}>
            {t('Start answering')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
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
        'flex h-11 cursor-pointer items-center gap-2 rounded-[4px] px-3 font-mono text-xs font-medium uppercase tracking-[1px] transition-colors sm:h-9',
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
        '-mb-px flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-0 text-[13px] tracking-[-0.006em] transition-colors',
        active
          ? 'border-foreground font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground',
        count === 0 && !active && 'opacity-40',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
        {count}
      </span>
    </button>
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
