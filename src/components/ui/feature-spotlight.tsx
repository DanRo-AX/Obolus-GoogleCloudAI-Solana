import * as React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AnimatedFeatureSpotlightProps = React.HTMLAttributes<HTMLElement> & {
  preheaderIcon?: React.ReactNode
  preheaderText: React.ReactNode
  heading: React.ReactNode
  description: React.ReactNode
  action?: React.ReactNode
  buttonText?: React.ReactNode
  buttonProps?: React.ComponentProps<typeof Button>
  visual?: React.ReactNode
  imageUrl?: string
  imageAlt?: string
  compact?: boolean
}

/**
 * A compact, product-first header: the copy explains why the page exists and
 * the visual proves how the product works. It accepts a live React visual so a
 * dashboard does not have to fall back to a decorative stock image.
 */
export const AnimatedFeatureSpotlight = React.forwardRef<
  HTMLElement,
  AnimatedFeatureSpotlightProps
>(
  (
    {
      className,
      preheaderIcon,
      preheaderText,
      heading,
      description,
      action,
      buttonText,
      buttonProps,
      visual,
      imageUrl,
      imageAlt = 'Feature illustration',
      compact = false,
      ...props
    },
    ref,
  ) => {
    const headingId = React.useId()
    const reduceMotion = useReducedMotion()
    const enter = (delay: number, x = 0) => ({
      initial: reduceMotion ? false : { opacity: 0, y: 14, x },
      animate: { opacity: 1, y: 0, x: 0 },
      transition: { duration: 0.5, delay, ease: [0.23, 1, 0.32, 1] as const },
    })

    return (
      <section
        ref={ref}
        className={cn(
          'relative isolate w-full overflow-hidden rounded-[20px] border border-white/10 bg-[#08080a] text-white',
          className,
        )}
        aria-labelledby={headingId}
        {...props}
      >
        <div
          className={cn(
            'grid grid-cols-1 lg:grid-cols-[0.86fr_1.14fr]',
            compact ? 'min-h-[270px]' : 'min-h-[330px]',
          )}
        >
          <div
            className={cn(
              'flex flex-col justify-center',
              compact ? 'p-6 sm:p-7 lg:px-8 lg:py-7' : 'p-7 sm:p-8 lg:px-10 lg:py-8',
            )}
          >
            <motion.div
              {...enter(0)}
              className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[1.2px] text-white/45"
            >
              {preheaderIcon}
              <span>{preheaderText}</span>
            </motion.div>
            <motion.h1
              {...enter(0.08)}
              id={headingId}
              className={cn(
                'max-w-[14ch] font-medium leading-[1.12] tracking-[-0.035em] text-white',
                compact ? 'mt-4 text-[27px] sm:text-[31px]' : 'mt-5 text-[30px] sm:text-[35px]',
              )}
            >
              {heading}
            </motion.h1>
            <motion.p
              {...enter(0.16)}
              className={cn(
                'max-w-md text-white/60',
                compact ? 'mt-3 text-[13px] leading-[1.7]' : 'mt-4 text-[14px] leading-6',
              )}
            >
              {description}
            </motion.p>
            {action || buttonText ? (
              <motion.div {...enter(0.24)} className={compact ? 'mt-5' : 'mt-6'}>
                {action ?? <Button {...buttonProps}>{buttonText}</Button>}
              </motion.div>
            ) : null}
          </div>

          <motion.div
            {...enter(0.14, 18)}
            className={cn(
              'relative flex items-center justify-center px-5 sm:px-8 lg:min-h-full lg:pl-0',
              compact
                ? 'min-h-[210px] pb-5 sm:pb-6 lg:p-4'
                : 'min-h-[250px] pb-6 sm:pb-8 lg:p-5',
            )}
          >
            {visual ? (
              visual
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt={imageAlt}
                className={cn(
                  'h-full w-full rounded-2xl object-cover',
                  compact ? 'max-h-[270px]' : 'max-h-[360px]',
                )}
              />
            ) : null}
          </motion.div>
        </div>
      </section>
    )
  },
)

AnimatedFeatureSpotlight.displayName = 'AnimatedFeatureSpotlight'
