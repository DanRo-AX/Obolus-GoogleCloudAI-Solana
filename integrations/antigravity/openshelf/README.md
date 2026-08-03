# OpenShelf for Antigravity CLI

This plugin gives Antigravity separate `openshelf` market tools and `pay` wallet tools. OpenShelf prepares exact, Devnet-only payment intents; Pay.sh obtains local user authorization, signs without exposing a private key, and retries the x402 request.

## Install

Prerequisites:

- Node.js 20 or newer
- Antigravity CLI (`agy`)
- Pay.sh (`pay`) 0.26.0 or newer, with a named local account configured before a paid action
- a running or hosted OpenShelf Rust API and x402 gateway

From this repository:

```bash
agy plugin install ./integrations/antigravity/openshelf
node integrations/antigravity/openshelf/runtime/server.mjs doctor
node integrations/antigravity/openshelf/runtime/server.mjs auth login --email YOU@example.com
agy
```

The checked-in `.agents/mcp_config.json` first uses a project-local or global
`pay` executable. If neither exists, its adapter runs the pinned official
`@solana/pay@1.0.26` CLI through `npx`; the first launch therefore needs network
access. `OPENSHELF_PAY_COMMAND` can select an explicit trusted executable.

`pay setup` creates or reuses a locally protected Pay account and may enter an
interactive funding flow. It is not needed merely to discover OpenShelf or run
free search, so do it deliberately before the first payment rather than during
plugin installation. `pay account new NAME` and `pay account list` manage
additional identities. Set `OPENSHELF_PAY_ACCOUNT=NAME` when this plugin should
use a non-default Pay account.

`npm run agent:doctor` reports `ok: true` when free marketplace access is ready
and reports `paidActionsReady` separately. A missing Pay account therefore does
not block search, but it is visible before the first purchase or SIWX link.

For direct terminal use, `npm run agent:tools` lists every service action and
`npm run agent:tools -- TOOL` prints its exact JSON schema. Invoke the same
validated implementation with `npm run agent:call -- TOOL --json '{...}'`.

For two-role testing without two Google accounts, use two named local profiles:

```bash
OPENSHELF_AGENT_PROFILE=buyer OPENSHELF_PAY_ACCOUNT=buyer agy
OPENSHELF_AGENT_PROFILE=contributor OPENSHELF_PAY_ACCOUNT=contributor agy
```

Run `auth login` with the same `OPENSHELF_AGENT_PROFILE` before launching each
shell. Each selector gets a different mode-`0600` OpenShelf session file and a
different named Pay signer, while Antigravity may keep the same Google login.

The repository also ships `.agents/mcp_config.json`, so running `agy` at the repository root can load the same two MCP servers without a global plugin install.

Set hosted endpoints when they differ from local development:

```bash
export OPENSHELF_API_URL=https://api.example.com
export OPENSHELF_GATEWAY_URL=https://pay.example.com
```

The backend must expose the same API origin through `OPENSHELF_AGENT_API_ORIGIN`; that origin is committed into one-time Pay SIWX payout-wallet links.

## Authentication and secrets

Authentication is intentionally a local CLI step so an OpenShelf password never enters the Antigravity model transcript or a tool argument. The runtime extracts the HttpOnly session token returned by Rust and writes only that token plus short-lived query capabilities to `~/.config/openshelf/agent-session.json` with mode `0600`.

Pay.sh keeps its own key in the operating-system credential store and asks for local approval for real signatures. OpenShelf never reads or stores the private key.

Antigravity CLI 1.1.10 probes a newer draft MCP handshake before falling back
to the stable protocol. `runtime/pay-compat.mjs` rejects only that probe and
then forwards the stable stream to the official `pay mcp` process. OpenShelf
tools include the same discovery fallback directly.

Antigravity also lazy-loads MCP tools. The included skills instruct it to read
the generated schema and invoke the built-in `call_mcp_tool` dispatcher
directly. CLI 1.1.10 currently advertises that dispatcher but can reject it as
`unknown_tool`. For that version, `server.mjs call TOOL --json-b64 BASE64`
invokes the identical validated tool implementation under normal Antigravity
command approval. Canonical base64 keeps user text out of shell syntax. This is
an explicit compatibility transport, not a second business-logic path; newer
CLI versions should use MCP directly.

## Identity boundaries

Three identities are intentionally separate:

| Identity | Purpose | Stored by |
| --- | --- | --- |
| Google account | Antigravity login and model quota | Antigravity / OS credential store |
| OpenShelf account | Profile, questions, answers, memory, claims | Rust session; local token cache |
| Pay account | Local Solana signing and selected wallet | Pay.sh / OS credential store |

Changing Google accounts must not silently change an OpenShelf profile or Pay
wallet. A future social-login screen should require an explicit link/unlink
operation and preserve an email/password recovery path. Payout ownership is
separately proven through the one-time SIWX link returned by
`prepare_payout_wallet_link`; matching email addresses are never wallet proof.
See [`../../../docs/ACCOUNT-LINKING.md`](../../../docs/ACCOUNT-LINKING.md).

## Example prompts

```text
/ask-people 성수동에서 평일 점심에 15분 안에 먹는 실제 선택을 20명에게 물어봐. 총 5 USDC를 넘기지 마.
```

```text
/contribute 내가 답할 수 있는 유료 질문만 보여주고 하나를 예약해줘.
```

```text
/contribute Pay 지갑을 정산 지갑으로 연결하고 내 수익과 지급 상태를 확인해줘.
```

All payment actions remain Solana Devnet-only in this implementation.
