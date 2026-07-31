import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'

/** Footer: the OPENSHELF wordmark rasterised into a scanned point field. */
export function SiteFooter() {
  return (
    <section
      aria-label="Footer"
      className="px-4 pb-28 pt-2 sm:px-6 md:pb-8 lg:px-6"
    >
      <div className="flex items-end justify-center pb-6 pt-16 sm:pb-10 sm:pt-24">
        <span
          aria-label="OPENSHELF"
          className="select-none font-display text-[14vw] font-semibold leading-none tracking-tight text-foreground/[0.07] sm:text-[13vw]"
        >
          OPENSHELF
        </span>
      </div>
      <div className="mx-auto mt-2 flex w-full max-w-[595px] items-center justify-center gap-4 sm:max-w-[744px] sm:justify-between lg:max-w-[843px]">
        <span className="hidden font-mono text-xs font-medium tracking-[0.5px] text-muted-foreground sm:block">
          THE INTERNET, AS A DATABASE
        </span>
        <div className="flex items-center gap-1">
          <Button asChild variant="monoGhost" size="monoSm">
            <a
              href="https://t.me/openshelf"
              target="_blank"
              rel="noopener noreferrer"
            >
              Support
            </a>
          </Button>
          <Button asChild variant="monoGhost" size="monoSm">
            <Link to="/terms">Terms</Link>
          </Button>
          <Button asChild variant="monoGhost" size="monoSm">
            <Link to="/privacy">Privacy</Link>
          </Button>
          <Button
            asChild
            variant="monoGhost"
            size="monoSm"
            aria-label="X"
          >
            <a
              href="https://x.com/openshelf"
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg
                className="size-3.5"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </Button>
        </div>
      </div>
    </section>
  )
}
