import { Composer } from '@/components/Composer'
import InteractiveNebulaShader from '@/components/ui/liquid-shader'
import { useT } from '@/i18n'

/**
 * Full-bleed hero with the product's animated liquid field contained inside the
 * panel. The shader remains decorative and never intercepts composer input.
 */
export function Hero() {
  const t = useT()
  return (
    <section className="mt-6 h-[70svh] p-4 pb-0 sm:mt-8 sm:p-6 sm:pb-0">
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 overflow-hidden rounded-lg border border-transparent px-4">
        <InteractiveNebulaShader
          position="absolute"
          className="pointer-events-none"
        />
        <div className="pointer-events-none absolute inset-0 bg-black/10" />

        <div className="relative flex size-14 items-center justify-center rounded-[16px] bg-background">
          <img src="/OBOLUS-MARK.svg" alt="Obolus" width={30} height={30} />
        </div>

        <div className="relative -mt-2 mx-auto max-w-2xl text-center mix-blend-difference">
          <h1 className="text-balance font-display text-[30px] font-semibold leading-[1.15] text-white sm:text-[40px]">
            {t('Turn the internet into a database')}
          </h1>
          <p className="mx-auto mt-2 max-w-lg text-pretty text-[17px] font-medium text-white/80">
            {t(
              'SHELF searches firsthand human documents instead of averaging the web. Open only the evidence you need for ₩5 to ₩25; 90% settles to its owner.',
            )}
          </p>
        </div>

        <div className="relative w-full max-w-2xl">
          <Composer tone="dark" />
        </div>
      </div>
    </section>
  )
}
