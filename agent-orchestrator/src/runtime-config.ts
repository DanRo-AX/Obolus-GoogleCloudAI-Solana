export function integerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  environment: NodeJS.ProcessEnv = process.env,
): number {
  if (
    !Number.isSafeInteger(fallback)
    || fallback < minimum
    || fallback > maximum
    || !Number.isSafeInteger(minimum)
    || !Number.isSafeInteger(maximum)
    || minimum > maximum
  ) {
    throw new Error(`invalid integer configuration contract for ${name}`)
  }
  const raw = environment[name]?.trim()
  if (!raw) return fallback
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be a base-10 integer between ${minimum} and ${maximum}`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}
