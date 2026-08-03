import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/primitives'
import type { Faq } from '@/data/faq'
import { useT } from '@/i18n'
import { cn } from '@/lib/utils'

export function FaqSection({
  items,
  title = 'Frequently asked questions',
  className,
}: {
  items: Faq[]
  title?: string
  className?: string
}) {
  const t = useT()
  return (
    <section className={cn('px-5 py-20 sm:px-8 sm:py-32 lg:px-12', className)}>
      <div className="mx-auto max-w-2xl">
        <h2 className="font-inter text-xl font-medium">{t(title)}</h2>
        <Accordion type="single" collapsible className="mt-8">
          {items.map((f, i) => (
            <AccordionItem key={f.q} value={`item-${i}`}>
              <AccordionTrigger>
                <span className="rounded-[2px] px-1 py-0.5 font-sans text-base font-medium transition-colors group-hover:bg-foreground/5">
                  {t(f.q)}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {t(f.a).split('\n\n').map((p, k) => (
                  <p
                    key={k}
                    className={cn(
                      'text-[15px] leading-7 text-muted-foreground',
                      k > 0 && 'mt-3',
                    )}
                  >
                    {p}
                  </p>
                ))}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
