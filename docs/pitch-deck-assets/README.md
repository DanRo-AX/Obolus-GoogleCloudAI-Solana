# Obulus pitch deck screenshots

Captured from the local product server at `http://127.0.0.1:4321` on 2026-08-03.
All images use a 1440px-wide desktop viewport.

## Recommended main-deck images

| File | Best use |
| --- | --- |
| `03-login-product-flow.png` | Three-step product explanation: ask, rank human DBs, pay only for opened evidence |
| `10-chat-hit-exact-quote.png` | Core HIT flow: five matching people, exact total, bounded automatic Pay.sh settlement |
| `09-chat-ranked-human-evidence.png` | Core MISS flow: thin human coverage becomes an Open Call |
| `08-dashboard-live-demand.png` | Contributor-side marketplace, live paid demand, Gemini shelf starters |
| `07-onboarding-wallet-and-x402.png` | Devnet USDC payout address and separation between Phantom and local Pay/SIWX |
| `11-cli-mcp-agent-interface.png` | Actual CLI health/tool output, showing Obulus is agent infrastructure rather than only a website |

## Optional supporting images

| File | Best use |
| --- | --- |
| `01-home-hero.png` | Cover or product overview |
| `02-home-full.png` | Alternate home capture |
| `04-coverage-search-model.png` | Free discovery, query-specific authority and paid-boundary explanation |
| `05-pricing-paid-evidence.png` | Per-document pricing and bounded wallet authorization |
| `06-whitepaper-product-system.png` | Product thesis and x402 resource framing |

## Important presentation note

The current UI still contains the legacy names `OPENSHELF` and `SHELF-1`.
The pitch-deck brand is **Obulus** and the agent is **Obulus Agent**. Either recapture
the screens after completing the product rebrand or label these screenshots as
the current working build. Do not silently present edited labels as screenshots
of already-shipped UI.

The CLI image is a presentation crop generated from the real output of:

- `npm run agent:doctor`
- `npm run agent:tools`

At capture time the Rust API, x402 gateway and Pay.sh installation were ready,
but the local Pay account was not funded/configured for a live paid action. The
image therefore proves interface and integration readiness, not a completed
Devnet settlement receipt.
