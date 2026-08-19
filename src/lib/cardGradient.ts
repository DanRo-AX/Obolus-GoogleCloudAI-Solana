/**
 * Deterministic atmospheric colour field for a survey card's banner.
 *
 * The founder's variant-7 ("Airbnb 리스팅") pick wants the banner to read
 * like refracted light rather than a generic dashboard gradient. A curated
 * colour family forms the base; a separate SVG texture draws one broad,
 * asymmetric ribbon through it. The same seed always paints the same card.
 *
 * Choosing whole colour families instead of three unrelated random hues is
 * important: coral never accidentally turns muddy green and blue never lands
 * in a brown midpoint. Positions, direction and texture still yield far more
 * than the documented 50 distinguishable results.
 */

/** Documented floor on distinguishable gradient "feels" — see file header. */
export const GRADIENT_FEEL_FLOOR = 50

const SCHEMES = [
  { shadow: '#123a86', middle: '#2778cf', light: '#35e5df' },
  { shadow: '#07594f', middle: '#1d9b89', light: '#8ee8d7' },
  { shadow: '#762348', middle: '#ce3f70', light: '#f29bad' },
  { shadow: '#7c3037', middle: '#df5b50', light: '#efad71' },
  { shadow: '#302b75', middle: '#645dde', light: '#66d9c2' },
  { shadow: '#0b475a', middle: '#1688ad', light: '#68e1dd' },
  { shadow: '#542153', middle: '#a63c7b', light: '#eba0c3' },
  { shadow: '#174340', middle: '#218d78', light: '#a8e5ca' },
  { shadow: '#26316d', middle: '#536bd0', light: '#70d2d8' },
  { shadow: '#442654', middle: '#8e4fb4', light: '#ef92bc' },
  { shadow: '#123f55', middle: '#299eb0', light: '#b0eee4' },
] as const

/** Hashed anchor points for the two radial layers, kept away from dead-center so hues visibly cross. */
const POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [12, 18],
  [88, 12],
  [18, 88],
  [82, 82],
  [50, 6],
  [8, 52],
  [92, 48],
  [50, 94],
  [28, 34],
  [72, 66],
]

const ANGLES = [105, 120, 135, 150, 160, 115, 140, 170] as const

/** FNV-1a — small, dependency-free, stable across engines and runs. */
function hash32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** One salted sub-hash per pick, so nearby picks don't correlate. */
function pick(seed: string, salt: string, mod: number): number {
  return hash32(`${salt}:${seed}`) % mod
}

/**
 * How saturated a card wash reads.
 *
 * `soft` is the original photo-area treatment: hues mixed well toward white,
 * a generous white highlight, plenty of transparent falloff. `deep` pulls
 * every stop stronger — less white in each hue, a darker anchoring corner,
 * a tighter highlight, wider color radii — so the same seed lands noticeably
 * more saturated. It is what the landing wants behind a low-opacity mask,
 * where `soft` washed out to almost nothing; the dashboard cards keep `soft`.
 */
export type GradientIntensity = 'soft' | 'deep'

/**
 * Build a deterministic, layered CSS `background` for a card banner.
 * `seed` should be the order's question+shelf text (or any other string
 * that is stable for the life of the card) — the same seed always returns
 * the same gradient, and different seeds are very likely to differ.
 *
 * `intensity` defaults to `soft`, the original behaviour, so every existing
 * call site renders byte-for-byte the same; pass `deep` for a stronger,
 * more saturated wash.
 */
export function cardGradient(
  seed: string,
  intensity: GradientIntensity = 'soft',
): string {
  const key = seed || 'obolus'
  const deep = intensity === 'deep'

  const scheme = SCHEMES[pick(key, 'scheme', SCHEMES.length)]

  const [x1, y1] = POSITIONS[pick(key, 'pos1', POSITIONS.length)]
  const [x2, y2] = POSITIONS[pick(key, 'pos2', POSITIONS.length)]
  const [x3, y3] = POSITIONS[pick(key, 'pos3', POSITIONS.length)]
  const angle = ANGLES[pick(key, 'angle', ANGLES.length)]

  const s = deep
    ? { light: 94, middle: 95, shadow: 78, r1: 72, r2: 74, r3: 76 }
    : { light: 66, middle: 72, shadow: 54, r1: 68, r2: 70, r3: 72 }

  return [
    `radial-gradient(ellipse at ${x1}% ${y1}%, color-mix(in oklab, ${scheme.light} ${s.light}%, white) 0%, transparent ${s.r1}%)`,
    `radial-gradient(ellipse at ${x2}% ${y2}%, color-mix(in oklab, ${scheme.middle} ${s.middle}%, white) 0%, transparent ${s.r2}%)`,
    `radial-gradient(ellipse at ${x3}% ${y3}%, color-mix(in oklab, ${scheme.shadow} ${s.shadow}%, black) 0%, transparent ${s.r3}%)`,
    `linear-gradient(${angle}deg, ${scheme.shadow}, ${scheme.middle} 52%, ${scheme.light})`,
  ].join(', ')
}

/**
 * An irregular, deterministic art layer for the visual half of a card.
 *
 * The colour field above deliberately stays consistent across the product.
 * The texture should not: one call gets a broad light ribbon, another a pair
 * of crossing currents, another soft contour rings. The variant and its
 * horizontal reflection are derived from the same stable seed as the colour,
 * so reloading never shuffles the marketplace while neighbouring cards still
 * avoid looking like one repeated template.
 */
export function cardTexture(seed: string): string {
  const key = seed || 'obulus'
  const variant = pick(key, 'texture', 5)
  const reflected = pick(key, 'texture-reflect', 2) === 1
  const rotate = [-9, 5, -4, 10][pick(key, 'texture-rotate', 4)]

  const drawings = [
    `<path d="M-120 540 C110 80 330 510 735-90" stroke-width="168"/><path d="M155 550 C300 285 455 315 710 20" stroke-width="62" opacity=".32"/>`,
    `<path d="M-140 25 C160 5 245 390 750 325" stroke-width="178"/><path d="M-80 470 C175 235 420 470 735 195" stroke-width="66" opacity=".3"/>`,
    `<path d="M-130 420 C100 350 145 30 745 110" stroke-width="188"/><path d="M145 550 C245 265 505 245 655-110" stroke-width="66" opacity=".3"/>`,
    `<path d="M365 570 C210 350 505 190 330-120" stroke-width="176"/><path d="M350 440 C535 240 625 270 750 35" stroke-width="64" opacity=".3"/>`,
    `<path d="M-130 360 C90 55 350 405 750 95" stroke-width="170"/><path d="M-100 525 C175 300 420 520 735 290" stroke-width="60" opacity=".28"/>`,
  ] as const

  const transform = `${reflected ? 'translate(600 0) scale(-1 1)' : ''} rotate(${rotate} 300 225)`.trim()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 450" preserveAspectRatio="xMidYMid slice"><defs><filter id="flow" x="-45%" y="-45%" width="190%" height="190%"><feTurbulence type="fractalNoise" baseFrequency=".003 .008" numOctaves="2" seed="${pick(key, 'texture-noise', 97) + 1}" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="13" xChannelSelector="R" yChannelSelector="B"/><feGaussianBlur stdDeviation="22"/></filter><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" seed="${pick(key, 'grain', 97) + 1}"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 .08 0"/></filter></defs><g transform="${transform}" fill="none" stroke="#f5ffff" stroke-linecap="round" opacity=".72" filter="url(#flow)">${drawings[variant]}</g><rect width="100%" height="100%" filter="url(#grain)" opacity=".12" style="mix-blend-mode:soft-light"/></svg>`

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}
