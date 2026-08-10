---
name: openshelf-setup
description: Install, authenticate, and diagnose the OpenShelf plus Pay.sh Antigravity integration.
---

# Set up OpenShelf in Antigravity

Prerequisites are Node.js 20+, Antigravity CLI, and Pay.sh. Run `pay setup` once so Pay can create or import a locally protected wallet.

For a source checkout, run:

```bash
node integrations/antigravity/openshelf/runtime/server.mjs doctor
```

The managed launch is wallet-only. Buyer tools store only short-lived query
capabilities in a mode-0600 file under `~/.config/openshelf/`; Pay keeps its own
private key. Contributor-account tools are deferred until the runtime can
complete the browser-equivalent wallet challenge/SIWX proof locally. Do not use
the legacy email `auth register/login` commands against managed deployments.

Use `/mcp` in Antigravity to confirm both `openshelf` and `pay` servers are connected. Keep OpenShelf on Devnet and do not use `pay --sandbox` for its public Devnet payment URLs.

Antigravity CLI lazy-loads MCP schemas. Read `~/.gemini/antigravity-cli/mcp/<server>/<tool>.json` and invoke its built-in `call_mcp_tool` dispatcher directly; a server tool is not expected to appear as a separate top-level tool. Never search the plugin source, delegate solely to discover the tool, or shell-execute `runtime/*.mjs` as a replacement for an MCP call.

Antigravity CLI 1.1.10 may advertise `call_mcp_tool` and then reject it as `unknown_tool`. The plugin therefore has a reviewed fallback that invokes the same tool boundary: `node ~/.gemini/config/plugins/openshelf/runtime/server.mjs call TOOL --json-b64 BASE64`. Use only canonical base64 of the UTF-8 JSON object, never interpolate user text into a shell command, never read `.env`, and let Antigravity request command approval. A future CLI that fixes the dispatcher should use MCP directly.

Multiple identities stay independent: Antigravity's selected Google login identifies the AI session, the local OpenShelf session identifies the marketplace account, and the named Pay account identifies the signing wallet. Use `pay account list` and `pay account default NAME`, or set `OPENSHELF_PAY_ACCOUNT=NAME`, to select a Pay identity deliberately. Never infer an OpenShelf account or payout owner from the Google email.

For side-by-side buyer testing, launch separate shells with matching explicit
selectors, for example `OPENSHELF_AGENT_PROFILE=buyer OPENSHELF_PAY_ACCOUNT=buyer agy`
and `OPENSHELF_AGENT_PROFILE=buyer-two OPENSHELF_PAY_ACCOUNT=buyer-two agy`.
Profile names accept only letters, numbers, underscores, and hyphens and never
change the Google login.
