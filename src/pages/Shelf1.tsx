import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { FlowDiagram } from '@/components/article/FlowDiagram'
import { Composer } from '@/components/Composer'
import { Button } from '@/components/ui/button'
import {
  DEFINITION,
  HERO,
  LIFECYCLE,
  OPEN_PROBLEMS,
  SECTIONS,
  type Block,
  type OpenProblem,
} from '@/data/shelf1'
import { cn } from '@/lib/utils'

/**
 * The SHELF-1 page, laid out as our own document rather than a wall of prose:
 * numbered sections with mono eyebrows, a section rail that tracks scroll, the
 * flow diagram where the branch is explained, and the open problems left as
 * status cards instead of being buried in a paragraph.
 */
export default function Shelf1() {
  const [shared, setShared] = useState(false)
  const [active, setActive] = useState(SECTIONS[0].n)

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top?.target.id) setActive(top.target.id.replace('sec-', ''))
      },
      { rootMargin: '-20% 0px -70% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(`sec-${s.n}`)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])

  const share = async () => {
    const url = window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title: HERO.title, url })
        return
      } catch {
        /* dismissed — fall through to clipboard */
      }
    }
    await navigator.clipboard?.writeText(url)
    setShared(true)
    window.setTimeout(() => setShared(false), 1600)
  }

  return (
    <div className="page-enter flex-1 overflow-y-auto scroll-smooth">
      {/* Masthead ---------------------------------------------------- */}
      <header className="relative border-b border-border">
        <div className="relative mx-auto w-full max-w-5xl px-5 pb-14 pt-24 sm:px-8 sm:pb-20 sm:pt-32">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[2px] text-muted-foreground">
              {HERO.eyebrow}
            </span>
            <span className="h-px flex-1 bg-border" />
            <Button
              type="button"
              variant="monoGhost"
              size="monoSm"
              onClick={share}
            >
              {shared ? 'Link copied' : 'Share'}
            </Button>
          </div>

          <h1 className="mt-6 max-w-3xl font-display text-[32px] font-semibold leading-[1.14] tracking-tight sm:text-[44px]">
            {HERO.title}
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-8 text-muted-foreground">
            {HERO.standfirst}
          </p>

          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-3 border-t border-border pt-5 font-mono text-[11px] uppercase tracking-[1px]">
            {HERO.meta.map((m) => (
              <div key={m.label} className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">{m.label}</dt>
                <dd className="text-foreground">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {/* Definition strip -------------------------------------------- */}
      <div className="border-b border-border bg-foreground text-background">
        <div className="mx-auto w-full max-w-5xl px-5 py-9 sm:px-8">
          <span className="font-mono text-[10px] uppercase tracking-[2px] opacity-60">
            The whole thing, in one line
          </span>
          <p className="mt-3 font-display text-2xl font-medium leading-snug sm:text-[29px]">
            {DEFINITION}
          </p>
        </div>
      </div>

      {/* Body + rail -------------------------------------------------- */}
      <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[168px_1fr] lg:gap-16">
          <nav className="hidden lg:block">
            <div className="sticky top-10 flex flex-col gap-1">
              <span className="mb-3 font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                Contents
              </span>
              {SECTIONS.map((s) => (
                <a
                  key={s.n}
                  href={`#sec-${s.n}`}
                  className={cn(
                    'flex items-baseline gap-2.5 rounded-[3px] py-1.5 pl-2 text-[13px] leading-snug transition-colors',
                    active === s.n
                      ? 'bg-foreground/[0.06] text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="font-mono text-[10px] tabular-nums opacity-60">
                    {s.n}
                  </span>
                  {s.eyebrow}
                </a>
              ))}
            </div>
          </nav>

          <div className="min-w-0">
            {SECTIONS.map((section) => (
              <section
                key={section.n}
                id={`sec-${section.n}`}
                className="scroll-mt-10 border-t border-border pb-16 pt-10 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    {section.n}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                    {section.eyebrow}
                  </span>
                </div>
                <h2 className="mt-4 max-w-2xl font-display text-[25px] font-medium leading-[1.28] tracking-tight sm:text-[29px]">
                  {section.title}
                </h2>

                <div className="mt-7 flex flex-col gap-6">
                  {section.blocks.map((b, i) => (
                    <BlockView key={i} block={b} />
                  ))}
                </div>

                {/* The branch section carries the diagram and the table. */}
                {section.n === '03' ? (
                  <>
                    <FlowDiagram className="mt-10" />
                    <Lifecycle />
                  </>
                ) : null}

                {section.n === '06' ? <OpenProblems /> : null}
              </section>
            ))}

            <div className="border-t border-border pt-10">
              <p className="text-[15px] leading-8 text-muted-foreground">
                The shelves are being filled now. Ask something, and if nothing
                on them fits, commission it — that call becomes the next
                person's answer.
              </p>
              <div className="mt-6 max-w-xl">
                <Composer variant="flat" />
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button asChild variant="mono" size="mono">
                  <Link to="/shelf">Browse the shelves</Link>
                </Button>
                <Button asChild variant="monoMuted" size="mono">
                  <Link to="/pricing">See per-open pricing</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- blocks */

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case 'lead':
      return (
        <p className="text-[19px] leading-9 text-foreground">{block.text}</p>
      )
    case 'p':
      return (
        <p className="text-[16px] leading-8 text-foreground/90">{block.text}</p>
      )
    case 'quote':
      return (
        <blockquote className="my-2 border-l-2 border-[#866FF2] pl-5">
          <p className="font-display text-xl font-medium leading-8 text-foreground sm:text-[22px]">
            {block.text}
          </p>
          {block.attribution ? (
            <cite className="mt-2 block font-mono text-[10px] uppercase not-italic tracking-[1px] text-muted-foreground">
              {block.attribution}
            </cite>
          ) : null}
        </blockquote>
      )
    case 'list':
      return (
        <ol
          className={cn(
            'flex flex-col gap-3 text-[16px] leading-8 text-foreground/90',
            block.ordered ? 'list-none' : 'list-none',
          )}
        >
          {block.items.map((item, i) => (
            <li key={item} className="flex gap-3.5">
              <span
                className={cn(
                  'shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground',
                  block.ordered ? 'mt-2' : 'mt-3.5',
                )}
              >
                {block.ordered ? (
                  String(i + 1).padStart(2, '0')
                ) : (
                  <span className="block size-1 rounded-full bg-muted-foreground/50" />
                )}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      )
    case 'note':
      return (
        <aside className="rounded-[6px] border border-border bg-foreground/[0.03] p-5">
          <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
            {block.label}
          </span>
          <p className="mt-2 text-[15px] leading-7 text-foreground/90">
            {block.text}
          </p>
        </aside>
      )
    case 'code':
      return (
        <figure className="overflow-hidden rounded-[6px] border border-border">
          <figcaption className="border-b border-border bg-muted-2 px-4 py-2 font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
            {block.caption}
          </figcaption>
          <pre className="overflow-x-auto bg-card px-4 py-4 font-mono text-[13px] leading-[1.85] text-foreground">
            {block.lines.join('\n')}
          </pre>
        </figure>
      )
    case 'compare':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {[block.left, block.right].map((side, i) => (
            <div
              key={side.label}
              className={cn(
                'flex flex-col rounded-[6px] border p-5',
                i === 0
                  ? 'border-border bg-card'
                  : 'border-[#866FF2]/30 bg-[#866FF2]/[0.05]',
              )}
            >
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                {side.label}
              </span>
              <span className="mt-2 text-[15px] font-medium">{side.title}</span>
              <ul className="mt-3 flex flex-col gap-2">
                {side.lines.map((l) => (
                  <li
                    key={l}
                    className="flex gap-2.5 text-[13px] leading-relaxed text-foreground/80"
                  >
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                    <span>{l}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )
  }
}

/* ------------------------------------------------------------- fragments */

function Lifecycle() {
  return (
    <div className="mt-10 overflow-hidden rounded-[6px] border border-border">
      <div className="border-b border-border bg-muted-2 px-4 py-2 font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
        One question, end to end
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <tbody>
          {LIFECYCLE.map((s) => (
            <tr
              key={s.n}
              className={cn(
                'border-b border-border/60 last:border-0',
                s.pivot && 'bg-[#866FF2]/[0.06]',
              )}
            >
              <td className="w-12 px-4 py-3 align-top font-mono text-xs tabular-nums text-muted-foreground">
                {String(s.n).padStart(2, '0')}
              </td>
              <td className="w-[190px] px-2 py-3 align-top font-medium">
                {s.step}
              </td>
              <td className="px-4 py-3 align-top text-foreground/80">
                {s.what}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STATUS_TONE: Record<OpenProblem['status'], string> = {
  Critical: 'bg-destructive/10 text-destructive',
  Open: 'bg-[#866FF2]/12 text-[#5B44C7]',
  Next: 'bg-foreground/10 text-foreground',
}

function OpenProblems() {
  return (
    <div className="mt-8 flex flex-col gap-3">
      {OPEN_PROBLEMS.map((p) => (
        <div
          key={p.title}
          className="rounded-[6px] border border-border bg-card p-5"
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={cn(
                'rounded-[2px] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[1px]',
                STATUS_TONE[p.status],
              )}
            >
              {p.status}
            </span>
            <span className="text-[15px] font-medium">{p.title}</span>
          </div>
          <p className="mt-2.5 text-[15px] leading-7 text-foreground/85">
            {p.body}
          </p>
        </div>
      ))}
      <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
        Written down rather than smoothed over
        <ArrowUpRight className="size-3" />
      </p>
    </div>
  )
}
