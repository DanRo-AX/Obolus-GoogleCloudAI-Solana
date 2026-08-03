import { FaqSection } from '@/components/FaqSection'
import { FieldsSection } from '@/components/landing/FieldsSection'
import { Hero } from '@/components/landing/Hero'
import { NotASurveySection } from '@/components/landing/NotASurveySection'
import { SettlementSection } from '@/components/landing/SettlementSection'
import { SiteFooter } from '@/components/landing/SiteFooter'
import { ThesisSection } from '@/components/landing/ThesisSection'
import { TrustSection } from '@/components/landing/TrustSection'
import { TwoSidesSection } from '@/components/landing/TwoSidesSection'
import { HOME_FAQ } from '@/data/faq'

/**
 * The landing.
 *
 * The previous version borrowed a numbered-section rail from the whitepaper,
 * which made a marketing page read like a spec and — more to the point — read
 * like the site it was cloned from. This one argues instead: state the gap,
 * split the market in two, name the category it will be filed under anyway,
 * show the live board, show the receipt, then state the terms.
 *
 * Each section carries its own layout rather than a shared frame, so scrolling
 * changes shape. Full-bleed rules and mono eyebrows are what hold it together.
 */
export default function Home() {
  return (
    <div className="relative h-full flex-1">
      <div className="page-enter h-full overflow-y-auto scroll-smooth">
        <Hero />
        <ThesisSection />
        <TwoSidesSection />
        <NotASurveySection />

        <section className="border-t border-border py-20 sm:py-28">
          <div className="mx-auto max-w-[92rem]">
            <FieldsSection />
          </div>
        </section>

        <SettlementSection />
        <TrustSection />

        <div className="border-t border-border px-4 sm:px-8">
          <div className="mx-auto max-w-[92rem]">
            <FaqSection items={HOME_FAQ} className="px-0 py-20 sm:px-0" />
          </div>
        </div>

        <SiteFooter />
      </div>
    </div>
  )
}
