# Pay.sh integration boundary

OPENSHELF has two payment test paths with different responsibilities.

## Dynamic Solana Devnet settlement

`payment-gateway/src/main.ts` is the application payment boundary. Each search
result creates a short-lived quote that commits to one document version, its
owner's verified wallet, the exact USDC amount, network, query, and handle. The
x402 facilitator verifies and settles the transfer before Rust releases the
snapshotted passage.

The custom gateway is required because the recipient and price can differ for
every selected contributor document.

## Official Pay.sh sandbox compatibility

`backend/paywall.yml` is a static localnet compatibility spec. It is useful for
checking that Pay.sh-enabled agents can discover the free search endpoint,
receive HTTP 402 on the passage endpoint, authorize sandbox USDC, and retry.
It is not proof of a Devnet or mainnet settlement.

Start Rust with the demo opener explicitly enabled, then start Pay.sh:

```bash
OPENSHELF_ALLOW_DEMO_OPEN=true cargo run --manifest-path backend/Cargo.toml
npm run pay:gateway:sandbox
```

The production direction is to retain the dynamic x402 gateway for direct
contributor revenue routing and publish discovery metadata only after there is
a live mainnet endpoint.
