/** Canvas palette per use-case carousel category. Keys match the labels in useCases.ts. */
export const USE_CASE_THEME: Record<
  string,
  { background: string; color: string; colorAlt: string }
> = {
  Neighborhood: {
    background: 'rgb(20, 14, 5)',
    color: '#ffb020',
    colorAlt: '#9b8f7d',
  },
  'Food & Drink': {
    background: 'rgb(22, 9, 6)',
    color: '#ff7a45',
    colorAlt: '#9b837d',
  },
  Commerce: {
    background: 'rgb(22, 8, 18)',
    color: '#fb64b6',
    colorAlt: '#a0868f',
  },
  Hiring: { background: 'rgb(19, 18, 4)', color: '#fac800', colorAlt: '#9b9a7d' },
  Travel: { background: 'rgb(8, 14, 28)', color: '#54a2ff', colorAlt: '#8a959b' },
  Crypto: { background: 'rgb(6, 20, 15)', color: '#00d294', colorAlt: '#7d9b90' },
  Parenting: {
    background: 'rgb(14, 8, 26)',
    color: '#c07eff',
    colorAlt: '#8d86a0',
  },
  Health: { background: 'rgb(4, 16, 26)', color: '#00d2ef', colorAlt: '#7d939b' },
}
