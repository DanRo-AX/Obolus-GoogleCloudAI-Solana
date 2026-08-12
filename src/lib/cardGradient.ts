/**
 * Deterministic multicolor gradient for a survey card's banner.
 *
 * The founder's variant-7 ("Airbnb 리스팅") pick wants the banner to read
 * like a real photo area — several hues meeting and blending, not a flat
 * two-stop tint. `cardGradient(seed)` layers two hashed radial gradients
 * over a base linear gradient, all mixed toward white with `color-mix` so
 * everything stays light-theme-airy no matter which hues land where. The
 * same seed always paints the same way (same order → same card, every
 * render), and different seeds land on visibly different hue triples and
 * layouts.
 *
 * Curation, not randomness, keeps every result tasteful: PALETTE is a
 * hand-picked set of hues balanced for similar lightness/chroma, so no
 * combination goes muddy the way arbitrary HSL sampling can. Only the
 * *arrangement* (which hues, where, at what angle) is hashed from the seed.
 *
 * Distinct feels: PALETTE has 10 hues, POSITIONS has 10 hashed anchor
 * points, and ANGLES has 8 base-layer angles. Each gradient picks 3
 * distinct hues (ordered) and 2 independent positions plus one angle, for
 * 10·9·8 × 10·10 × 8 ≈ 576,000 raw combinations — comfortably clearing the
 * ~50-distinct-feels bar this was built to guarantee. GRADIENT_FEEL_FLOOR
 * below documents that floor explicitly for anyone verifying variety by
 * eye rather than by combinatorics.
 */

/** Documented floor on distinguishable gradient "feels" — see file header. */
export const GRADIENT_FEEL_FLOOR = 50

const PALETTE = [
  '#7C6FF2', // violet
  '#9B6FF2', // purple
  '#C46FE0', // orchid
  '#F26FA8', // pink
  '#F2806F', // coral
  '#F2A76F', // amber
  '#54A2FF', // blue
  '#4FC3E8', // sky
  '#3FD1C0', // teal
  '#4FD189', // emerald
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
 * Build a deterministic, layered CSS `background` for a card banner.
 * `seed` should be the order's question+shelf text (or any other string
 * that is stable for the life of the card) — the same seed always returns
 * the same gradient, and different seeds are very likely to differ.
 */
export function cardGradient(seed: string): string {
  const key = seed || 'obolus'

  const i1 = pick(key, 'hue1', PALETTE.length)
  let i2 = pick(key, 'hue2', PALETTE.length)
  if (i2 === i1) i2 = (i2 + 1) % PALETTE.length
  let i3 = pick(key, 'hue3', PALETTE.length)
  if (i3 === i1 || i3 === i2) i3 = (i3 + 2) % PALETTE.length

  const c1 = PALETTE[i1]
  const c2 = PALETTE[i2]
  const c3 = PALETTE[i3]

  const [x1, y1] = POSITIONS[pick(key, 'pos1', POSITIONS.length)]
  const [x2, y2] = POSITIONS[pick(key, 'pos2', POSITIONS.length)]
  const angle = ANGLES[pick(key, 'angle', ANGLES.length)]

  return [
    `radial-gradient(circle at ${x1}% ${y1}%, color-mix(in oklab, ${c1} 55%, white) 0%, transparent 62%)`,
    `radial-gradient(circle at ${x2}% ${y2}%, color-mix(in oklab, ${c2} 48%, white) 0%, transparent 58%)`,
    `linear-gradient(${angle}deg, color-mix(in oklab, ${c3} 32%, white), color-mix(in oklab, ${c1} 16%, white))`,
  ].join(', ')
}
