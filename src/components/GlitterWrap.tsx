import { useEffect, useRef, type CSSProperties } from 'react'

/**
 * GlitterWrap — animated starfield warp tunnel with glittering sparkle flashes.
 *
 * Ported from the Originkit/Framer component. The algorithm (framerate-
 * independent trail decay, cached colour strings, fillRect heads, per-star
 * speed jitter) is kept verbatim; only the Framer plumbing — RenderTarget,
 * property controls, the preset-props default export — was stripped. The
 * preset values ship as the component defaults.
 *
 * Note: stars are drawn with `globalCompositeOperation = "lighter"` (additive),
 * so this only reads over a dark backdrop.
 */

export type GlitterWrapProps = {
  particleCount?: number
  color1?: string
  color2?: string
  color3?: string
  /** 1–10 */
  speed?: number
  /** 1–100 */
  density?: number
  /** 0–20 */
  starSize?: number
  /** 1–30 */
  focalDepth?: number
  /** 0–10 */
  turbulence?: number
  /** 0–100 */
  brightness?: number
  /** 0–10 */
  glitterIntensity?: number
  /** 0–100 */
  trailAmount?: number
  reverse?: boolean
  className?: string
  style?: CSSProperties
}

const DEFAULTS: Required<Omit<GlitterWrapProps, 'className' | 'style'>> = {
  particleCount: 228,
  color1: '#866FF2',
  color2: '#C2ADF7',
  color3: '#D3D0FA',
  speed: 2.5,
  density: 100,
  starSize: 20,
  focalDepth: 9,
  turbulence: 1,
  brightness: 100,
  glitterIntensity: 2,
  trailAmount: 16,
  reverse: false,
}

// Pure utility — hoisted to module scope so it is never re-created on render.
function parseColor(input: string): [number, number, number, number] {
  if (!input) return [255, 255, 255, 1]
  const s = input.trim()
  if (s.startsWith('#')) {
    let hex = s.slice(1)
    if (hex.length === 3) {
      hex = hex
        .split('')
        .map((c) => c + c)
        .join('')
    }
    const num = parseInt(hex, 16)
    return [(num >> 16) & 255, (num >> 8) & 255, num & 255, 1]
  }
  const m = s.match(/rgba?\(([^)]+)\)/i)
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()))
    return [
      parts[0] || 0,
      parts[1] || 0,
      parts[2] || 0,
      parts[3] == null ? 1 : parts[3],
    ]
  }
  return [255, 255, 255, 1]
}

