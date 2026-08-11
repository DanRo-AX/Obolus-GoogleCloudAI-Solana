export const browserPreferences = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  webSecurity: true,
})

export function isAllowedNavigation(target, rendererUrl) {
  try {
    const candidate = new URL(target)
    const renderer = new URL(rendererUrl)
    return candidate.protocol === 'file:' && candidate.href === renderer.href
  } catch {
    return false
  }
}
