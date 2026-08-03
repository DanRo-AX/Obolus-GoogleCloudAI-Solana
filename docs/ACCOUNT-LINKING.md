# Account and wallet linking

OpenShelf has three identities that must not be collapsed merely because their
labels or email addresses look alike.

| Identity | What it controls | Current state |
| --- | --- | --- |
| Google account | Antigravity login, model quota, optional future social login | Antigravity-managed; not linked to OpenShelf today |
| OpenShelf user | Questions, contributor profile, private memory, sessions, claims | Email/password and HttpOnly session; agent token cached locally with mode `0600` |
| Pay account | Local Solana signer used for purchases or payout-wallet proof | Named Pay account in the OS credential store |

## Current safe flow

1. The person chooses a Google account when authenticating Antigravity.
2. They log in to OpenShelf locally with the plugin's hidden-password command.
   The password never enters the model transcript.
3. They select a named Pay account explicitly, using its default or
   `OPENSHELF_PAY_ACCOUNT`.
4. A contributor asks OpenShelf for a one-time payout-wallet link. Pay signs the
   canonical SIWX message locally; Rust verifies it and binds that public key to
   the authenticated OpenShelf user.

This supports one person using separate buyer and contributor wallets without
needing separate Google logins. It also prevents switching Google accounts from
silently exposing another OpenShelf profile or spending from another Pay
account.

Buyer and contributor role tests can run side by side under one Google login:

```bash
OPENSHELF_AGENT_PROFILE=buyer OPENSHELF_PAY_ACCOUNT=buyer agy
OPENSHELF_AGENT_PROFILE=contributor OPENSHELF_PAY_ACCOUNT=contributor agy
```

The OpenShelf login command must use the same `OPENSHELF_AGENT_PROFILE` as its
corresponding Antigravity process. This selects separate mode-`0600` session
files; it does not create or link accounts automatically.

## Future Google linking contract

Google social login should be added as an explicit account link, not as an
automatic replacement for the marketplace account:

- store provider, immutable provider subject, OpenShelf user ID, created time,
  and last-used time; do not use email as the key;
- require an authenticated OpenShelf session to attach a second Google identity;
- reject a provider subject already attached to another OpenShelf user;
- show linked identities and allow unlinking only while another recovery method
  remains;
- require recent reauthentication for link, unlink, payout-wallet change, data
  export, and account deletion;
- never auto-link solely because Google and OpenShelf emails match;
- audit every link/unlink and revoke the affected sessions after a sensitive
  identity change.

Multiple Google accounts make Antigravity quota/profile switching possible, but
they do not reduce OpenShelf account setup until this contract and its UI are
implemented. The first product step should be one `external_identities` table,
OAuth authorization-code flow with PKCE/state/nonce, and a Settings screen that
makes all three currently selected identities visible.
