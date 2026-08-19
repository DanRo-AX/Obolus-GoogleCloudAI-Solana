import { FieldsSection } from '@/components/landing/FieldsSection'
import { Hero } from '@/components/landing/Hero'
import { SettlementSection } from '@/components/landing/SettlementSection'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { ThesisSection } from '@/components/landing/ThesisSection'
import { TrustSection } from '@/components/landing/TrustSection'
import { TwoSidesSection } from '@/components/landing/TwoSidesSection'

/**
 * The landing.
 *
 * Earlier passes argued the product like a whitepaper — a numbered rail, a
 * paragraph under every heading, a survey-comparison table, a full FAQ. It read
 * like an essay. This one is a product landing: one confident line per section,
 * a lot of air between them, and the few things worth looking at — the vivid
 * comparison, the live board, the receipt — given room to be the focus.
 *
 * Each section carries its own layout so scrolling changes shape; a generous
 * vertical cadence and full-bleed rules are what hold it together.
 */
export default function Home() {
  return (
    <div className="relative h-full flex-1">
      <div className="page-enter h-full overflow-y-auto scroll-smooth">
        <Hero />
        <ThesisSection />
        <TwoSidesSection />

        <section className="border-t border-border py-28 sm:py-40">
          <div className="mx-auto max-w-[92rem]">
            <FieldsSection />
          </div>
        </section>

        <SettlementSection />
        <TrustSection />
        <SiteFooter />
      </div>
    </div>
  )
}
