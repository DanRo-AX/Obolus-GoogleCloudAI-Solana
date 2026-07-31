import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * Mirrors frames.ag's button recipe, including its two bespoke variants:
 * `mono` (uppercase Geist Mono, 2px radius) used for every CTA, and `ghostMono`
 * used for footer / inline links.
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
        mono: 'font-mono tracking-[1px] uppercase rounded-[2px] bg-foreground text-background hover:bg-foreground/85',
        monoMuted:
          'font-mono tracking-[1px] uppercase rounded-[2px] bg-muted-2 text-foreground hover:bg-muted-foreground/15 border border-transparent',
        monoGhost:
          'font-mono tracking-[1px] uppercase rounded-[2px] bg-transparent text-muted-foreground hover:bg-muted-foreground/10 border border-transparent hover:text-foreground',
        monoOutline:
          'font-mono tracking-[1px] uppercase rounded-[2px] bg-transparent text-foreground border border-foreground/[0.12] hover:bg-foreground/[0.06]',
      },
      size: {
        default: 'h-9 px-4 py-2 text-sm has-[>svg]:px-3',
        sm: 'h-8 rounded-md gap-1.5 px-3 text-sm has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 text-sm has-[>svg]:px-4',
        icon: 'size-9',
        mono: 'h-9 px-3 py-1 text-xs',
        monoSm: 'h-8 px-2.5 py-1 text-xs',
        monoLg: 'h-11 px-5 text-xs',
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

export { Button, buttonVariants }
