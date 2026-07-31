import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
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
  const ref = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const { createChat } = useUi()
  const dark = tone === 'dark'

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${Math.min(320, el.scrollHeight)}px`
  }, [value])

  const submit = () => {
    const text = value.trim()
    if (!text) return
    const id = createChat(text)
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
      <textarea
        ref={ref}
        rows={3}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder="What do you want to know?"
        className={cn(
          'flex w-full py-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 max-h-80 min-h-[88px] resize-none overflow-y-hidden rounded-none border-0 bg-transparent px-4 pb-0 pt-3 text-base shadow-none focus-visible:ring-0 md:text-base',
          dark
            ? 'text-white placeholder:text-white/45'
            : 'border-input placeholder:text-muted-foreground',
        )}
      />
      <div className="flex items-center justify-between px-2.5 pb-2.5 pt-1">
        <Link
          to="/whitepaper"
          aria-label="SHELF-1 model"
          className={cn(
            'group flex h-8 items-center rounded-[2px] px-2 transition-colors',
            dark ? 'hover:bg-white/10' : 'hover:bg-muted-foreground/10',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'font-mono text-[11px] font-semibold uppercase tracking-[1.5px]',
              dark ? 'text-white/80' : 'text-foreground/80',
            )}
          >
            SHELF-1
          </span>
        </Link>
        <button
          data-slot="button"
          type="submit"
          disabled={!value.trim()}
          aria-label="Send"
          className={cn(
            'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all cursor-pointer disabled:pointer-events-none disabled:opacity-50 shrink-0 outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px] size-8 rounded-md',
            dark
              ? 'bg-[#e5e5e5] text-[#171717] hover:bg-white'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </form>
  )
}
