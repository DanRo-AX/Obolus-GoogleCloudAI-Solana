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
  '#5B4BE0', // violet
  '#7C3FE4', // purple
  '#B23CD6', // orchid
  '#E23C86', // magenta
  '#E8443C', // red
  '#F2843C', // orange
  '#2C7BE5', // blue
  '#1C9FD6', // sky
  '#12B5A6', // teal
  '#1FB56B', // emerald
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
  // Third hue anchors the opposite-ish corner and runs darker, so the banner
  // reads like a photo — two saturated hues meeting with one shaded corner —
  // rather than a pale wash. White is kept to a small central highlight only.
  const [x3, y3] = POSITIONS[pick(key, 'pos3', POSITIONS.length)]
  const angle = ANGLES[pick(key, 'angle', ANGLES.length)]

  // Stops, per intensity. `deep` keeps more of each hue and less white/black
  // padding, and reaches further before fading to transparent.
  const s = deep
    ? { white: 38, h1: 97, h2: 95, corner: 46, r1: 74, r2: 70, r3: 78, lin1: 92, lin2: 90 }
    : { white: 55, h1: 88, h2: 86, corner: 30, r1: 66, r2: 62, r3: 70, lin1: 82, lin2: 80 }

  return [
    // central highlight — the bright meeting point, small and soft
    `radial-gradient(120% 90% at 50% 42%, color-mix(in oklab, white ${s.white}%, transparent) 0%, transparent 45%)`,
    `radial-gradient(circle at ${x1}% ${y1}%, color-mix(in oklab, ${c1} ${s.h1}%, white) 0%, transparent ${s.r1}%)`,
    `radial-gradient(circle at ${x2}% ${y2}%, color-mix(in oklab, ${c2} ${s.h2}%, white) 0%, transparent ${s.r2}%)`,
    `radial-gradient(circle at ${x3}% ${y3}%, color-mix(in oklab, ${c3} ${s.corner}%, black) 0%, transparent ${s.r3}%)`,
    `linear-gradient(${angle}deg, color-mix(in oklab, ${c1} ${s.lin1}%, black), color-mix(in oklab, ${c2} ${s.lin2}%, white))`,
  ].join(', ')
}

/**
 * POSITION-BASED "flow" banner — the dashboard survey grid's mode.
 *
 * `cardGradient(seed)` gives every question a FIXED colour hashed from its
 * text. One card looks fine, but a full grid of independent hashes clashes —
 * random neighbouring hues the founder called "정신 없다". `flowGradient(index)`
 * throws the hash away: hue is driven purely by the card's position in the
 * currently displayed list, so neighbours always share a nearby tone and the
 * grid reads as one calm cohesive sweep instead of a jumble.
 *
 *   hue(index) = FLOW_BASE_HUE − index · FLOW_HUE_STEP
 *
 * The banners stay as RICH and smooth as the landing's `deep` cards — this is
 * not a pale wash. The trick is oklch: chroma and lightness are pinned to one
 * vivid, perceptually-even band, so every card is equally saturated and equally
 * bright and ONLY the hue travels down the grid. A small per-card step (13°)
 * keeps adjacent cards analogous; walking down, the tone drifts slowly from a
 * rich indigo-violet through blue and teal toward green — a smooth spectral
 * ribbon (sky → water → foliage), never a rainbow of clashing hues. Because the
 * sweep is a function of display order, it stays cohesive under any sort
 * (new / popular / pay / fit): re-sorting re-indexes the list and the gradient
 * simply re-flows in the new order.
 *
 * Each card is still a real gradient banner — a soft top-left highlight and a
 * deeper anchoring bottom-right corner over a diagonal — matching the landing's
 * depth, just harmonised with its neighbours rather than fighting them. The
 * within-card wash shifts by one full card-step, so the bottom tone of a card
 * meets the top tone of the next and the grid connects seam-to-seam.
 *
 * This is intentionally separate from `cardGradient` so every landing-page
 * caller — which relies on the vivid `deep` hashed look — is untouched.
 */

/** Top of the grid: a rich indigo-violet (oklch hue), near the landing violet. */
const FLOW_BASE_HUE = 274
/** Degrees of hue per card. Small, so any two adjacent cards stay analogous. */
const FLOW_HUE_STEP = 13

/** Wrap any hue into the [0, 360) range CSS expects. */
function normHue(h: number): number {
  return ((h % 360) + 360) % 360
}

/**
 * Build the rich, position-driven banner for card `index` (0-based) in the
 * current display order. Same index → same banner; neighbouring indices →
 * neighbouring tones. oklch keeps every card equally vivid and bright, so the
 * whole column reads as one smooth, saturated sweep.
 */
export function flowGradient(index: number): string {
  const i = Number.isFinite(index) && index > 0 ? Math.floor(index) : 0
  // Dominant hue for this card, plus companions shifted along the same
  // direction the grid flows, so the wash inside one card connects to the next.
  const h = normHue(FLOW_BASE_HUE - i * FLOW_HUE_STEP)
  const hMid = normHue(FLOW_BASE_HUE - (i + 0.5) * FLOW_HUE_STEP)
  const hFoot = normHue(FLOW_BASE_HUE - (i + 1) * FLOW_HUE_STEP)

  // One vivid oklch band, shared by every card: even chroma + lightness so only
  // hue travels down the grid. Rich like the landing's `deep`, not a pale tint.
  const glow = `oklch(0.78 0.11 ${h})` // soft top-left highlight
  const top = `oklch(0.66 0.165 ${h})`
  const mid = `oklch(0.60 0.18 ${hMid})`
  const foot = `oklch(0.5 0.17 ${hFoot})` // deeper anchoring corner, for depth

  return [
    // top-left highlight — the bright meeting point, keeps it from reading flat
    `radial-gradient(120% 105% at 22% 14%, color-mix(in oklab, ${glow} 85%, transparent) 0%, transparent 60%)`,
    // deeper bottom-right corner, mirroring the landing `deep` shaded anchor
    `radial-gradient(120% 110% at 88% 100%, color-mix(in oklab, ${foot} 92%, black) 0%, transparent 66%)`,
    `linear-gradient(146deg, ${top} 0%, ${mid} 55%, ${foot} 100%)`,
  ].join(', ')
}