export function GlitterWrap(userProps: GlitterWrapProps) {
  const props = { ...DEFAULTS, ...userProps }
  const { className, style } = props

  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })

  // Latest props, read fresh each frame so control tweaks don't tear down
  // and rebuild the whole animation (which would re-init every star + RAF).
  const propsRef = useRef(props)
  propsRef.current = props

  // Cached parsed colors — only recomputed when the string value changes.
  // This avoids 4 string-parse + regex calls per frame (240/sec at 60fps).
  const colorCacheRef = useRef({
    color1: '' as string,
    color2: '' as string,
    color3: '' as string,
    parsed1: [255, 255, 255, 1] as [number, number, number, number],
    parsed2: [177, 158, 239, 1] as [number, number, number, number],
    parsed3: [205, 217, 255, 1] as [number, number, number, number],
  })

  const getCachedColors = () => {
    const p = propsRef.current
    const c = colorCacheRef.current
    if (p.color1 !== c.color1) {
      c.color1 = p.color1
      c.parsed1 = parseColor(p.color1)
    }
    if (p.color2 !== c.color2) {
      c.color2 = p.color2
      c.parsed2 = parseColor(p.color2)
    }
    if (p.color3 !== c.color3) {
      c.color3 = p.color3
      c.parsed3 = parseColor(p.color3)
    }
    return c
  }

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Framer's export/thumbnail freeze becomes a reduced-motion freeze here:
    // draw a populated field, then stop instead of running the rAF loop.
    const isStatic = window.matchMedia('(prefers-reduced-motion: reduce)')
      .matches

    type Star = {
      // Position in normalized space relative to centre
      x: number
      y: number
      z: number // depth: 1 = far, ~0 = near
      // Previous projected screen position (for streaks)
      px: number
      py: number
      seed: number // unique phase for turbulence + glitter
      vmul: number // per-star speed multiplier (breaks up cohorts)
      colorIdx: number
      flashUntil: number // elapsed seconds until which it's flashing
      nextFlash: number // elapsed seconds at which it can flash again
    }

    const stars: Star[] = []
    // Elapsed wall-clock seconds. Turbulence + glitter cadence key off this
    // instead of a frame counter, so motion stays constant under variable
    // frame timing (16/16/22/13ms…) rather than jittering with each hitch.
    let elapsed = 0
    let lastT = performance.now()

    // Map the integer UI controls to their internal working ranges in one
    // place, so the physics/render code stays in convenient units.
    const cfg = () => {
      const p = propsRef.current
      return {
        reverse: p.reverse,
        density: p.density, //                1–100, used raw
        stepZ: p.speed * 0.0008, //           speed 1–10
        focalDepth: p.focalDepth / 100, //    1–30  -> 0.01–0.30
        starScale: p.starSize * 0.15, //      0–20  -> 0–3.0
        turbulence: p.turbulence * 0.2, //    0–10  -> 0–2
        glitter: p.glitterIntensity * 0.1, // 0–10  -> 0–1
        brightness: Math.min(1, p.brightness / 100), // 0–100%
        trail: p.trailAmount / 100, //        0–100%
      }
    }

    const resetStar = (s: Star, initial = false) => {
      const { density, reverse, focalDepth, glitter } = cfg()
      // Spawn at a random angle around centre, at near-far depth
      const angle = Math.random() * Math.PI * 2
      // density controls how spread out the spawn radius is
      const radius = (0.2 + Math.random() * 0.8) * (density / 15)
      s.x = Math.cos(angle) * radius
      s.y = Math.sin(angle) * radius
      // Reverse is the exact time-reverse of forward: identical x/y/radius
      // spawn, only z runs the other way. Forward spawns far (z=1, near
      // centre) and travels to z=focalDepth (off-screen edge); reverse
      // spawns at z=focalDepth (edge) and travels back to z=1 (centre).
      if (reverse) {
        s.z = initial ? focalDepth + Math.random() * (1 - focalDepth) : focalDepth
      } else {
        s.z = initial ? Math.random() : 1.0
      }
      s.px = NaN
      s.py = NaN
      s.seed = Math.random() * 1000
      // Varied per-star speed so synchronized respawns disperse instead
      // of travelling as one cohort (which reads as a pulsing wave).
      s.vmul = 0.6 + Math.random() * 0.8
      s.colorIdx = Math.floor(Math.random() * 3)
      s.flashUntil = 0
      // Seconds-based: ~1s minimum gap + up to ~4s scaled by glitter.
      s.nextFlash =
        elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, glitter))
    }

    const makeStar = (): Star => ({
      x: 0,
      y: 0,
      z: 0,
      px: NaN,
      py: NaN,
      seed: 0,
      vmul: 1,
      colorIdx: 0,
      flashUntil: 0,
      nextFlash: 0,
    })

    // Grow or shrink the star pool to match the requested count without
    // rebuilding the whole array (so changing "Particles" stays smooth).
    const syncCount = () => {
      const count = Math.max(1, Math.floor(propsRef.current.particleCount))
      if (stars.length === count) return
      if (stars.length > count) {
        stars.length = count
      } else {
        while (stars.length < count) {
          const s = makeStar()
          resetStar(s, true)
          stars.push(s)
        }
      }
    }

    const resize = (entry?: ResizeObserverEntry) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cr = entry?.contentRect
      const rectW =
        cr?.width ||
        container.clientWidth ||
        container.getBoundingClientRect().width
      const rectH =
        cr?.height ||
        container.clientHeight ||
        container.getBoundingClientRect().height
      const w = Math.max(1, Math.floor(rectW) || 600)
      const h = Math.max(1, Math.floor(rectH) || 400)

      // Bail when nothing changed. ResizeObserver fires spuriously (initial
      // observe, sub-pixel jitter, DPR shifts, parent relayout); each call
      // here would set canvas.width — which WIPES the canvas + trail buffer
      // — making the animation visibly break/restart.
      const prev = sizeRef.current
      if (prev.w === w && prev.h === h && prev.dpr === dpr) return

      sizeRef.current = { w, h, dpr }
      canvas.width = Math.floor(w * dpr)
      canvas.height = Math.floor(h * dpr)
      canvas.style.width = `${w}px`
      canvas.style.height = `${h}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      // Canvas stays transparent so the frame fill shows through.
      ctx.clearRect(0, 0, w, h)
    }

    syncCount()
    resize()

    const ro = new ResizeObserver((entries) => resize(entries[0]))
    ro.observe(container)

    const drawFrame = (deltaSec: number) => {
      const {
        reverse,
        stepZ,
        focalDepth,
        starScale,
        turbulence,
        glitter,
        brightness,
        trail,
      } = cfg()

      syncCount()
      const colors = getCachedColors()
      const palette: [number, number, number, number][] = [
        colors.parsed1,
        colors.parsed2,
        colors.parsed3,
      ]
      // Solid colour strings, built once per frame (3 of them) instead of
      // per-star. Per-star alpha is applied via ctx.globalAlpha below, so
      // the hot loop allocates zero strings — the previous rgba()-per-star
      // approach churned ~120k short-lived strings/sec at 700 particles,
      // whose GC pauses were the main cause of the stutter.
      const rgbStrs = [
        `rgb(${palette[0][0]}, ${palette[0][1]}, ${palette[0][2]})`,
        `rgb(${palette[1][0]}, ${palette[1][1]}, ${palette[1][2]})`,
        `rgb(${palette[2][0]}, ${palette[2][1]}, ${palette[2][2]})`,
      ]

      const { w, h } = sizeRef.current
      const cx = w / 2
      const cy = h / 2
      // Scale used for projection; tied to smaller dimension so it adapts
      const projScale = Math.min(w, h) * 0.9

      // Cap deltaSec to avoid large jumps when the tab was backgrounded
      const dt = Math.max(0.001, Math.min(0.1, deltaSec)) * 60 // normalize to 60fps frames

      // Soft "trails" — fade prior pixels toward transparent so the frame fill
      // shows through. Decay is framerate-independent: `trail` is the fraction
      // of the previous frame kept per 1/60s, raised to dt so trail length
      // stays constant at 60Hz, 120Hz, or a stuttering variable rate.
      const keep = Math.pow(Math.min(0.98, Math.max(0, trail)), dt)
      const trailAlpha = Math.max(0.02, 1 - keep)
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = `rgba(0, 0, 0, ${trailAlpha})`
      ctx.fillRect(0, 0, w, h)

      // Switch to additive for the stars
      ctx.globalCompositeOperation = 'lighter'

      for (let i = 0; i < stars.length; i++) {
        const s = stars[i]

        // Forward: z decreases toward focalDepth (stars fly outward).
        // Reverse: z increases toward 1 (stars recede into the centre).
        const vz = stepZ * s.vmul * dt
        if (reverse) {
          s.z += vz
          if (s.z >= 1.0) {
            resetStar(s)
            continue
          }
        } else {
          s.z -= vz
          if (s.z <= focalDepth) {
            resetStar(s)
            continue
          }
        }

        // Turbulence: gentle sinusoidal wobble that grows as star approaches
        let tx = s.x
        let ty = s.y
        if (turbulence > 0) {
          const t = elapsed * 1.2 + s.seed
          const amp = turbulence * (1 - s.z) * 0.25
          tx += Math.sin(t + s.seed) * amp
          ty += Math.cos(t * 1.13 + s.seed * 0.7) * amp
        }

        // Project: as z -> 0, the star expands outward from centre
        const persp = focalDepth / Math.max(s.z, 0.0001)
        const sx = cx + tx * persp * projScale
        const sy = cy + ty * persp * projScale

        // Off-screen? respawn — forward only. A reverse star is born at
        // z=focalDepth where persp=1, which can place it past the edge;
        // it then travels inward ONTO the screen.
        if (!reverse && (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20)) {
          resetStar(s)
          continue
        }

        // Glitter flash logic.
        let flashMult = 1
        if (glitter > 0) {
          if (elapsed >= s.nextFlash && s.flashUntil < elapsed) {
            // Flash for ~40–110ms, then schedule the next one.
            s.flashUntil = elapsed + 0.04 + Math.random() * 0.07
            s.nextFlash =
              elapsed + 1 + Math.random() * 4 * (1 / Math.max(0.0001, glitter))
          }
          if (elapsed <= s.flashUntil) {
            flashMult = 1 + 2.5 * glitter
          }
        }

        // Size grows as z -> 0. The cap scales with starScale so the
        // "Star Size" control stays visibly distinct across its whole range.
        const sizePersp = Math.min(
          2.5,
          (focalDepth / Math.max(s.z, 0.0001)) * 0.6,
        )
        const baseR = Math.max(0.25, starScale * (0.4 + sizePersp))
        const maxR = 1 + starScale * 2.5
        const r = Math.min(baseR * flashMult, maxR)

        // Alpha — brighter as nearer, modulated by brightness.
        const lifeT = reverse ? s.z : 1 - s.z // 0=spawn, 1=despawn
        // Reverse spawns at the screen edge already bright, so ramp alpha up
        // over the first ~12% of the journey instead of popping in.
        const fadeIn = reverse
          ? Math.min(1, (s.z - focalDepth) / (1 - focalDepth) / 0.12)
          : 1
        const a =
          Math.min(1, reverse ? 0.85 - lifeT * 0.6 : lifeT * 0.9 + 0.05) *
          fadeIn *
          brightness *
          (flashMult > 1 ? 1 : 0.85)

        // Solid colour string (1 of 3, cached); per-star opacity rides
        // on globalAlpha so nothing is allocated in this hot loop.
        const colStr = rgbStrs[s.colorIdx]

        // Streak from previous projected position to current. Kept
        // thin so trails read as fine lines, not painted strokes.
        if (!Number.isNaN(s.px) && !Number.isNaN(s.py)) {
          ctx.globalAlpha = a * 0.5
          ctx.strokeStyle = colStr
          ctx.lineWidth = Math.max(0.4, r * 0.4)
          ctx.beginPath()
          ctx.moveTo(s.px, s.py)
          ctx.lineTo(sx, sy)
          ctx.stroke()
        }

        // Tiny dot head — fillRect instead of arc(): at sub-pixel radii
        // a square reads identically but skips per-star path tessellation.
        ctx.globalAlpha = a
        ctx.fillStyle = colStr
        ctx.fillRect(sx - r, sy - r, r * 2, r * 2)

        // Glitter flash adds a subtle extra square at slightly larger
        // radius so it reads as a sparkle, not a halo.
        if (flashMult > 1) {
          const rf = Math.min(r * 1.4, maxR * 1.4)
          ctx.globalAlpha = a * 0.5
          ctx.fillRect(sx - rf, sy - rf, rf * 2, rf * 2)
        }

        s.px = sx
        s.py = sy
      }

      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
      // Cap like the motion dt so a backgrounded-tab jump doesn't snap
      // turbulence phase or fire every glitter flash at once on resume.
      elapsed += Math.min(0.1, Math.max(0, deltaSec))
    }

    if (isStatic) {
      // Advance a few warm-up frames so the frozen field looks populated
      // rather than showing only spawning particles near the centre.
      for (let i = 0; i < 80; i++) drawFrame(1 / 60)
      return () => {
        ro.disconnect()
      }
    }

    // Pause while scrolled out of view so an off-screen hero costs nothing.
    let visible = true
    const io = new IntersectionObserver(
      (entries) => {
        visible = entries.some((e) => e.isIntersecting)
      },
      { rootMargin: '160px' },
    )
    io.observe(container)

    const loop = (t: number) => {
      const deltaSec = (t - lastT) / 1000
      lastT = t
      if (visible) drawFrame(deltaSec)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      ro.disconnect()
      io.disconnect()
    }
    // Single setup. Every animated value is read from propsRef each frame,
    // so prop changes apply live without rebuilding stars + RAF.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        padding: 0,
        margin: 0,
        boxSizing: 'border-box',
        overflow: 'hidden',
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </div>
  )
}

export default GlitterWrap
