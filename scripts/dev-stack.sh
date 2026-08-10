#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

receiver="${OPENSHELF_DEFAULT_RECEIVER:-}"
if [[ -z "$receiver" || "$receiver" == "YOUR_SOLANA_DEVNET_WALLET_ADDRESS" ]]; then
  echo "Copy .env.example to .env and set OPENSHELF_DEFAULT_RECEIVER first." >&2
  exit 1
fi

export OPENSHELF_INTERNAL_TOKEN="${OPENSHELF_INTERNAL_TOKEN:-openshelf-local-internal}"
export OPENSHELF_BIND="${OPENSHELF_BIND:-127.0.0.1:8787}"
export OPENSHELF_DATABASE="${OPENSHELF_DATABASE:-backend/openshelf.db}"
export RUST_API_URL="${RUST_API_URL:-http://127.0.0.1:8787}"
export PORT="${PORT:-1402}"

child_pids=()
cleanup() {
  for child_pid in "${child_pids[@]:-}"; do
    kill "$child_pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cargo run --manifest-path backend/Cargo.toml &
child_pids+=("$!")
# Keep the payment boundary in sync with frontend HMR during local work. A
# stale non-watching gateway can otherwise expose new UI while still serving
# old CORS and route contracts, which browsers report only as `Failed to fetch`.
npm --prefix payment-gateway run dev &
child_pids+=("$!")
npm run dev &
child_pids+=("$!")

wait
