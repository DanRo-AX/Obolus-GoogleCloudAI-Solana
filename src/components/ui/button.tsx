import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * The CTA variants are still named `mono*` because every call site uses those
 * names, but they no longer set a monospace face. Uppercase mono reads as a
 * terminal prompt, which is wrong on a button someone is meant to press — it
 * belongs on the small labels and figures, not on "Start writing". They now
 * take the page sans at sentence case, keeping only the 2px radius that gives
 * the app its squared-off feel.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium cursor-pointer disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 aria-invalid:border-destructive transition-all",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20',
        outline:
          'border bg-background hover:bg-accent hover:text-accent-foreground',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
        mono: 'rounded-[2px] bg-foreground text-background hover:bg-foreground/85',
        monoMuted:
          'rounded-[2px] bg-muted-2 text-foreground hover:bg-muted-foreground/15 border border-transparent',
        monoGhost:
          'rounded-[2px] bg-transparent text-muted-foreground hover:bg-muted-foreground/10 border border-transparent hover:text-foreground',
        monoOutline:
          'rounded-[2px] bg-transparent text-foreground border border-foreground/[0.12] hover:bg-foreground/[0.06]',
      },
      size: {
        default: 'h-11 px-4 py-2 text-sm has-[>svg]:px-3 sm:h-9',
        sm: 'h-10 rounded-md gap-1.5 px-3 text-sm has-[>svg]:px-2.5 sm:h-8',
        lg: 'h-10 rounded-md px-6 text-sm has-[>svg]:px-4',
        icon: 'size-11 sm:size-9',
        mono: 'h-11 px-3.5 py-1 text-sm sm:h-9',
        monoSm: 'h-10 px-3 py-1 text-[13px] sm:h-8',
        monoLg: 'h-11 px-5 text-sm',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

// oxlint-disable-next-line react/only-export-components -- variants are shared by links.
export { Button, buttonVariants }
