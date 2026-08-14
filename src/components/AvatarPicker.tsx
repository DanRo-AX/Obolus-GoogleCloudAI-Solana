import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Dice5, Trash2, Upload } from 'lucide-react'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'
import {
  AVATAR_BACKGROUNDS,
  AVATAR_LAYER_ORDER,
  AVATAR_PART_COUNTS,
  deterministicAvatar,
  fileToSquareDataUrl,
  isImageAvatar,
  randomAvatar,
  type AvatarConfig,
  type AvatarLayer,
} from '@/lib/avatar'
import { cn } from '@/lib/utils'

const LAYER_LABEL: Record<AvatarLayer, string> = {
  face: 'Face',
  nose: 'Nose',
  mouth: 'Mouth',
  eyes: 'Eyes',
  eyebrows: 'Eyebrows',
  glasses: 'Glasses',
  hair: 'Hair',
  accessories: 'Accessories',
  details: 'Details',
  beard: 'Beard',
}

/**
 * Randomize + per-layer prev/next, or upload a photo instead. Used at
 * account creation (Onboarding) and again from the profile-change point
 * (Memory) — same component, same config shape either way.
 */
export function AvatarPicker({
  value,
  onChange,
  fallbackSeed,
}: {
  value: AvatarConfig
  onChange: (config: AvatarConfig) => void
  /** Handle to fall back to (parts mode) when switching off an uploaded image. */
  fallbackSeed?: string
}) {
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const cycleLayer = (layer: AvatarLayer, direction: 1 | -1) => {
    if (isImageAvatar(value)) return
    const count = AVATAR_PART_COUNTS[layer]
    const next = ((value[layer] + direction) % count + count) % count
    onChange({ ...value, [layer]: next })
  }

  const pickBackground = (bg: string) => {
    if (isImageAvatar(value)) return
    onChange({ ...value, bg })
  }

  const handleFile = async (file: File) => {
    setUploading(true)
    setUploadError(null)
    try {
      const url = await fileToSquareDataUrl(file)
      onChange({ type: 'image', url })
    } catch (error) {
      // fileToSquareDataUrl throws plain-English Error messages (no React
      // context down there to call t() with) — translate by the same text
      // the thrower used, so ko.ts still covers them.
      setUploadError(
        error instanceof Error ? t(error.message) : t('That image could not be used.'),
      )
    } finally {
      setUploading(false)
    }
  }

  const removeImage = () => {
    onChange(fallbackSeed ? deterministicAvatar(fallbackSeed) : randomAvatar())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Avatar config={value} size={88} className="text-3xl" />
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            variant="monoMuted"
            size="monoSm"
            onClick={() => onChange(randomAvatar())}
          >
            <Dice5 className="size-3.5" />
            {t('Randomize')}
          </Button>
          <Button
            type="button"
            variant="monoGhost"
            size="monoSm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="size-3.5" />
            {uploading ? t('Uploading…') : t('Upload image')}
          </Button>
          {isImageAvatar(value) ? (
            <Button
              type="button"
              variant="monoGhost"
              size="monoSm"
              onClick={removeImage}
            >
              <Trash2 className="size-3.5" />
              {t('Remove image')}
            </Button>
          ) : null}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void handleFile(file)
            }}
          />
        </div>
      </div>

      {uploadError ? (
        <p className="text-sm text-destructive">{uploadError}</p>
      ) : null}

      {!isImageAvatar(value) ? (
        <div className="space-y-1.5 rounded-[6px] border border-border p-3">
          {AVATAR_LAYER_ORDER.map((layer) => (
            <div
              key={layer}
              className="flex items-center justify-between gap-2 py-0.5"
            >
              <span className="font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
                {t(LAYER_LABEL[layer])}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t('Previous')}
                  onClick={() => cycleLayer(layer, -1)}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-[2px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <ChevronLeft className="size-3.5" />
                </button>
                <span className="w-10 text-center font-mono text-[10px] tabular-nums text-muted-foreground">
                  {value[layer] + 1}/{AVATAR_PART_COUNTS[layer]}
                </span>
                <button
                  type="button"
                  aria-label={t('Next')}
                  onClick={() => cycleLayer(layer, 1)}
                  className="flex size-6 cursor-pointer items-center justify-center rounded-[2px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                >
                  <ChevronRight className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/70 pt-2.5">
            <span className="mr-1 font-mono text-[10px] uppercase tracking-[1px] text-muted-foreground">
              {t('Background')}
            </span>
            {AVATAR_BACKGROUNDS.map((bg) => (
              <button
                key={bg}
                type="button"
                aria-label={t('Background')}
                aria-pressed={value.bg === bg}
                onClick={() => pickBackground(bg)}
                className={cn(
                  'size-5 cursor-pointer rounded-full border transition-all',
                  value.bg === bg
                    ? 'ring-2 ring-foreground ring-offset-1 ring-offset-background'
                    : 'border-border/70 hover:scale-110',
                )}
                style={{ background: bg }}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
