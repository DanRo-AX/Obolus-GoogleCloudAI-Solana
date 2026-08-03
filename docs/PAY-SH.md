# Pay.sh research-payment architecture

## One flow for the website and autonomous agents

1. Search and ranking are free. The Rust API commits the exact document set,
   recipients, prices, hashes, mint, network, and per-document rounded atomic
   amounts into a durable research job.
2. The user proves current wallet possession with a fresh Phantom `signMessage`.
   OPENSHELF issues a revocable 30-day prepaid spending capability scoped only
   to that verified wallet's internal balance; a previously saved payout wallet
   is not sufficient by itself.
3. If the balance is low, Phantom signs an x402 USDC refill to the bounded GCP
   KMS service wallet. Rust credits the confirmed atomic amount and reserves
   the exact question budget in one SQLite transaction. Later questions skip
   Phantom while the balance is sufficient.
4. The Cloud Run orchestrator loads only funded jobs and uses
   `@solana/pay-kit/client` with a GCP KMS signer to satisfy each official
   Pay.sh MPP challenge independently.
5. Pay.sh sends the document share directly to its verified owner and proxies
   the paid request to Rust. Only this callback marks that exact quote delivered
   and returns its citation.
6. All documents paid means `completed`. A permanent partial failure restores
   the unpaid atomic remainder to the prepaid balance; legacy direct-deposit
   jobs still use an on-chain refund claim.

The query token is never stored in plaintext. Internal Pay.sh delivery is bound
to `(research job, query, document, quote)` and also requires the shared internal
service credential injected by the Pay.sh proxy.

## Key custody

- Phantom key: remains in the browser extension and signs wallet proof/refills.
- Prepaid session: an expiring OPENSHELF capability; it can reserve only the
  verified wallet's deposited balance and has no Solana signing authority.
- User withdrawal/delegate authority: none is granted to OPENSHELF.
- Service key: an Ed25519 key in Google Cloud KMS. Cloud Run receives only a
  signing API through IAM; it cannot export the private key.
- DB owner key: never used by OPENSHELF; the owner only publishes a verified
  receiving address.

## Antigravity and Pay MCP on Devnet

The OpenShelf Antigravity plugin keeps quote creation and wallet signing in
separate MCP trust boundaries. An `openshelf` tool prepares a short-lived exact
payment URL and returns `approval_required`. After the model shows the exact
intent, the user approves one aggregate payment. Only then may the agent call
Pay's `curl` MCP tool, which signs locally and retries the same x402 URL.

Install and verify:

```bash
agy plugin install ./integrations/antigravity/openshelf
npm run agent:doctor
agy plugin validate ./integrations/antigravity/openshelf
```

Pay supports named local accounts. Use `pay account list` and
`pay account default NAME`, or set `OPENSHELF_PAY_ACCOUNT=NAME` for the plugin.
Google login, OpenShelf marketplace sessions, and Pay wallet accounts remain
independent; see [`ACCOUNT-LINKING.md`](./ACCOUNT-LINKING.md).

The KMS wallet is intentionally bounded: fund it with only operating SOL plus
prepaid deposits. Each job reserves the sum of independently rounded Pay.sh
atomic charges, preventing per-document rounding underfunding or overspending.

## Crash and replay behavior

- The browser stores the job id before Phantom opens for a required refill.
- The outer x402 gateway writes settled transactions to an append-only outbox.
  The checked-in default is a local NDJSON file for Devnet. A Cloud Run release
  must place it on persistent storage or replace it with a transactional queue;
  an instance-local filesystem is not a durability boundary.
- The orchestrator polls `funded` and `processing` jobs, so the browser may close.
- Before retrying a failed HTTP call, the worker reloads the plan. If the quote
  disappeared, Rust already recorded delivery and it is not paid again.
- Refund transfers use the existing prepare/broadcast/confirm payout ledger, so
  a worker crash replays the same signed transaction instead of creating a new
  payment.
- Cloud Run is deployed with one warm instance, always-allocated CPU, and
  `max-instances=1`; the process also coalesces the same job id. This keeps job
  and refund polling alive after the browser closes. A multi-instance
  production deployment should add a DB lease.

## Local verification

```bash
npm run build
npm --prefix payment-gateway test
npm --prefix agent-orchestrator test
cargo test --manifest-path backend/Cargo.toml
```

The Pay.sh sandbox smoke test still verifies a direct external-agent purchase:

```bash
npm run pay:gateway:sandbox
npm run pay:smoke -- --gateway http://127.0.0.1:3402
```

## Google Cloud deployment

The same KMS public key must be configured as:

- `OPENSHELF_BUNDLE_RECEIVER` on Rust;
- `OPENSHELF_PAY_GCP_KMS_PUBKEY` on Pay.sh and the orchestrator;
- the funded Devnet USDC/SOL wallet.

Deploy Pay.sh with `pay/cloudbuild.yaml`, then deploy the worker with
`agent-orchestrator/cloudbuild.yaml`. Its service account needs KMS public-key
read and asymmetric-sign permissions. Secrets are injected from Secret Manager;
no keypair file is required.

An actual Devnet transfer additionally requires the configured KMS key, IAM,
managed RPC, SOL fees, and Devnet USDC. Unit/integration tests do not fabricate
an on-chain success when those external resources are absent.
