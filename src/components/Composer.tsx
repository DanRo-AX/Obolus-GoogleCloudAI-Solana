import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ArrowUp, ChevronDown } from 'lucide-react'
import { CATEGORIES, type CategoryId } from '@/data/categories'
import { AGE_BANDS, HOUSEHOLDS, REGIONS } from '@/data/onboarding'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'
import type { TargetFilters } from '@/lib/api'
import { useUi } from '@/state/ui'

/**
 * The message box. Auto-grows with content, submits on Enter (Shift+Enter for a
 * newline), and starts a chat — the same affordances the original exposes.
 *
 * `tone="dark"` is the treatment the original applies over its dark canvases
 * (#1C1C1D glass, light text, inverted send button); the hero uses it because
 * the starfield sits behind it.
 */
export function Composer({
  className,
  variant = 'floating',
  tone = 'light',
  autoFocus,
  initialValue = '',
  onSubmitted,
}: {
  className?: string
  variant?: 'floating' | 'flat'
  tone?: 'light' | 'dark'
  autoFocus?: boolean
  initialValue?: string
  onSubmitted?: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const [ageBand, setAgeBand] = useState('')
  const [region, setRegion] = useState('')
  const [household, setHousehold] = useState('')
  const [field, setField] = useState<CategoryId | ''>('')
  const ref = useRef<HTMLTextAreaElement>(null)
  const composingRef = useRef(false)
  const navigate = useNavigate()
  const { createChat } = useUi()
  const t = useT()
  const dark = tone === 'dark'

  // "Who answers" targeting: a controlled dropdown that opens downward. It is
  // portaled to the body and positioned under its trigger so a parent with
  // overflow-hidden (the hero canvas) never clips it.
  const [targetOpen, setTargetOpen] = useState(false)
  const [targetRect, setTargetRect] = useState<{
    left: number
    top: number
    width: number
  } | null>(null)
  const targetBtnRef = useRef<HTMLButtonElement>(null)
  const targetPanelRef = useRef<HTMLDivElement>(null)
  const activeBands = [ageBand, region, household, field].filter(Boolean).length

  const positionTarget = () => {
    const el = targetBtnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTargetRect({ left: r.left, top: r.bottom + 8, width: 280 })
  }

  const openTarget = () => {
    positionTarget()
    setTargetOpen(true)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(320, el.scrollHeight)}px`
  }, [value])

  useEffect(() => {
    if (!targetOpen) return
    const close = () => setTargetOpen(false)
    const onPointerDown = (e: PointerEvent) => {
      const node = e.target as Node
      if (
        targetBtnRef.current?.contains(node) ||
        targetPanelRef.current?.contains(node)
      ) {
        return
      }
      setTargetOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTargetOpen(false)
    }
    // Close on scroll/resize rather than chase the trigger — a fixed panel that
    // trails a scrolled-away button reads worse than a clean dismiss. Capture
    // phase catches the app's nested scroll containers, not just the window.
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [targetOpen])

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const filters: TargetFilters = {
      ...(ageBand ? { ageBand } : {}),
      ...(region ? { region } : {}),
      ...(household ? { household } : {}),
      ...(field ? { field } : {}),
    }
    const id = createChat(text, filters)
    setValue('')
    onSubmitted?.()
    navigate(`/chat/${id}`)
  }

  return (
    <form
      className={cn(
        'flex w-full flex-col rounded-sm ring-offset-background focus-within:ring-1',
        dark
          ? 'border border-[#262626] bg-[#1C1C1D]/70 backdrop-blur-md focus-within:ring-[#3C3E5E]'
          : variant === 'floating'
            ? 'border border-border/60 bg-card/55 backdrop-blur-md focus-within:ring-[#C9D7F4]'
            : 'bg-muted/50 focus-within:ring-[#C9D7F4]',
        className,
      )}
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      {/* who is answering, stated once at the top ---------------------- */}
      <div className="flex items-center gap-2 px-4 pt-3">
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-[1px]"
          style={{ backgroundColor: '#866FF2' }}
        />
        <span
          className={cn(
            'font-mono text-[10px] font-semibold uppercase tracking-[1.5px]',
            dark ? 'text-white/55' : 'text-muted-foreground',
          )}
        >
          SHELF
        </span>
      </div>

      <textarea
        ref={ref}
        rows={3}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          // Commit the finalized value once the IME closes composition, so the
          // controlled value ends the frame in sync with the DOM.
          setValue(e.currentTarget.value)
        }}
        onKeyDown={(e) => {
          // The Enter that closes a Hangul composition arrives as an
          // isComposing/229 keydown. Submitting there re-inserts the last
          // syllable (안녕 → 안녕녕) and sends mid-composition — let the IME
          // finish first, then a real Enter submits.
          if (e.nativeEvent.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={t('What do you want to know?')}
        className={cn(
          'flex w-full focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-h-80 min-h-[72px] resize-none overflow-y-hidden rounded-none border-0 bg-transparent px-4 pb-2 pt-2 text-base shadow-none focus-visible:ring-0 md:text-base',
          dark
            ? 'text-white placeholder:text-white/45'
            : 'border-input placeholder:text-muted-foreground',
        )}
      />

      {/* the tray: the one control, the send, and the fine print -------- */}
      <div
        className={cn(
          'flex flex-col border-t',
          dark ? 'border-white/10 bg-black/20' : 'border-border/60 bg-muted/30',
        )}
      >
        <div className="flex items-center justify-between gap-3 px-2.5 py-2">
          <div className="flex items-center gap-1">
            <button
              ref={targetBtnRef}
              type="button"
              onClick={() => (targetOpen ? setTargetOpen(false) : openTarget())}
              aria-haspopup="true"
              aria-expanded={targetOpen}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-1.5 rounded-[3px] border px-2.5 font-mono text-[11px] uppercase tracking-[1px] transition-colors sm:h-8',
                dark
                  ? 'border-white/15 text-white/60 hover:border-white/35 hover:text-white'
                  : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                targetOpen &&
                  (dark
                    ? 'border-white/35 text-white'
                    : 'border-foreground/30 text-foreground'),
              )}
            >
              {t('Who answers')}
              {activeBands ? ` · ${activeBands}` : ''}
              <ChevronDown
                className={cn(
                  'size-3 transition-transform duration-200 motion-reduce:transition-none',
                  targetOpen && 'rotate-180',
                )}
              />
            </button>
            {targetOpen && targetRect
              ? createPortal(
                  <div
                    ref={targetPanelRef}
                    role="dialog"
                    className="animate-modal-panel-in fixed z-50 grid gap-3 rounded-[8px] border border-white/10 bg-primary p-3 text-primary-foreground shadow-xl shadow-black/40"
                    style={{
                      left: targetRect.left,
                      top: targetRect.top,
                      width: targetRect.width,
                    }}
                  >
                    <p className="text-xs leading-relaxed text-primary-foreground/55">
                      {t('Optional. A document must match every band you pick.')}
                    </p>
                    <TargetSelect label="Age" value={ageBand} onChange={setAgeBand} options={AGE_BANDS} />
                    <TargetSelect label="Region" value={region} onChange={setRegion} options={REGIONS} />
                    <TargetSelect label="Household" value={household} onChange={setHousehold} options={HOUSEHOLDS} />
                    <TargetSelect
                      label="Field"
                      value={field}
                      onChange={(value) => setField(value as CategoryId | '')}
                      options={CATEGORIES.map(({ id, label }) => ({ value: id, label }))}
                    />
                  </div>,
                  document.body,
                )
              : null}
          </div>
          <button
            data-slot="button"
            type="submit"
            disabled={!value.trim()}
            aria-label={t('Send')}
            className={cn(
              'inline-flex size-11 shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 sm:size-8',
              dark
                ? 'bg-[#e5e5e5] text-[#171717] hover:bg-white'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            <ArrowUp className="size-4" />
          </button>
        </div>

        <p
          className={cn(
            'border-t px-4 py-2.5 font-mono text-[10px] leading-[1.55] tracking-[0.2px]',
            dark
              ? 'border-white/[0.06] text-white/30'
              : 'border-border/40 text-muted-foreground/70',
          )}
        >
          {t(
            'If human coverage is thin, this question alone may be sent to Gemini on Vertex AI for a free general baseline. Private shelf passages are never sent.',
          )}
        </p>
      </div>
    </form>
  )
}

function TargetSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  const t = useT()
  return (
    <label className="grid gap-1 font-mono text-[11px] uppercase tracking-[1px] text-primary-foreground/55">
      {t(label)}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 rounded-[3px] border border-white/15 bg-white/[0.04] px-2 text-sm normal-case tracking-normal text-primary-foreground sm:h-9 sm:text-xs"
      >
        <option value="" className="bg-primary text-primary-foreground">
          {t('Any')}
        </option>
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            className="bg-primary text-primary-foreground"
          >
            {t(option.label)}
          </option>
        ))}
      </select>
    </label>
  )
}
