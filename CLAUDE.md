# Obolus — project instructions

Obolus (repo dir `frames-clone`, GitHub `DanRo-AX/Obolus-GoogleCloudAI-Solana`):
the internet as a database, priced per document over HTTP 402. Google Cloud ×
Solana AI Agentic Hackathon — **Top 10 finalist, Demo Day 2026-08-21**.
Product source of truth: `BRIEF.md` (Korean). Status boundaries: `README.md`
"Project status" + `SCENARIO-AUDIT.md`.

## Architecture (5 pieces)

| Piece | Stack | Port | Role |
| --- | --- | --- | --- |
| `src/` | React 19 + TS + Vite 8 + Tailwind 4 | 4319 | UI; `pages/Chat.tsx` is the HIT/MISS dialogue state machine |
| `backend/` | Rust 1.89 / Axum / SQLite (+ Postgres via `db.rs` for Cloud SQL Seoul) | 8787 | Search/rank, ledger, escrow, disputes, sessions — owns ALL money and identity |
| `payment-gateway/` | Node/TS | 1402 | x402 v2 exact/SVM quotes, verify/settle, payout worker, durable outbox |
| `agent-orchestrator/` | Node/TS, Cloud Run | — | KMS-signed server agent paying each document's Pay.sh challenge |
| `integrations/antigravity/openshelf/` | MCP runtime (`server.mjs`) | — | 23 MCP tools; Pay.sh wallet stays behind a handshake adapter |

`pay/` = Pay.sh Dockerfile + GCP KMS Cloud Run deploy. `deploy/cloud-run/` =
Cloud Build for api/web/images (juneyoon's Seoul managed-services commit).

## Commands

- Dev all-in-one: `npm run dev:stack` (frontend + Rust API + x402 gateway; needs `.env` from `.env.example`)
- No env/Rust needed: `node scripts/mock-backend.mjs` (seeded mock backend), `npm run demo:record` (E2E video)
- Full gate: `npm run check:all` — build, oxlint, agent tests, both node workspaces typecheck+test, `cargo test` + `clippy -D warnings`
- Backend only: `cd backend && cargo run` (defaults work; SQLite `openshelf.db`)

## Invariants (do not break)

- Search returns handles + prices, **never a passage**. Content is released only via `/api/flash-research` or a settled quote for that exact query ID.
- No private key, browser helper key, or SPL delegate ever reaches Rust, the gateway, or Cloud Run. Service wallet signs through GCP KMS only.
- `/internal/v1/*` requires `OPENSHELF_INTERNAL_TOKEN` (shared Rust ↔ gateway).
- Identity comes from the HttpOnly session cookie; client-supplied `userId` is rejected.
- AI (Gemini on Vertex) is liquidity, never an author: `ai_baselines` are ₩0, expiring, non-sellable, no path into documents/authority/memory/settlement.
- `KRW_SANDBOX` ledger is labelled sandbox, not fiat. Keep `OPENSHELF_ALLOW_DEMO_OPEN=false` publicly.
- Historic name is OPENSHELF/SHELF — env vars, Rust crate, DB names keep it. User-facing copy says **Obolus** (never "Obulus").

## Conventions

- Commit messages: lowercase-start imperative sentences with product voice ("Add a seeded mock backend and a recorded end-to-end pass"). No conventional-commit prefixes.
- PR flow: feature branch → PR → merge commit (see #17, #18). Never force-push shared branches.
- Copy tone: EN and KO are separately authored, not translated; KO uses 합니다체 (see `BRIEF.md` 톤 section).
- i18n lives in `src/i18n/`; Korean gets its own type stack and `word-break: keep-all`.

## Where to look

| I want to… | Look at |
| --- | --- |
| Change the ask/HIT/MISS flow | `src/pages/Chat.tsx`, `backend/src/search.rs`, `orchestrator.rs` |
| Touch money/escrow/refunds | `backend/src/store.rs` (12k lines — read the exact function, not the file) |
| Payment protocol | `src/lib/x402.ts`, `payment-gateway/src/x402-svm.ts`, `docs/agent-payment-threat-model.md` |
| Agent tools | `integrations/antigravity/openshelf/runtime/` |
| Deploy | `deploy/cloud-run/`, `pay/PAY.md`, `docs/PAY-SH.md` |
| Remaining work, priority-ordered | `SCENARIO-AUDIT.md` §"Remaining product and production work" |
