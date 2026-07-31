import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Badge,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/primitives'
import { CATEGORIES, SHELVES, type Shelf as ShelfType } from '@/data/shelf'
import { cn } from '@/lib/utils'
import { useUi } from '@/state/ui'

/**
 * The shelves. A browsable view of the database SHELF-1 searches.
 * No plan locks a shelf — Free and Team see exactly the same stacks.
 */
export default function Shelf() {
  const [selected, setSelected] = useState<string[]>(CATEGORIES)

  const visible = useMemo(
    () => SHELVES.filter((s) => selected.includes(s.category)),
    [selected],
  )

  const toggle = (cat: string) =>
    setSelected((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )

  const totalMd = visible.reduce((sum, s) => sum + s.mdCount, 0)

  return (
    <div className="page-enter flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 sm:p-6">
        <div className="flex min-h-8 items-center justify-between gap-4">
          <h1 className="font-sans text-base font-medium">Shelves</h1>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 cursor-pointer items-center gap-2 rounded-[2px] bg-muted-2 px-3 font-mono text-xs font-medium uppercase tracking-[1px] text-foreground transition-colors hover:bg-muted"
              >
                Category
                <Badge>{selected.length}</Badge>
                <ChevronDown className="size-3.5 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Category</DropdownMenuLabel>
              {CATEGORIES.map((cat) => (
                <DropdownMenuCheckboxItem
                  key={cat}
                  checked={selected.includes(cat)}
                  onCheckedChange={() => toggle(cat)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {cat}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div>
          <div className="relative mb-6 overflow-hidden rounded-lg border border-foreground/[0.06] px-6 py-16">
            <div className="absolute inset-0 bg-gradient-to-b from-[#F2F2F4] to-[#B9D65C]/80" />
            <div className="relative flex flex-col items-center gap-6 text-center">
              <div className="flex items-center gap-3">
                {visible.slice(0, 4).map((s) => (
                  <div
                    key={s.id}
                    className="flex size-12 items-center justify-center rounded-[2px] border border-foreground/10 font-mono text-sm font-semibold"
                    style={{ backgroundColor: s.accent }}
                  >
                    {s.name.slice(0, 2)}
                  </div>
                ))}
              </div>
              <h2 className="font-display text-2xl font-medium text-foreground">
                {visible.length} shelves · {totalMd.toLocaleString()} documents
              </h2>
              <p className="max-w-md text-sm leading-relaxed text-foreground/70">
                No plan locks a shelf. Free and Team see the same stacks. The
                only difference is how many opens are included each month.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {visible.map((shelf) => (
              <ShelfCard key={shelf.id} shelf={shelf} />
            ))}
          </div>

          {visible.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              No shelves in the selected categories.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ShelfCard({ shelf }: { shelf: ShelfType }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const { createChat } = useUi()

  return (
    <div className="rounded-[6px] border border-border bg-card p-5">
      <Badge className="px-1.5 py-0 uppercase tracking-[1px]">
        {shelf.category}
      </Badge>

      <div className="mt-3 flex items-center gap-2.5">
        <div className="flex size-11 shrink-0 items-center justify-center">
          <div
            className="flex size-9 items-center justify-center rounded-[4px] font-mono text-sm font-semibold"
            style={{ backgroundColor: shelf.accent }}
          >
            {shelf.name.slice(0, 2)}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-lg font-medium leading-tight">{shelf.name}</div>
          <div className="mt-0.5 font-mono text-xs uppercase tracking-[0.5px] text-muted-foreground">
            {shelf.mdCount.toLocaleString()} docs · {' '}
            ₩{shelf.avgPrice.toLocaleString()} each · {shelf.openRate} useful
          </div>
        </div>
      </div>

      <div className="relative">
        <div
          className="overflow-hidden transition-[max-height] duration-300 ease-out"
          style={{ maxHeight: expanded ? 900 : 200 }}
        >
          <p className="mt-4 text-base leading-relaxed text-foreground">
            {shelf.summary}
          </p>
          <div className="mt-5">
            <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              Passages from this shelf
            </span>
            <ul className="mt-3 flex flex-col gap-2">
              {shelf.excerpts.map((excerpt) => (
                <li
                  key={excerpt}
                  className="flex gap-2.5 text-sm leading-relaxed text-foreground/80"
                >
                  <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground/50" />
                  <span>“{excerpt}”</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        {expanded ? null : (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex cursor-pointer items-center gap-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {expanded ? 'Collapse' : 'Expand'}
          <ChevronDown
            className={cn(
              'size-3 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </button>
        <Button
          variant="monoGhost"
          size="monoSm"
          className="ml-auto"
          onClick={() =>
            navigate(
              `/chat/${createChat(`I have a question for the ${shelf.name} shelf. ${shelf.summary}`)}`,
            )
          }
        >
          Ask this shelf
        </Button>
      </div>
    </div>
  )
}
