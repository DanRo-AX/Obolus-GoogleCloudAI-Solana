# OPENSHELF consolidation and production review

Reviewed: 2026-08-02

Scope: PR #2 at `e94ff00`, draft PR #9 at `1655b46`, and the follow-up
consolidation changes on `agent/rust-x402-backend`.

## Merge graph verdict

PR #2 and PR #9 are sibling branches. They share `15462fd` as their merge base;
neither head contains the other. A green PR #2 therefore did not, by ancestry
alone, prove that PR #9 was included.

The implementations overlap heavily. PR #2 contains the PR #9 concepts in a
newer form and also adds query-scoped payment recovery, payout-wallet ownership
proof, buyer feedback, admin feedback review, partial-payment recovery, and the
final browser x402 fixes. Cherry-picking PR #9 wholesale would reintroduce older
versions of the same Rust, TypeScript, schema, and gateway code.

The safe consolidation strategy is to keep PR #2 as the merge candidate and
port only useful PR #9-only contracts and documentation.

| PR #9 area | PR #2 disposition |
| --- | --- |
| Versioned memory, correction, locking, reflection, access log | Present and extended |
| Topic-personalized PageRank and evidence provenance | Present in `authority.rs` and `search.rs` |
| Paid-evidence Gemini on Vertex AI orchestration | Present; now guarded by the query capability |
| Dynamic x402 quote and settlement mirror | Present and extended with recovery and stable SVM requirements |
| Persona public manifest URLs | Preserved as compatibility aliases; contributor URLs remain canonical |
| Devnet smoke path and Pay.sh note | Present in newer form |
| Old function-level review | Replaced by this review because several old PASS claims no longer matched the current tree |

## Fixed in the consolidation pass

- Paid synthesis now requires the secret query payment token. Previously a
  query ID plus settled handles could trigger model spend and reload paid
  evidence without that capability.
- Replaying synthesis no longer compounds the same model contribution into a
  document's reliability score.
- Server-backed paid chats and query tokens moved from durable `localStorage`
  to tab-session storage; older durable copies are removed.
- Backend mode no longer substitutes fake seeded calls or memories when a
  server request fails.
- Private responses default to `Cache-Control: no-store`; public manifests
  opt into a short explicit cache lifetime.
- Production refuses demo-open bypass, demo database seeding, insecure session
  cookies, an existing demo-seeded database, short/default internal tokens,
  insecure frontend origins, and the public Devnet RPC fallback.
- A non-loopback Rust bind requires a strong internal token. The default bind
  is loopback.
- The gateway and backend now derive production mode and shared network/origin
  defaults consistently.
- The restricted browser RPC proxy has a per-process rate-limit safety net and
  rejects non-configured browser origins in production.
- A user's real demo receiver address was removed from the regression fixture.
- Multi-document HITs now commit an exact bundle and require one x402 wallet
  approval. Rust records one immutable chain receipt plus one claimable earning
  per document/beneficiary; progress, response-loss recovery, synthesis, and
  buyer feedback accept both direct and bundle entitlements.

## Hard-coded policy and deployment values

These values are acceptable for the hackathon Devnet build but must not be
mistaken for production configuration.

| Value | Current location | Risk / required change |
| --- | --- | --- |
| Solana Devnet CAIP-2 ID and Circle Devnet USDC mint | Rust, gateway, browser | Mainnet requires one validated, server-delivered payment config rather than three build/runtime copies. |
| ₩1,350 per USDC | Rust quote policy and browser preview | Browser preview can drift from settlement. Return the active conversion policy from Rust or quote only in atomic USDC. |
| Seed prices, personas, calls, and content | `seed.rs`, frontend offline data | Demo-only. Production database seeding is now off by default. |
| ₩100,000 signup credit | `store.rs` | Sandbox accounting policy, not money. Make tenant/product policy explicit before launch. |
| 14-day hold, two-strike auto-match cutoff, three-strike suspension | `store.rs` and frontend copy | Centralize as versioned server policy; the UI should render server values. |
| 30-day session, quote TTL, login lock window | Rust constants/env | Operational policy needs rotation, cleanup jobs, and documented incident overrides. |
| `gemini-2.5-flash` | orchestrator default | Pin an approved model/config and record provider/data-processing changes. |
| localhost API/gateway URLs | dev fallbacks | Production builds must supply deployment URLs and HTTPS reverse-proxy rules. |

## Blocking gaps before a real public-value launch

1. **Durability and horizontal scale.** SQLite is behind one in-process mutex;
   the settlement outbox is append-only NDJSON on local disk. Use a durable
   database and transactional queue, define compaction, fsync, replay,
   multi-instance ownership, and backup/restore drills.
2. **Independent settlement assurance.** Rust trusts the internal gateway and
   facilitator receipt. Production needs finalized-chain verification and a
   reconciliation worker for the crash window between chain settlement and
   durable outbox append.
3. **Bundle escrow payouts.** Aggregate purchases now solve the N-approval UX,
   but funds are custodial until a separately secured payout executor sends the
   claim ledger to contributor wallets. Production needs KMS-backed signing,
   withdrawal/finality reconciliation, fee policy, and an operator runbook.
4. **Mainnet operations.** Managed RPC/facilitator, mainnet mint/network,
   allowlists, KMS/secrets rotation, monitoring, alerts, and incident runbooks
   remain absent. The current verified path is Devnet.
5. **Sensitive-data controls.** Persona passages and interview context are
   plaintext SQLite rows. Add encryption at rest/field level, retention jobs,
   staff authorization/audit logs, redaction workflows, and deletion evidence.
6. **Legal truthfulness.** The checked-in privacy policy promises a 30-day
   deletion grace period, 90-day backup erasure, every-access logging, named
   processor controls, TLS, and an in-service contact channel that the product
   does not yet implement. It also needs to disclose that demographic bands are
   free matching metadata and that paid passages may be sent to Gemini on Vertex AI
   for synthesis.
7. **Abuse controls.** Login has email-keyed throttling and the RPC proxy has a
   local safety limit, but registration, resolve, gateway quotes, model calls,
   open calls, and wallet identities still need distributed IP/account/wallet
   limits and Sybil controls at the edge.
8. **Account operations.** Email verification, password reset/recovery, admin
   bootstrap/rotation, reviewer staffing, service contact, and audit tooling are
   missing.
9. **Buyer capability lifecycle.** Query tokens are random and scoped, but have
   no explicit expiry or server-owned buyer chat history. Add expiry/revocation
   and authenticated or wallet-proven cross-device recovery.
10. **Open-call money.** Open-call escrow and signup balances are `KRW_SANDBOX`,
   not fiat custody or on-chain escrow. Commercial copy must keep that boundary.
11. **Frontend delivery security.** Add CSP, HSTS, frame policy, dependency/SBOM
    scanning, x402 browser-bundle regression coverage, and an explicit failure
    state instead of treating a backend outage as a signed-out session.

## Merge recommendation

After the consolidation commit passes the complete CI suite, PR #2 is the one
merge candidate for the hackathon/Devnet application. Do not merge PR #9 on top
of it. Close PR #9 as superseded with a link to PR #2.

That recommendation is not a production-launch approval. Mainnet or a public
service handling real user data/value remains blocked by the items above.
