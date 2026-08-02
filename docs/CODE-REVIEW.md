# OPENSHELF function-level review

Review date: 2026-08-02. Scope: PR/local branch payment, search, authority,
persona-memory, orchestration, account, and chat data paths. Purely visual React
render helpers are covered by TypeScript build and lint, but are not treated as
security boundaries here.

Status meanings: **PASS** has no blocking issue in the present MVP; **FIXED**
had a concrete defect corrected in this review; **FOLLOW-UP** is intentionally
incomplete or needs production infrastructure.

## `backend/src/main.rs` and `backend/src/lib.rs`

| Function | Status | Review |
| --- | --- | --- |
| `main` | FIXED | Defaults to loopback. A non-loopback bind now refuses the known development token and requires at least 32 characters. |
| `shutdown_signal` | PASS | Handles Ctrl-C and Unix TERM for graceful Axum shutdown. |
| `build_app` | FIXED | CORS origin is now configured by `FRONTEND_ORIGIN`; credentials remain restricted to one exact origin. |
| `demo_app` | PASS | Enables the demo opener only in the explicit test/demo constructor. |

## `backend/src/api.rs`

| Function | Status | Review |
| --- | --- | --- |
| `AppState::new` | PASS | Centralizes internal-token hash, Devnet quote policy, and explicit demo flag. Invalid numeric env values fall back safely, although startup-time config validation would be clearer. |
| `with_demo_open` | PASS | Narrow opt-in used by tests. |
| `router` | PASS | Public, authenticated, demo, and internal ledger routes are visibly separated. |
| `health` | PASS | No sensitive state is disclosed. |
| `register` | PASS | Validates password, hashes with Argon2, creates user and session transactionally through the store. |
| `login` | PASS | Returns one generic credential error and verifies the stored Argon2 hash. Rate limiting is still a deployment follow-up. |
| `logout` | FIXED | Revokes the server-side session and clears the cookie; `Secure` is configurable for HTTPS. |
| `me` | PASS | Requires a real session and derives the user from it. |
| `resolve_question` | PASS | Searches only active documents and persists the exact query/match quote before payment. |
| `synthesize_answer` | FIXED | Ignores client-provided question/excerpts and reloads canonical paid evidence. The query ID plus paid handles acts as a bearer capability; stronger payer/session binding is a follow-up. |
| `list_open_calls` | PASS | Anonymous listing is allowed; eligibility is computed only when a profile is authenticated. |
| `create_open_call` | PASS | Uses session identity, not a client user ID. |
| `submit_answer` | PASS | Uses session identity and passes bounded interview context to the transactional store path. |
| `cancel_open_call` | PASS | Owner identity comes from the session. |
| `chat_answers` | PASS | Only the call owner can retrieve answers for their chat. |
| `list_memory` | PASS | User-scoped by authenticated identity. |
| `submit_dispute` / `my_dispute` | PASS | User-scoped and store-enforced. |
| `list_disputes` / `review_dispute` | PASS | Store performs the final admin-role check. |
| `account_controls` / `get_balance` | PASS | Authenticated and user-scoped. |
| `delete_account` | FIXED | Clears the session cookie after the store transaction; secure-cookie deployment mode is supported. |
| `get_profile` / `upsert_profile` / `update_preferences` | PASS | Authenticated, with server validation of category bands and Solana wallet encoding. |
| `get_earnings` | PASS | Authenticated; releases matured held balances before reading. |
| `open_documents` | FIXED | Production default is now 403. The non-chain opener requires `OPENSHELF_ALLOW_DEMO_OPEN=true`. |
| `payment_quote` / `paid_document` / `record_chain_settlement` | PASS | All require the internal service token. Paid content now requires `settled_at`; a settled quote remains readable after its challenge expiry. |
| `validate_password` / `hash_password` | PASS | Bounds work input and uses random salt plus Argon2. |
| `session_response` / `session_cookie` | FIXED | Stores only a SHA-256 token hash and supports `HttpOnly`, `SameSite=Lax`, and optional `Secure`. |
| `authenticated` / `optional_authenticated` / `session_token` | PASS | Supports bearer or cookie tokens; protected handlers never accept spoofed user IDs. |
| `token_hash` / `require_internal` | PASS | Raw session/internal tokens are not stored. A dedicated secret manager and rotation are deployment work. |
| `env_u64` / `env_bool` / `now_ms` | PASS | Deterministic parsing/fallback helpers. |

