# Agent payment session threat model

Status: policy gate implemented; unattended signing deliberately disabled.
Manual browser-wallet approval remains the only enabled end-user authority, but
an exact multi-document bundle or paid open-call target now requires one
approval rather than one approval per author/answer. The pure evaluator in
`payment-gateway/src/agent-payment-policy.ts` fails closed over every envelope
field below, and its tests cover substitution, overflow, replay, expiry,
revocation, and response loss. It does not create or retain a signing key.

## Assets and trust boundaries

- The user's Solana signing authority and delegated session key.
- Devnet or mainnet USDC controlled by the delegation.
- The Rust query, payment quote, and chain-settlement ledgers.
- The x402 resource origin and facilitator response.
- Browser storage, which is untrusted and may be edited by the user or malware.

The Rust API is authoritative for the quoted document, recipient, network, mint,
amount, expiry, and whether a settlement already exists. A client-side policy is
display state only and cannot authorize a transfer by itself.

## Required policy envelope

A session must bind all of the following in a signed, revocable capability:

- delegated public key and parent wallet;
- Solana network and exact USDC mint;
- x402 gateway origin and Rust API origin;
- maximum atomic amount per document;
- maximum atomic amount per query;
- rolling daily maximum;
- exact query identifier and allowed recipient derivation rule;
- issued-at, expiry, unique nonce, and revocation identifier.

The session must refuse a request when any field is absent, changed, expired, or
over budget. It must never fall back to an unrestricted wallet approval.

## Threats and mandatory tests

| Threat | Required control | Test |
| --- | --- | --- |
| Network substitution | Exact CAIP-2 network allowlist | Mainnet/devnet swap is rejected |
| Mint substitution | Exact USDC mint allowlist | Unknown asset is rejected |
| Amount inflation | Per-document, query, and daily atomic caps | One-unit overflow is rejected |
| Recipient substitution | Recipient must match the Rust quote | Changed `payTo` is rejected |
| Origin confusion | Exact HTTPS origin allowlist | Lookalike gateway is rejected |
| Replay | Nonce plus settlement idempotency | Reused capability cannot pay twice |
| Expired authority | Short expiry checked at signing time | Expired key is rejected |
| Stolen browser state | Secret never stored in localStorage | Reload exposes no signing material |
| User revocation | Server and wallet revocation checks | Revoked session is immediately rejected |
| Response loss | Rust-ledger reconciliation before retry | Settled document is recovered, not repaid |

## Signing decision still required

Choose a Solana wallet/session-key mechanism that supports non-custodial scoped
delegation and revocation. Do not create a proprietary custody scheme or send a
secret key to the Rust API. Once selected, bind its verified proof and atomic
nonce/daily counters to the existing evaluator, then run an independent security
review and an end-to-end Devnet test before the disabled UI gate can be removed.
