/** Only an explicit HTTP 401 may clear an existing authenticated UI session. */
export function shouldClearAuthentication(status: number | undefined): boolean {
  return status === 401
}
