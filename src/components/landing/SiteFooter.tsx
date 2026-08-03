/** Footer: the OPENSHELF wordmark, and nothing else to click. */
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
    </section>
  )
}
