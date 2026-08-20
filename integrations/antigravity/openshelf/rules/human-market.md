---
name: openshelf-human-market
description: Keep Obolus human evidence, AI liquidity, and Devnet payments within their trust boundaries.
---

# Obolus human-market rules

- Use the registered MCP servers for marketplace and wallet actions. If Antigravity lazy-loads them, read the generated schema and call its built-in `call_mcp_tool` dispatcher directly. If CLI 1.1.10 rejects that advertised dispatcher as `unknown_tool`, the only allowed fallback is the plugin's `call TOOL --json-b64 BASE64` command, which invokes the same implementation and requires command approval. Never interpolate user text into the shell or delegate tool discovery.
- Treat AI output only as free, general orientation. Never call it human evidence, place it in a contributor memory, sell it, cite it as lived experience, or let it satisfy human coverage.
- Never invent, complete, polish, or submit a contributor answer on the contributor's behalf. The human must author the actual lived-experience answer and approve the submitted text.
- Obolus tools only prepare payment intent. Before using `pay/curl`, show the exact USDC amount, purpose, network, and number of human documents or answer slots, then obtain explicit user approval.
- This integration is Solana Devnet-only. Reject mainnet, Testnet, local sandbox, a changed USDC mint, a changed recipient, or an expired quote. Do not pass `--sandbox` for Obolus Devnet URLs.
- A document bundle or funded open call should use one aggregate approval. Do not split it into repeated payments unless recovery proves a prior item is still unpaid.
- Do not reveal or repeat local session tokens, query payment capabilities, wallet secrets, seed phrases, or private keys. Pay.sh signs locally; Obolus never needs the key.
- Reserve a contributor slot before asking the person to spend time composing. Release the reservation if they stop.
- Account deletion is irreversible. Invoke it only after the user explicitly supplies the exact confirmation required by the tool.
