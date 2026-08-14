# Obolus Cloudflare Pages

> The end-to-end production release order is maintained in
> [`docs/DEPLOYMENT.ko.md`](../../docs/DEPLOYMENT.ko.md). This document defines
> the Pages-specific build and proxy contract.

The production frontend is a Cloudflare Pages project named `obolus`.

## Build contract

- Build command: `npm run build:pages`
- Output directory: `dist`
- Runtime configuration: `wrangler.jsonc`
- Production branch: `main`
- Functions routes: `/api/*` and `/x402/*` only

`build:pages` leaves `VITE_API_BASE` empty and sets
`VITE_X402_GATEWAY_BASE=/x402`. The Pages Functions therefore keep login,
session recovery, and browser payment requests on the frontend origin while
streaming them to the Cloud Run API and gateway. The functions never buffer an
upstream body and mark every dynamic response `private, no-store`.

The build copies `_routes.json` and `_headers` from `public/`.
`_routes.json` prevents static assets from consuming Functions invocations;
Pages' native SPA fallback serves deep links; fingerprinted assets are immutable
while the HTML entrypoint is never cached. Do not add `/* /index.html 200` to
`_redirects`: current Pages rejects it as an infinite redirect loop.

## Provision and deploy

Before the first deploy, confirm the Cloudflare account and whether an existing
`obolus` Pages project is already attached to another repository. Do not create
a second project with the same public purpose. Pages Functions cannot be
uploaded with dashboard drag-and-drop; use Git integration or Wrangler.

Normal production delivery is the Cloudflare-only final job of the CI-gated
reusable workflow [`deploy.yml`](../../.github/workflows/deploy.yml). A job with
no provider credential builds and verifies the bundle; the production job
downloads that exact artifact. It first proves that a `production` environment
secret can access the exact `obolus` project and account. The environment must require a reviewer and
permit only `main`. The secret must be a custom Cloudflare API token restricted
to the target account with only `Cloudflare Pages: Edit`; do not reuse a local
Wrangler OAuth credential or downgrade it to a repository secret. This job has
no `id-token: write`, and the stateful GCP workflow cannot read the Cloudflare
secret. Backend changes hold Pages until a matching Cloud Run success marker is
present.

```bash
npm run typecheck:pages
npm run build:pages
npx wrangler whoami
npx wrangler pages project list
npm run pages:deploy -- --branch=main --commit-hash="$(git rev-parse HEAD)"
```

The committed `API_ORIGIN` and `GATEWAY_ORIGIN` values are non-secret stable
Cloud Run service URLs. Re-run `wrangler types` after changing them. Store any
future credential in the Pages secret store, never in `wrangler.jsonc`, source,
or a `VITE_*` build variable.

Configure Pages Functions to fail closed when its invocation quota is
exhausted because these routes carry authentication and payments. Configure
the API's `OPENSHELF_FRONTEND_ORIGIN` to the exact production Pages or custom
domain origin and verify:

1. login sets a cookie for the frontend host and `/api/v1/auth/me` receives it;
2. `/x402/api/v1/payment-bundles` reaches the gateway without exposing a direct
   cross-site credential flow;
3. deep links return the SPA and assets retain immutable caching;
4. Pages Functions logs and traces contain no cookie, query capability, payment
   credential, or response body;
5. a strict Content Security Policy is added only after the production Solana
   RPC, wallet, API, and gateway origins are finalized and exercised.

Do not remove Cloud Run `obolus-web` until the custom-domain/DNS change and an
authenticated production smoke test have both succeeded.
