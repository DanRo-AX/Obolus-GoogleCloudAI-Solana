import { Composer } from '@/components/Composer'
import { GlitterWrap } from '@/components/GlitterWrap'

/**
 * Full-bleed hero. GlitterWrap's stars draw additively, so the panel carries a
 * deep base colour for them to read against; the heading sits in
 * mix-blend-difference and stays white over it, and the composer switches to the
 * dark glass treatment the site's other dark canvases use.
 */
export function Hero() {
  return (
    <section className="mt-6 h-[70svh] p-4 pb-0 sm:mt-8 sm:p-6 sm:pb-0">
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 overflow-hidden rounded-lg border border-transparent px-4">
        <div className="absolute inset-0">
          <GlitterWrap style={{ backgroundColor: '#08070F' }} />
        </div>

        <div className="relative flex size-14 items-center justify-center rounded-[2px] bg-background">
          <img src="/SHELF-SYMBOL.svg" alt="Obolus" width={30} height={30} />
        </div>

        <div className="relative -mt-2 mx-auto max-w-2xl text-center mix-blend-difference">
          <h1 className="font-display text-[30px] font-semibold leading-[1.15] text-white sm:text-[40px]">
            Turn the internet into a database
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-[17px] font-medium text-white/80">
            SHELF-1 searches what people wrote instead of the web. ₩5 to ₩20 to
            open one document, and it lands in the wallet of whoever wrote it.
          </p>
        </div>

        <div className="relative w-full max-w-2xl">
          <Composer tone="dark" />
        </div>
      </div>
    </section>
  )
}
