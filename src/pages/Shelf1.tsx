import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FlowDiagram } from '@/components/article/FlowDiagram'
import { Composer } from '@/components/Composer'
import { Button } from '@/components/ui/button'
import { DEFINITION, HERO, LIFECYCLE, SECTIONS, type Block } from '@/data/shelf1'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

/**
 * The SHELF page, laid out as our own document rather than a wall of prose:
 * numbered sections with mono eyebrows, a section rail that tracks scroll, the
 * flow diagram where the branch is explained, and the open problems left as
 * status cards instead of being buried in a paragraph.
 */
export default function Shelf1() {
  const t = useT()
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
        await navigator.share({ title: t(HERO.title), url })
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
              {t(HERO.eyebrow)}
            </span>
            <span className="h-px flex-1 bg-border" />
            <Button
              type="button"
              variant="monoGhost"
              size="monoSm"
              onClick={share}
            >
              {shared ? t('Link copied') : t('Share')}
            </Button>
          </div>

          <h1 className="mt-6 max-w-3xl font-display text-[32px] font-semibold leading-[1.14] tracking-tight sm:text-[44px]">
            {t(HERO.title)}
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-8 text-muted-foreground">
            {t(HERO.standfirst)}
          </p>

          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-3 border-t border-border pt-5 font-mono text-[11px] uppercase tracking-[1px]">
            {HERO.meta.map((m) => (
              <div key={m.label} className="flex items-baseline gap-2">
                <dt className="text-muted-foreground">{t(m.label)}</dt>
                <dd className="text-foreground">{t(m.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {/* Definition strip -------------------------------------------- */}
      <div className="border-b border-border bg-foreground text-background">
        <div className="mx-auto w-full max-w-5xl px-5 py-9 sm:px-8">
          <span className="font-mono text-[10px] uppercase tracking-[2px] opacity-60">
            {t('In one line')}
          </span>
          <p className="mt-3 font-display text-2xl font-medium leading-snug sm:text-[29px]">
            {t(DEFINITION)}
          </p>
        </div>
      </div>

      {/* Body + rail -------------------------------------------------- */}
      <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="grid gap-12 lg:grid-cols-[168px_1fr] lg:gap-16">
          <nav className="hidden lg:block">
            <div className="sticky top-10 flex flex-col gap-1">
              <span className="mb-3 font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
                {t('Sections')}
              </span>
              {SECTIONS.map((s) => (
                <a
                  key={s.n}
                  href={`#sec-${s.n}`}
                  className={cn(
                    'flex items-baseline gap-2.5 rounded-[2px] px-2.5 py-2 text-[13px] leading-snug transition-colors',
                    active === s.n
                      ? 'bg-black text-white'
                      : 'text-muted-foreground hover:bg-black/[0.04] hover:text-foreground',
                  )}
                >
                  <span className="font-mono text-[10px] tabular-nums opacity-60">
                    {s.n}
                  </span>
                  {t(s.eyebrow)}
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
                    {t(section.eyebrow)}
                  </span>
                </div>
                <h2 className="mt-4 max-w-2xl font-display text-[25px] font-medium leading-[1.28] tracking-tight sm:text-[29px]">
                  {t(section.title)}
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
              </section>
            ))}

            <div className="border-t border-border pt-10">
              <p className="text-[15px] leading-8 text-muted-foreground">
                {t(
                  'The shelves are being filled now. Ask something. If nothing on them fits, post an open call and name what one answer is worth.',
                )}
              </p>
              <div className="mt-6 max-w-xl">
                <Composer variant="flat" />
              </div>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button asChild variant="mono" size="mono">
                  <Link to="/coverage">{t('See the thin shelves')}</Link>
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
  const t = useT()

  switch (block.kind) {
    case 'lead':
      return (
        <p className="text-[19px] leading-9 text-foreground">{t(block.text)}</p>
      )
    case 'p':
      return (
        <p className="text-[16px] leading-8 text-foreground/90">
          {t(block.text)}
        </p>
      )
    case 'quote':
      return (
        <blockquote className="my-2 rounded-[2px] bg-[#080808] px-6 py-7 text-white sm:px-7 sm:py-8">
          <p className="max-w-2xl font-display text-xl font-medium leading-8 text-white sm:text-[22px]">
            {t(block.text)}
          </p>
          {block.attribution ? (
            <cite className="mt-3 block font-mono text-[10px] uppercase not-italic tracking-[1px] text-white/45">
              {t(block.attribution)}
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
              <span>{t(item)}</span>
            </li>
          ))}
        </ol>
      )
    case 'note':
      return (
        <aside className="rounded-[2px] bg-[#080808] px-6 py-6 text-white sm:px-7 sm:py-7">
          {block.label ? (
            <span className="font-mono text-[10px] uppercase tracking-[1.6px] text-white/45">
              {t(block.label)}
            </span>
          ) : null}
          <p className={cn('max-w-3xl leading-8 text-white/88', block.label ? 'mt-3 text-[16px]' : 'text-[18px]')}>
            {t(block.text)}
          </p>
        </aside>
      )
    case 'code':
      return (
        <figure className="overflow-hidden rounded-[9px] border border-black/80 bg-[#111214] text-white shadow-[0_18px_45px_rgba(0,0,0,0.22)] ring-1 ring-white/5">
          <figcaption className="relative flex h-10 items-center border-b border-white/10 bg-[#202124] px-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <span className="flex gap-2" aria-hidden="true">
              <span className="size-2.5 rounded-full bg-[#ff5f57]" />
              <span className="size-2.5 rounded-full bg-[#febc2e]" />
              <span className="size-2.5 rounded-full bg-[#28c840]" />
            </span>
            <span className="absolute inset-x-16 text-center font-mono text-[10px] tracking-[0.8px] text-white/45">
              {t(block.caption)}
            </span>
          </figcaption>
          <div className="overflow-x-auto bg-[linear-gradient(180deg,#121315_0%,#0d0e10_100%)] px-5 py-5 font-mono text-[13px] leading-[1.9] text-white/88">
            <div className="mb-2 flex min-w-max gap-2 text-white/42">
              <span>obulus@agent</span>
              <span className="text-white/22">~/research</span>
            </div>
            {block.lines.map((line, index) => (
              <div key={`${line}-${index}`} className="flex min-w-max gap-3">
                <span className={cn('select-none', index === 0 ? 'text-[#74dba5]' : 'text-white/24')}>
                  {index === 0 ? '$' : '›'}
                </span>
                <span className={index === 0 ? 'text-white' : 'text-white/72'}>{t(line)}</span>
              </div>
            ))}
            <div className="mt-1 flex items-center gap-3 text-[#74dba5]">
              <span>$</span>
              <span className="h-[1.05em] w-[7px] animate-pulse bg-white/72 motion-reduce:animate-none" />
            </div>
          </div>
        </figure>
      )
    case 'compare':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          {[block.left, block.right].map((side, i) => (
            <div
              key={side.label}
              className={cn(
                'flex flex-col overflow-hidden rounded-[2px] bg-[#080808] p-6 text-white',
                i === 1 && 'shadow-[inset_3px_0_0_rgba(255,255,255,0.75)]',
              )}
            >
              <span className="font-mono text-[10px] uppercase tracking-[1.5px] text-white/45">
                {t(side.label)}
              </span>
              <span className="mt-3 text-[16px] font-semibold text-white">
                {t(side.title)}
              </span>
              <ul className="mt-3 flex flex-col gap-2">
                {side.lines.map((l) => (
                  <li
                    key={l}
                    className="flex gap-2.5 text-[13px] leading-relaxed text-white/72"
                  >
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-white/45" />
                    <span>{t(l)}</span>
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
  const t = useT()

  return (
    <div className="mt-12">
      <div className="border-b border-foreground/70 pb-4 font-mono text-[10px] uppercase tracking-[1.5px] text-muted-foreground">
        {t('One question, end to end')}
      </div>
      <table className="w-full border-collapse text-left text-sm">
        <tbody>
          {LIFECYCLE.map((s) => (
            <tr
              key={s.n}
              className={cn(
                'border-b border-border',
                s.pivot && 'bg-[#866FF2]/[0.025]',
              )}
            >
              <td className="w-14 py-6 pr-4 align-top font-mono text-xs tabular-nums text-muted-foreground">
                {String(s.n).padStart(2, '0')}
              </td>
              <td className="w-[27%] py-6 pr-8 align-top text-[15px] font-semibold">
                {t(s.step)}
              </td>
              <td className="py-6 align-top text-[15px] leading-7 text-foreground/72">
                {t(s.what)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
