import { Composer } from '@/components/Composer'
import InteractiveNebulaShader from '@/components/ui/liquid-shader'
import { useT } from '@/i18n'

/**
 * Full-bleed hero. The shader remains decorative and never intercepts composer
 * input.
 */
export function Hero() {
  const t = useT()
  return (
    <section className="h-[70svh] overflow-hidden">
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-6 px-4 sm:px-6">
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
              'Obolus searches firsthand human databases instead of averaging the web. Open only the evidence you need in USDC; 90% settles to its owner.',
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
