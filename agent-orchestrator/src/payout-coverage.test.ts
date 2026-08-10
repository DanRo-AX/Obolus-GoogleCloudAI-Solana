import assert from 'node:assert/strict'
import test from 'node:test'
import { payoutCoverageIssue, type PayoutClaimBacklog } from './payout-coverage.js'

const network = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'
const oldWallet = 'old-kms-wallet'
const newWallet = 'new-kms-wallet'

function backlog(overrides: Partial<PayoutClaimBacklog> = {}): PayoutClaimBacklog {
  return {
    escrowWallet: newWallet,
    network,
    claimCount: 1,
    preparedCount: 0,
    blockedCount: 0,
    oldestCreatedAt: 1_786_000_000_000,
    ...overrides,
  }
}

test('a new KMS signer cannot report ready while the old wallet still owes a refund', () => {
  const issue = payoutCoverageIssue([
    backlog({
      escrowWallet: oldWallet,
      claimCount: 2,
      preparedCount: 1,
    }),
  ], newWallet, network)

  assert.match(issue ?? '', /2 payout claim\(s\) require a different escrow signer/)
})

test('normal work for this signer stays ready but exhausted work does not disappear', () => {
  assert.equal(payoutCoverageIssue([backlog()], newWallet, network), null)
  assert.match(
    payoutCoverageIssue([backlog({ blockedCount: 1 })], newWallet, network) ?? '',
    /1 payout claim\(s\) have exhausted or invalid work state/,
  )
  assert.match(
    payoutCoverageIssue([backlog({ network: 'solana:wrong-network' })], newWallet, network) ?? '',
    /different escrow signer or network/,
  )
})

test('a version-skewed or malformed backlog response fails readiness closed', () => {
  assert.match(
    payoutCoverageIssue({ rows: [] }, newWallet, network) ?? '',
    /not an array/,
  )
  assert.match(
    payoutCoverageIssue([
      { ...backlog(), claimCount: '1' },
    ], newWallet, network) ?? '',
    /malformed or unsafe counts/,
  )
  assert.match(
    payoutCoverageIssue([
      backlog({ claimCount: 1, preparedCount: 2 }),
    ], newWallet, network) ?? '',
    /malformed or unsafe counts/,
  )
})