## `backend/src/store.rs`

| Function | Status | Review |
| --- | --- | --- |
| `StoredCall::public` | PASS | Derives `mine` and eligibility server-side. |
| `open` / `in_memory` / `from_connection` | PASS | Enables foreign keys, WAL for file DB, migration, and deterministic seed. A single mutex is correct for the MVP but not horizontally scalable. |
| `connection` | PASS | Converts poisoned-lock failure into an explicit store error. |
| `register_user` | PASS | User, signup credit, balance, and funding event share one transaction. |
| `password_record` | PASS | Excludes deleted users and does not disclose which credential failed. |
| `create_session` / `authenticate_session` / `revoke_session` | PASS | Expiry and deleted-user checks are server-side. |
| `balance` / `release_matured_holds` | FIXED | Hold release is transactional and verifies the balance row/invariant before commit. |
| `set_user_role` | PASS | Restricts role values. It is not publicly routed. |
| `provision_user_for_test` | PASS | Compiled only for tests. |
| `migrate` | PASS | Establishes uniqueness, foreign keys, non-negative checks, idempotency indexes, and backward-compatible columns. Formal versioned migrations remain a production need. |
| `seed` / seed helpers | PASS | Idempotent demo data. Seed authority edges are explicitly curator-labelled. |
| `documents` | PASS | Hides locked, opted-out, and strike-blocked personas before retrieval. |
| `evidence_edges` | PASS | Returns only edges whose source and target documents are active. |
| `verify_opened_documents` / `opened_evidence` | FIXED | Requires 1–20 unique handles, proves each was settled for the query, and reloads canonical question/content/prices. |
| `record_resolution` | PASS | Query and exact ordered matches are committed together. |
| `list_open_calls` | PASS | Includes active/filled calls and only exposes a user's own cancelled calls. |
| `create_open_call` | PASS | Uses checked multiplication and atomically moves the complete budget to reserved escrow. |
| `submit_answer` | FIXED | Bounds answer/context, enforces profile targeting, self/duplicate/full-call checks, creates searchable memory only for accepted answers, and verifies reserved-balance mutation. |
| `list_memory` / `account_controls` | PASS | User-scoped views with strike/dispute state. |
| `get_profile` / `upsert_profile` / `update_preferences` | PASS | Enforces enum-like bands, unique anonymous handle, unique categories, and 32-byte Solana wallet decoding. |
| `earnings` | PASS | Separates accrued, held, and on-chain events. KRW values are accounting snapshots, not a fiat redemption system. |
| `submit_dispute` | PASS | One bounded dispute per account and only for a voided answer. |
| `list_disputes` / `review_dispute` / `require_admin` | FIXED | Admin-only review; approved restoration rechecks capacity/escrow and verifies the reserved-balance update. |
| `cancel_open_call` | PASS | Owner-only, transactional refund with balance invariant check. |
| `chat_answers` | PASS | Joins through call ownership and returns only settled memory. |
| `delete_account` | FIXED | Refunds escrow, removes evidence edges before documents, anonymizes immutable financial history, deletes private persona data, and verifies balance mutation. |
| `payment_quote` | PASS | Quotes only a preselected active document, validates recipient public key, rounds KRW→USDC upward, binds network/mint/amount/payee, and reuses one unexpired unpaid quote. |
| `paid_document` | FIXED | A quote alone is insufficient; `settled_at` is mandatory. Settlement, not challenge TTL, controls release after payment. |
| `record_chain_settlement` | FIXED | Validates real base58 byte lengths, rejects self-payment, bounds raw receipts, compares quote network/mint/payee/amount, is idempotent, and accrues once. It trusts the internal gateway/facilitator receipt and does not independently query RPC. |
| `open_documents` | PASS | Idempotent sandbox-only settlement; unreachable in production unless the demo flag is explicitly enabled. |
| validation helpers | PASS | Profile, targeting, call, numeric conversion, ID, and row decoders are bounded and fail closed. |
| earning helpers | PASS | Unique settlement/document index prevents duplicate accrual. On-chain events snapshot the actual recipient wallet. |

