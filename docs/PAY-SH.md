# Pay.sh integration boundary

OPENSHELF supports two payment test paths with different jobs.

## 1. Dynamic Solana Devnet path

`payment-gateway/src/main.ts` is the application payment boundary. A search
result creates one short-lived quote per memory passage. Each quote commits to
the passage owner's wallet, Circle Devnet USDC mint, exact atomic amount,
network, query, and handle. The x402 facilitator verifies and settles the
transfer before the private passage is released.

This custom gateway is necessary because OPENSHELF has a different recipient
and price for each selected persona passage. The static Pay.sh YAML cannot
express that request-time routing.

## 2. Official Pay.sh sandbox path

`backend/paywall.yml` is a deliberately static localnet compatibility spec. It
proves that Pay.sh-enabled agents can discover a free resolve endpoint, receive
an HTTP 402 on the passage endpoint, authorize sandbox USDC, and retry the
request. It must never be used as evidence of a Devnet or mainnet settlement.

Start Rust with the demo opener explicitly enabled:

```bash
OPENSHELF_ALLOW_DEMO_OPEN=true cargo run --manifest-path backend/Cargo.toml
```

Start the official Pay.sh 0.26+ sandbox gateway:

```bash
npm run pay:gateway:sandbox
```

Resolve a question through `http://127.0.0.1:3402/api/v1/questions/resolve`,
then compare a plain request and a Pay-enabled request:

```bash
curl -i 'http://127.0.0.1:3402/api/flash-research?queryId=QUERY_ID&docs=HANDLE'

npx --yes @solana/pay --sandbox --no-dna curl \
  'http://127.0.0.1:3402/api/flash-research?queryId=QUERY_ID&docs=HANDLE'
```

The first request must return 402. The second must return the paid passage.
Sandbox mode uses Surfpool localnet and ephemeral funds; it cannot pay a Devnet
challenge. A real Pay.sh account is also not created by repository scripts, so
wallet setup and key custody always remain an explicit user action.

## Production direction

Keep the dynamic x402 gateway for persona-owner revenue routing. When the API
is deployed on Solana mainnet, add a `PAY.md` plus an OpenAPI snapshot and run
Pay.sh catalog validation so agents can discover it. Public Pay.sh catalog
entries require a live mainnet USDC/USDT paid endpoint; a Devnet hackathon URL
is not publishable as a production provider.
