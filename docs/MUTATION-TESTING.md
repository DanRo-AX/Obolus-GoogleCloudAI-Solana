# Mutation testing

Mutation tests complement the normal unit and integration suites by changing
production conditions and operators, then requiring a test to fail. They are
kept away from live credentials and infrastructure; every run uses the same
local test boundaries as CI.

## Payment gateway

The initial Stryker scope covers small, high-impact policies for funding mode,
dependency readiness, reconciliation freshness, RPC independence, and durable
settlement. String-only changes are excluded so the score measures behavioral
contracts rather than copy.

```bash
cd payment-gateway
npm ci
npm run test:mutation
```

The checked-in safety-boundary scope has a 100% baseline and fails on any new
survivor. Expand the file list in reviewed slices rather than lowering the
threshold. The JSON CI report is stored as the `gateway-mutation-report`
artifact.

Stryker runs only the five unit-test files mapped to this scope. Local runs use
one test process and CI uses at most two. Do not point the command runner at the
whole gateway suite: unrelated integration failures can both waste CPU and
falsely mark a mutant as caught.

## Rust backend

Pull requests run `cargo-mutants` only against changed Rust source lines, with
at most two concurrent jobs. The
scheduled and manually dispatched workflow scans the authentication,
environment, rollback-audit, and rollback-sweep boundaries. A scheduled miss
is reported without blocking unrelated development; a survivor introduced by
a pull request fails that pull request.

Run a local file-focused check from `backend` when changing a money or identity
boundary:

```bash
cargo mutants --file src/rollback_audit.rs -- --locked
```

Mutation processes must never receive production credentials. Keep external
payment, Cloud SQL, GCS, KMS, RPC, and email settings absent so generated bugs
cannot escape the test process.