## `backend/src/search.rs`

| Function | Status | Review |
| --- | --- | --- |
| `Resolver::new` | PASS | Precomputes deterministic local features and document frequency. |
| `with_evidence_edges` | PASS | Injects the authority graph without coupling storage to ranking. |
| `resolve` | PASS | Validates input, filters metadata before scoring, requires rare/named anchors, enforces budget, and limits one result per author. |
| `authority_scores` | PASS | Uses query relevance/trust as personalized teleport and normalizes PageRank. |
| `validate` | FIXED | Bounds question/count and rejects unsupported category or demographic filters. |
| `category_matches` / `demographics_match` | PASS | Exact server-side targeting. |
| `searchable_text` / `score` | PASS | Content stays private until payment; only local indexed features affect matching. |
| `suggested_price` / `rounded` / `query_id` | PASS | Deterministic median suggestion, stable display values, collision-resistant timestamp/hash/counter IDs. |
| `embed` / `features` / `word_terms` / `canonical_term` / `capitalised_terms` / `is_stopword` / `fnv1a` / `cosine` | FOLLOW-UP | This is a deterministic hashed lexical vector, not a learned semantic embedding. It is cheap and testable but weak for Korean paraphrases, synonyms, and unseen domains. |

## `backend/src/authority.rs`

| Function | Status | Review |
| --- | --- | --- |
| `personalized_page_rank` | PASS | Handles dangling nodes, query-personalized teleport, weighted outgoing edges, and deterministic 40-step convergence. |
| `effective_weight` | PASS | Organic/admin/outcome evidence can propagate authority; sponsored, paid, self, UGC, inferred, dispute, and lineage edges cannot buy positive rank. |
| `normalise_or_uniform` | PASS | Prevents zero distributions. |

Production still needs an authenticated edge-ingestion and outcome-verification
pipeline. Today the meaningful graph is seeded/curated; it is not yet a live
web-scale link graph.

## `backend/src/orchestrator.rs`

| Function | Status | Review |
| --- | --- | --- |
| `synthesize` | FIXED | Reuses a timeout-bound HTTP client, tries Vertex then API-key Gemini, and falls back without fabricating model work. |
| `validate` | PASS | Bounds paid evidence count and passage size. |
| `generation_body` | FIXED | Separates system instruction from untrusted evidence and requests strict JSON. |
| `parse_provider_response` | FIXED | Concatenates provider parts, rejects unpaid inline citations, clamps scores/confidence, removes invented/duplicate handles, and overwrites model/mode metadata. |
| `fallback` | PASS | Shows purchased evidence verbatim with zero confidence and explicit no-model status. |

## `payment-gateway/src/main.ts`

| Function/hook | Status | Review |
| --- | --- | --- |
| `internalJson` | FIXED | Adds a 10-second timeout and keeps detailed upstream errors in server logs only. |
| `identityFromPath` / `identityFromContext` | PASS | Accept only the one paid-resource route and decode query/handle safely. |
| `getQuote` / `quoteForContext` | PASS | Deduplicates concurrent quote requests and rejects network drift. |
| `recordSettlement` | PASS | Mirrors to Rust idempotently, then marks the durable outbox entry completed. |
| `appendOutbox` / `restoreOutbox` / `retryPendingSettlements` | PASS | Crash-replays pending receipts. File compaction, fsync policy, schema versioning, and multi-process locking are production follow-ups. |
| `onAfterVerify` | FIXED | Rejects payer=recipient before settlement. |
| `onAfterSettle` | FIXED | Uses the exact cached challenge quote, records mint/payee/amount/network/signature, and queues reconciliation on Rust failure. |
| CORS middleware | PASS | Allows only one configured browser origin and exposes payment headers. |
| health route | PASS | Reports pending reconciliation count without secrets. |
| `paymentMiddleware` configuration | PASS | One exact SVM payment per document, dynamic payee and atomic price, 60-second payment timeout. |
| paid document handler | PASS | Retrieves content only through the internal settled-quote endpoint. |
| error middleware / env helpers | PASS | Generic client error, detailed server log, validated positive integer port. |

