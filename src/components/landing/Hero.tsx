import { Composer } from '@/components/Composer'
import { GlitterWrap } from '@/components/GlitterWrap'
import { useT } from '@/i18n'

/**
 * Full-bleed hero. GlitterWrap's stars draw additively, so the panel carries a
 * deep base colour for them to read against; the heading sits in
 * mix-blend-difference and stays white over it, and the composer switches to the
 * dark glass treatment the site's other dark canvases use.
 */
export function Hero() {
  const t = useT()
  return (
    <section className="mt-6 h-[74svh] p-4 pb-0 sm:mt-8 sm:p-6 sm:pb-0">
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-8 overflow-hidden rounded-lg border border-transparent px-4">
        <div className="absolute inset-0">
          <GlitterWrap style={{ backgroundColor: '#08070F' }} />
        </div>

        <div className="relative flex size-14 items-center justify-center rounded-[16px] bg-background">
          <img src="/OBOLUS-MARK.svg" alt="Obolus" width={30} height={30} />
        </div>

        <div className="relative -mt-2 mx-auto max-w-3xl text-center mix-blend-difference">
          <h1 className="text-balance font-display text-[38px] font-semibold leading-[1.08] tracking-[-0.01em] text-white sm:text-[62px]">
            {t('Turn the internet into a database')}
          </h1>
          <p className="mx-auto mt-5 max-w-md text-pretty text-[17px] font-medium text-white/80 sm:text-[19px]">
            {t('Ask the people who lived it. Pay them by the answer.')}
          </p>
        </div>

        <div className="relative w-full max-w-2xl">
          <Composer tone="dark" />
        </div>
      </div>
    </section>
  )
}
