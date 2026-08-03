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

## Antigravity and Pay MCP on Devnet

The OpenShelf Antigravity plugin keeps quote creation and wallet signing in
separate MCP trust boundaries. An `openshelf` tool prepares a short-lived exact
payment URL and returns `approval_required`. After the model shows the purpose,
document/slot count, KRW and USDC amount, network, mint, recipient, and expiry,
the user approves one aggregate payment. Only then may the agent call Pay's
`curl` MCP tool, which signs locally and retries the same x402 URL.

Install and verify:

```bash
agy plugin install ./integrations/antigravity/openshelf
npm run agent:doctor
agy plugin validate ./integrations/antigravity/openshelf
```

Pay 0.27.0 implements the stable MCP handshake while Antigravity CLI 1.1.10
first probes a newer draft discovery method. The plugin's
`runtime/pay-compat.mjs` answers only that probe with JSON-RPC `Method not
found`, causing Antigravity to fall back, and forwards every stable message to
the official `pay mcp` process. It does not inspect or modify payment calls.

CLI 1.1.10 may also advertise the lazy `call_mcp_tool` dispatcher and reject
the same name at execution time. Until that client defect is fixed, the plugin
uses `server.mjs call TOOL --json-b64 BASE64` as an explicit OpenShelf
compatibility transport; it reaches the identical tool implementation and
keeps arbitrary user text out of shell syntax. For Pay, the equivalent fallback
is `pay curl PAYMENT_URL`, but only after the exact Devnet intent has been shown
and approved. No persistent broad command or MCP permission is required.

Pay supports named local accounts. Use `pay account list` and
`pay account default NAME`, or set `OPENSHELF_PAY_ACCOUNT=NAME` for the plugin.
Google login, OpenShelf marketplace sessions, and Pay wallet accounts are
deliberately independent; see [`ACCOUNT-LINKING.md`](./ACCOUNT-LINKING.md).

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
contributor revenue routing. Mainnet operation remains intentionally disabled.
