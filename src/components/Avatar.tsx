import { cn } from '@/lib/utils'
import {
  AVATAR_LAYER_ORDER,
  isImageAvatar,
  partSrc,
  type AvatarConfig,
} from '@/lib/avatar'

/**
 * Renders a profile avatar from a config — either a stack of notion-style
 * part SVGs (deterministic default, or hand-picked) or an uploaded image.
 *
 * Every part SVG shares the same 1080x1080 canvas coordinate space, so
 * layering them at `inset-0` with no per-layer offset math lines them up —
 * see `src/lib/avatar.ts`.
 */
export function Avatar({
  config,
  size = 40,
  className,
}: {
  config: AvatarConfig
  size?: number
  className?: string
}) {
  if (isImageAvatar(config)) {
    return (
      <span
        className={cn(
          'block shrink-0 overflow-hidden rounded-full border border-border bg-card',
          className,
        )}
        style={{ width: size, height: size }}
      >
        <img
          src={config.url}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      </span>
    )
  }

  return (
    <span
      className={cn(
        'relative block shrink-0 overflow-hidden rounded-full border border-border',
        className,
      )}
      style={{ width: size, height: size, background: config.bg }}
    >
      {AVATAR_LAYER_ORDER.map((layer) => (
        <img
          key={layer}
          src={partSrc(layer, config[layer])}
          alt=""
          className="absolute inset-0 size-full"
          draggable={false}
        />
      ))}
    </span>
  )
}
