export type PayoutClaimBacklog = {
  escrowWallet: string
  network: string
  claimCount: number
  preparedCount: number
  blockedCount: number
  oldestCreatedAt: number
}

/**
 * Returns the operational reason this signer cannot cover all durable payout
 * liabilities. A key rotation is safe only after the old wallet's rows drain.
 */
export function payoutCoverageIssue(
  backlogs: unknown,
  signerAddress: string,
  network: string,
): string | null {
  if (!Array.isArray(backlogs)) return 'payout backlog response is not an array'
  if (!backlogs.every(isPayoutClaimBacklog)) {
    return 'payout backlog response contains malformed or unsafe counts'
  }
  const uncovered = backlogs.filter(
    (backlog) => backlog.claimCount > 0
      && (backlog.escrowWallet !== signerAddress || backlog.network !== network),
  )
  const blocked = backlogs.filter(
    (backlog) => backlog.claimCount > 0
      && backlog.escrowWallet === signerAddress
      && backlog.network === network
      && backlog.blockedCount > 0,
  )
  if (uncovered.length === 0 && blocked.length === 0) return null

  const uncoveredClaims = uncovered.reduce((sum, backlog) => sum + backlog.claimCount, 0)
  const blockedClaims = blocked.reduce((sum, backlog) => sum + backlog.blockedCount, 0)
  if (!Number.isSafeInteger(uncoveredClaims) || !Number.isSafeInteger(blockedClaims)) {
    return 'payout backlog totals exceed the safe integer range'
  }
  return [
    `${uncoveredClaims} payout claim(s) require a different escrow signer or network`,
    `${blockedClaims} payout claim(s) have exhausted or invalid work state`,
  ].join('; ')
}

function isPayoutClaimBacklog(value: unknown): value is PayoutClaimBacklog {
  if (value == null || typeof value !== 'object') return false
  const candidate = value as Partial<PayoutClaimBacklog>
  return typeof candidate.escrowWallet === 'string'
    && candidate.escrowWallet.length > 0
    && typeof candidate.network === 'string'
    && candidate.network.length > 0
    && safeCount(candidate.claimCount)
    && safeCount(candidate.preparedCount)
    && safeCount(candidate.blockedCount)
    && safeCount(candidate.oldestCreatedAt)
    && candidate.preparedCount <= candidate.claimCount
    && candidate.blockedCount <= candidate.claimCount
}

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