## Browser and agent payment clients

| Function | Status | Review |
| --- | --- | --- |
| `openDocuments` | PASS | Selects backend/x402/offline mode explicitly; production default is x402. |
| `openOverX402` | PASS | Requires Phantom, restricts to Solana Devnet exact/SVM, purchases sequentially per author, records facilitator receipts, and returns explicit partial success. |
| `openLocally` | PASS | Available only when the backend is explicitly disabled and labels settlement as offline. |
| `explorerUrl` | PASS | Maps non-mainnet receipts to Devnet explorer. |
| `phantomSvmSigner` | PASS | Keeps key custody in Phantom and exposes only the transaction-modifying signer interface. |
| `payment-gateway/src/client.ts` | PASS | Disposable agent client with network and maximum-amount policy. |
| `scripts/devnet-x402-smoke.ts` | PASS | Uses an in-memory payer, checks the 402 quote, pays once, reads the confirmed Devnet transaction, and asserts exact USDC payer/recipient deltas. |

The Vite bundle reports that an x402/SVM dependency imports Node `crypto`, which
Vite externalizes. A real Chrome load currently succeeds, but this remains a
dependency/bundle risk and should be regression-tested whenever x402 packages
change.

## `src/lib/api.ts`, `src/state/ui.tsx`, and chat flow

| Function/path | Status | Review |
| --- | --- | --- |
| `apiFetch` and exported API wrappers | PASS | Central error parsing, credential inclusion, and server-authoritative DTO mapping. |
| `resolveQuestion` / `synthesizeAnswer` | PASS | Search metadata is free; synthesis sends handles but the server reloads all evidence. |
| `UiProvider` actions | FIXED | Server-backed account/call/memory state is normalized; assistant messages are idempotent by ID to avoid poll/StrictMode duplicates. |
| Chat resolve→pay→synthesize flow | FIXED | Handles hit, miss/open-call, partial payment, later answers, and displays “on-chain” only when a Solana transaction signature exists. |
| Survey flow | PASS | Sends the primary answer plus a bounded small-talk context that becomes private memory context. |

## Pay.sh verdict

The official Pay.sh 0.26.0 CLI was tested successfully for its intended local
compatibility path: plain `curl` returned 402 and `pay --sandbox curl` paid
localnet USDC and received the passage. `backend/paywall.yml` now advertises
USDC only and is runnable through `npm run pay:gateway:sandbox`.

Pay.sh is not the production settlement gateway in this branch. Its static YAML
charges one fixed operator price and cannot express request-time persona-owner
wallets and prices. The dynamic x402/SVM gateway remains the correct Devnet
path. See `docs/PAY-SH.md`.

## Remaining product gaps

1. Persona passages and interview context are plaintext SQLite rows; field-level
   encryption, consent versions, purpose limitation, retention, export, and
   deletion audit proofs are still required before collecting sensitive data.
2. The “memory stream” currently stores accepted answer plus up to eight context
   turns. Importance scoring, recency retrieval, reflection, and higher-level
   belief/trait state are not implemented yet.
3. Open-call escrow is sandbox KRW accounting. Only document opens use direct
   Devnet USDC. A complete on-chain bounty escrow/release contract is separate
   work.
4. The app trusts the configured x402 facilitator at the internal ledger
   boundary. Independent RPC verification exists in the smoke test, not in the
   live Rust ingestion path.
5. No request throttling, bot/Sybil staking, proof-of-personhood, or calibrated
   answer-quality reputation is deployed yet.
6. SQLite plus an in-process mutex and NDJSON outbox is a sound demo topology,
   not a multi-instance production architecture.
