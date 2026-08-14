import { cn } from '@/lib/utils'

/**
 * The square Obolus logo mark — identical markup used to live copy-pasted
 * three times (AppSidebar, MobileSidebar, Login), each with a slightly
 * different radius. One shape, two sizes.
 */
const SIZES = {
  sm: { box: 'size-6', icon: 14 },
  md: { box: 'size-8', icon: 20 },
} as const

export function BrandMark({
  size = 'md',
  decorative = false,
  className,
}: {
  size?: keyof typeof SIZES
  decorative?: boolean
  className?: string
}) {
  const s = SIZES[size]
  return (
    <span
      className={cn(
        s.box,
        'flex shrink-0 items-center justify-center rounded-[7px] bg-foreground',
        className,
      )}
    >
      <img
        className="invert"
        src="/OBOLUS-MARK-SM.svg"
        alt={decorative ? '' : 'Obolus'}
        width={s.icon}
        height={s.icon}
      />
    </span>
  )
}
