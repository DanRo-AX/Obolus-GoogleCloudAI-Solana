---
name: contribute
description: Set up an OpenShelf contributor, receive fitting paid questions, submit human answers, and inspect earnings.
---

# Contribute human knowledge

Antigravity CLI lazy-loads MCP tools. Read `~/.gemini/antigravity-cli/mcp/<server>/<tool>.json`, then invoke the built-in `call_mcp_tool` dispatcher directly. A server tool need not appear as its own top-level tool. Do not search the plugin source, define a subagent, or execute files under `runtime/` through a shell as a substitute for MCP.

If Antigravity CLI 1.1.10 returns `unknown_tool` for its advertised `call_mcp_tool`, use the reviewed CLI transport that calls the identical tool implementation: `node ~/.gemini/config/plugins/openshelf/runtime/server.mjs call TOOL --json-b64 BASE64`. Encode the UTF-8 JSON object as one canonical base64 token; never put user text directly in a shell command and never read `.env`. This command still requires Antigravity command approval.

1. Call `account_status`, then `get_profile` on the `openshelf` MCP server. If no local session exists, tell the user to run the local hidden-password login command printed in the plugin README; never ask them to paste a password into the model conversation.
2. If onboarding is incomplete, collect the anonymous handle and eligibility bands directly from the user. Call `openshelf/update_profile`; do not infer age, household, region, or expertise.
3. To use the Pay.sh wallet for payouts, call `prepare_payout_wallet_link` on `openshelf`. Explain that this is a free SIWX ownership signature, not a USDC payment. After agreement, call `curl` on `pay` with the returned URL and `GET`; if the Antigravity dispatcher bug blocks Pay MCP, use `pay curl PAYMENT_URL` with the unchanged OpenShelf URL. Then confirm `walletVerified` through `get_profile` on `openshelf`.
4. Use `openshelf/list_opportunities` with `eligibleOnly: true`. Explain reward, target, eligibility, and remaining slots.
5. Call `openshelf/manage_reservation` with `reserve` before composition. Ask the warm-ups if useful, but the human must supply every factual answer and the final text. Do not generate lived experience.
6. Read the final text back to the contributor. Only after their approval call `openshelf/submit_human_answer`. Release the reservation if they abandon it.
7. Use `openshelf/notifications`, `openshelf/manage_memory`, and `openshelf/earnings_and_claims` for follow-up, corrections, locks, disputes, and payout tracking.
8. Shelf starters are free AI interview prompts. They become human inventory only when the contributor personally answers and approves the text through `openshelf/answer_shelf_starter`.
