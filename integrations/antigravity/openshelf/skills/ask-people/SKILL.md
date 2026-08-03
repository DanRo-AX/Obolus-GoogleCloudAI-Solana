---
name: ask-people
description: Ask people through OpenShelf, buy exact human evidence with Pay.sh, or fund missing human answers.
---

# Ask people through OpenShelf

Use this workflow when the user wants current, lived, attributable human knowledge rather than a generic web or model answer.

Antigravity CLI lazy-loads MCP tools. Read `~/.gemini/antigravity-cli/mcp/<server>/<tool>.json`, then invoke the built-in `call_mcp_tool` dispatcher directly. A server tool need not appear as its own top-level tool. Do not search the plugin source, define a subagent, or execute files under `runtime/` through a shell as a substitute for MCP.

If Antigravity CLI 1.1.10 returns `unknown_tool` for its advertised `call_mcp_tool`, use the reviewed CLI transport that calls the identical tool implementation: `node ~/.gemini/config/plugins/openshelf/runtime/server.mjs call TOOL --json-b64 BASE64`. Encode the UTF-8 JSON object as one canonical base64 token; never put user text directly in a shell command and never read `.env`. This command still requires Antigravity command approval.

1. Call the `ask_people` tool on the `openshelf` MCP server with the concrete question, requested human count, budget, and only the targeting filters the user actually specified.
2. Explain the returned human coverage and prices. If a free AI baseline is useful while waiting, call `openshelf/generate_ai_baseline` and label every part as general AI orientation, never human evidence.
3. On a hit, let the user choose the exact matched documents. Call `openshelf/prepare_evidence_payment` once for the chosen set.
4. Show the returned exact KRW/USDC amount, document count, Devnet network, and purpose. After explicit approval, call the `curl` tool on the `pay` MCP server with the returned `paymentUrl` and method `GET`. If the same Antigravity dispatcher bug blocks Pay MCP, run `pay curl PAYMENT_URL` only after that approval; the URL must be the unchanged value returned by OpenShelf. Pay.sh will request local wallet authorization and retry the x402 request. Never use Pay sandbox for the public Devnet URL.
5. Use the paid response's document handles with `openshelf/synthesize_human_answer`. Present citations, consensus, and disagreements instead of smoothing away conflict.
6. On a miss or partial gap, agree on reward per answer, answer count, cohort, and total budget. Call `openshelf/prepare_open_call`, show the exact aggregate escrow amount, then use `pay/curl` only after approval.
7. Poll `openshelf/open_call_status` with the quote id until it contains an `openCallId`; later poll by `chatId` for incoming human answers. Cancel only when the user asks, relying on unused-slot refund rules.

If Pay reports insufficient funds, use `pay/get_balance` and `pay/topup`. The Pay account needs Devnet USDC for this challenge and does not need SOL because the server fee payer handles network fees.
