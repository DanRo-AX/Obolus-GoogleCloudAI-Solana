#!/usr/bin/env bash
set -euo pipefail
# Give every background service its own process group. npm/npx and cargo spawn
# children that can otherwise outlive the PID returned by `$!` for a moment.
set -m

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

mode="${1:-success}"
case "$mode" in
  success|missing-recipient-ata|crash-after-prepare|crash-after-collection|cross-route-replay) ;;
  *)
    echo "usage: $0 [success|missing-recipient-ata|crash-after-prepare|crash-after-collection|cross-route-replay]" >&2
    exit 2
    ;;
esac

for command_name in cargo curl node npm sqlite3; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name is required for the Pay.sh sandbox E2E test" >&2
    exit 1
  fi
done

backend_port="${OPENSHELF_E2E_BACKEND_PORT:-8787}"
pay_port="${OPENSHELF_E2E_PAY_PORT:-3402}"
gateway_port="${OPENSHELF_E2E_GATEWAY_PORT:-1402}"
replay_proxy_port="${OPENSHELF_E2E_REPLAY_PROXY_PORT:-1403}"

for port in "$backend_port" "$pay_port" "$gateway_port" "$replay_proxy_port"; do
  if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
    echo "invalid Pay.sh sandbox E2E port: $port" >&2
    exit 2
  fi
done
if [[ "$backend_port" == "$pay_port" || "$backend_port" == "$gateway_port" \
  || "$backend_port" == "$replay_proxy_port" || "$pay_port" == "$gateway_port" \
  || "$pay_port" == "$replay_proxy_port" || "$gateway_port" == "$replay_proxy_port" ]]; then
  echo "Pay.sh sandbox E2E ports must be distinct" >&2
  exit 2
fi

assert_port_available() {
  local label="$1"
  local port="$2"
  if ! OPENSHELF_E2E_PORT_TO_CHECK="$port" node -e '
    const net = require("node:net");
    const port = Number(process.env.OPENSHELF_E2E_PORT_TO_CHECK);
    const server = net.createServer();
    server.unref();
    server.once("error", () => process.exit(1));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.close((error) => process.exit(error ? 1 : 0));
    });
  '; then
    echo "$label port 127.0.0.1:$port is already in use; refusing to test against another stack" >&2
    exit 1
  fi
}

assert_port_available "backend" "$backend_port"
assert_port_available "Pay.sh" "$pay_port"
assert_port_available "gateway" "$gateway_port"
if [[ "$mode" == "cross-route-replay" ]]; then
  assert_port_available "replay proxy" "$replay_proxy_port"
fi

backend_origin="http://127.0.0.1:$backend_port"
pay_origin="http://127.0.0.1:$pay_port"
gateway_origin="http://127.0.0.1:$gateway_port"

temp_parent="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
smoke_dir="$(mktemp -d "${temp_parent%/}/openshelf-pay-smoke.XXXXXX")"
case "$smoke_dir" in
  "${temp_parent%/}"/openshelf-pay-smoke.*) ;;
  *)
    echo "refusing unexpected smoke directory: $smoke_dir" >&2
    exit 1
    ;;
esac

internal_token="openshelf-sandbox-internal-token-0123456789"
front_token="openshelf-sandbox-front-token-0123456789"
sandbox_usdc="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
backend_log="$smoke_dir/backend.log"
pay_log="$smoke_dir/pay.log"
gateway_log="$smoke_dir/gateway.log"
client_log="$smoke_dir/client.log"
backend_pid=""
pay_pid=""
gateway_pid=""
state_file=""

stop_process_group() {
  local process_id="$1"
  local attempt
  if [[ ! "$process_id" =~ ^[0-9]+$ ]]; then
    return
  fi
  kill -TERM -- "-$process_id" >/dev/null 2>&1 || true
  for attempt in $(seq 1 50); do
    if ! kill -0 -- "-$process_id" >/dev/null 2>&1; then
      wait "$process_id" 2>/dev/null || true
      return
    fi
    sleep 0.1
  done
  echo "forcing stopped Pay.sh sandbox E2E process group $process_id after bounded shutdown" >&2
  kill -KILL -- "-$process_id" >/dev/null 2>&1 || true
  wait "$process_id" 2>/dev/null || true
}

cleanup() {
  local process_id
  for process_id in "${gateway_pid:-}" "${backend_pid:-}" "${pay_pid:-}"; do
    stop_process_group "$process_id"
  done
  if [[ -n "$state_file" ]]; then
    if [[ "$state_file" != "$smoke_dir/client-state.json" ]]; then
      echo "refusing to remove unexpected smoke state file: $state_file" >&2
    elif [[ -L "$state_file" ]]; then
      echo "refusing to remove symlinked smoke state file: $state_file" >&2
    elif [[ -f "$state_file" ]]; then
      rm -- "$state_file"
    fi
  fi
}
trap cleanup EXIT INT TERM

dump_logs() {
  echo "Pay.sh sandbox E2E logs: $smoke_dir" >&2
  local log_file
  for log_file in "$backend_log" "$pay_log" "$gateway_log" "$client_log"; do
    if [[ -f "$log_file" ]]; then
      tail -80 "$log_file" >&2 || true
    fi
  done
}

wait_for_url() {
  local url="$1"
  local process_id="$2"
  local attempt
  for attempt in $(seq 1 160); do
    if ! kill -0 "$process_id" >/dev/null 2>&1; then
      return 1
    fi
    if curl --fail --silent --show-error "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_exit() {
  local process_id="$1"
  local attempt
  for attempt in $(seq 1 80); do
    if ! kill -0 "$process_id" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

assert_sql_count() {
  local expected="$1"
  local query="$2"
  local description="$3"
  local actual
  if ! actual="$(sqlite3 "$smoke_dir/openshelf.db" "$query")"; then
    echo "could not inspect $description" >&2
    return 1
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "$description: expected $expected, got $actual" >&2
    return 1
  fi
}

# Start the real, pinned Pay implementation first so the success fixture can
# use the sandbox operator's already-initialized USDC account as its recipient.
# The public sandbox RPC occasionally drops its own wallet-funding request. A
# bounded full-process retry is allowed only for that transport/funding class;
# schema, config, and application failures remain immediate failures.
pay_start_attempt=1
operator_wallet=""
while (( pay_start_attempt <= 3 )); do
  OPENSHELF_BACKEND_URL="$backend_origin" \
  OPENSHELF_PAY_SANDBOX_PORT="$pay_port" \
  OPENSHELF_INTERNAL_TOKEN="$internal_token" \
  npm run --silent pay:gateway:sandbox >"$pay_log" 2>&1 &
  pay_pid=$!
  operator_wallet=""
  for _ in $(seq 1 160); do
    operator_wallet="$(
      sed -E -n 's/.*funding operator signer: ([1-9A-HJ-NP-Za-km-z]{32,44}).*/\1/p' "$pay_log" \
        | tail -n 1
    )"
    if [[ "$operator_wallet" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] \
      && wait_for_url "$pay_origin/__402/health" "$pay_pid"; then
      break 2
    fi
    if ! kill -0 "$pay_pid" >/dev/null 2>&1; then
      break
    fi
    sleep 0.25
  done
  if kill -0 "$pay_pid" >/dev/null 2>&1; then
    stop_process_group "$pay_pid"
  fi
  pay_pid=""
  if (( pay_start_attempt == 3 )) \
    || ! grep -Eq 'Sandbox funding failed|RPC call .* failed|error sending request' "$pay_log"; then
    echo "Pay sandbox failed to start (attempt $pay_start_attempt)" >&2
    dump_logs
    exit 1
  fi
  echo "Pay sandbox RPC funding was transiently unavailable; retrying process startup ($pay_start_attempt/3)" >&2
  pay_start_attempt=$((pay_start_attempt + 1))
  sleep 1
done

if [[ "$mode" == "missing-recipient-ata" ]]; then
  receiver="$(
    cd payment-gateway
    node -e "const {Keypair}=require('@solana/web3.js'); process.stdout.write(Keypair.generate().publicKey.toBase58())"
  )"
else
  receiver="$operator_wallet"
fi
if [[ ! "$receiver" =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]]; then
  echo "could not create a sandbox recipient" >&2
  exit 1
fi

OPENSHELF_DATABASE="$smoke_dir/openshelf.db" \
OPENSHELF_SEED_DEMO=true \
OPENSHELF_DEFAULT_RECEIVER="$receiver" \
OPENSHELF_BUNDLE_RECEIVER="$receiver" \
OPENSHELF_INTERNAL_TOKEN="$internal_token" \
OPENSHELF_X402_NETWORK=localnet \
OPENSHELF_X402_ASSET="$sandbox_usdc" \
OPENSHELF_BIND="127.0.0.1:$backend_port" \
cargo run --quiet --manifest-path backend/Cargo.toml >"$backend_log" 2>&1 &
backend_pid=$!
if ! wait_for_url "$backend_origin/healthz" "$backend_pid"; then
  dump_logs
  exit 1
fi

# The co-hosted x402 server remains on Devnet because its facilitator does not
# support localnet. Direct Pay.sh validation is bound to the quote's localnet
# mint and does not reuse the x402 server's network setting.
start_gateway() {
  local failpoint="${1:-}"
  PORT="$gateway_port" \
  RUST_API_URL="$backend_origin" \
  PAY_SH_PRIVATE_URL="$pay_origin" \
  PAY_SH_RPC_URL=https://402.surfnet.dev:8899 \
  OPENSHELF_REQUIRE_RESEARCH_ORCHESTRATOR=false \
  OPENSHELF_INTERNAL_TOKEN="$internal_token" \
  OPENSHELF_PAY_FRONT_TOKEN="$front_token" \
  OPENSHELF_TEST_FAILPOINT="$failpoint" \
  npm --prefix payment-gateway run --silent start >>"$gateway_log" 2>&1 &
  gateway_pid=$!
  if ! wait_for_url "$gateway_origin/readyz" "$gateway_pid"; then
    dump_logs
    exit 1
  fi
}

failpoint=""
if [[ "$mode" == "crash-after-prepare" ]]; then
  failpoint="direct-after-prepare"
elif [[ "$mode" == "crash-after-collection" ]]; then
  failpoint="direct-after-receipt"
fi
start_gateway "$failpoint"

if [[ "$mode" == "success" ]]; then
  if ! OPENSHELF_PAY_URL="$gateway_origin" npm run --silent pay:smoke \
    >"$client_log" 2>&1; then
    dump_logs
    exit 1
  fi
  if ! grep -q '"status": "paid-and-recovered"' "$client_log" \
    || ! assert_sql_count 1 'SELECT COUNT(*) FROM settlements;' "settlement count" \
    || ! assert_sql_count 1 \
      "SELECT COUNT(*) FROM direct_pay_sh_attempts WHERE status = 'settled';" \
      "settled direct-attempt count" \
    || ! assert_sql_count 1 'SELECT COUNT(*) FROM memory_access_events;' \
      "content-access count"; then
    dump_logs
    exit 1
  fi
  echo "Pay.sh sandbox payment, delivery, and free recovery converged on one settlement."
elif [[ "$mode" == "missing-recipient-ata" ]]; then
  if OPENSHELF_PAY_URL="$gateway_origin" npm run --silent pay:smoke \
    >"$client_log" 2>&1; then
    echo "Pay.sh unexpectedly charged an owner without an initialized USDC account" >&2
    dump_logs
    exit 1
  fi
  if ! grep -q 'recipient_asset_account_missing' "$client_log" \
    || ! assert_sql_count 0 'SELECT COUNT(*) FROM settlements;' "settlement count" \
    || ! assert_sql_count 0 'SELECT COUNT(*) FROM memory_access_events;' \
      "content-access count" \
    || ! assert_sql_count 0 'SELECT COUNT(*) FROM direct_pay_sh_attempts;' \
      "direct-attempt count" \
    || ! assert_sql_count 1 \
      "SELECT COUNT(*) FROM payment_quotes WHERE status = 'quoted' AND payment_rail = 'pay_sh';" \
      "Pay.sh-reserved quote count"; then
    dump_logs
    exit 1
  fi
  echo "An uninitialized recipient ATA failed before durable prepare, collection, or content access."
elif [[ "$mode" == "cross-route-replay" ]]; then
  if ! OPENSHELF_PAY_URL="$gateway_origin" \
    PAY_REPLAY_PROXY_PORT="$replay_proxy_port" \
    payment-gateway/node_modules/.bin/tsx scripts/pay-sh-cross-route-replay.ts \
    >"$client_log" 2>&1 \
    || ! grep -q '"status": "cross-route-credential-blocked"' "$client_log" \
    || ! assert_sql_count 0 'SELECT COUNT(*) FROM settlements;' "settlement count" \
    || ! assert_sql_count 0 'SELECT COUNT(*) FROM memory_access_events;' \
      "content-access count"; then
    dump_logs
    exit 1
  fi
  echo "A credential issued for one document could not be replayed onto an equal-price document."
else
  state_file="$smoke_dir/client-state.json"
  if PAY_SMOKE_STATE_FILE="$state_file" \
    OPENSHELF_PAY_URL="$gateway_origin" npm run --silent pay:smoke \
    >"$client_log" 2>&1; then
    echo "Pay.sh crash failpoint did not interrupt the paid request" >&2
    dump_logs
    exit 1
  fi
  if ! wait_for_exit "$gateway_pid"; then
    echo "payment gateway did not die at $failpoint" >&2
    dump_logs
    exit 1
  fi
  wait "$gateway_pid" 2>/dev/null || true
  gateway_pid=""
  if [[ ! -s "$state_file" ]]; then
    echo "client state was not durable before the crash drill" >&2
    dump_logs
    exit 1
  fi

  if [[ "$mode" == "crash-after-prepare" ]]; then
    if ! assert_sql_count 1 \
      "SELECT COUNT(*) FROM direct_pay_sh_attempts WHERE status = 'prepared';" \
      "prepared attempt after process death" \
      || ! assert_sql_count 0 'SELECT COUNT(*) FROM settlements;' "settlement count" \
      || ! assert_sql_count 0 'SELECT COUNT(*) FROM memory_access_events;' \
      "content-access count"; then
      dump_logs
      exit 1
    fi
  else
    if ! assert_sql_count 1 \
      "SELECT COUNT(*) FROM direct_pay_sh_attempts WHERE status = 'prepared';" \
      "prepared attempt after lost receipt" \
      || ! assert_sql_count 0 'SELECT COUNT(*) FROM settlements;' "settlement count" \
      || ! assert_sql_count 0 'SELECT COUNT(*) FROM memory_access_events;' \
      "content-access count"; then
      dump_logs
      exit 1
    fi
  fi

  start_gateway ""
  if [[ "$mode" == "crash-after-prepare" ]]; then
    if ! PAY_SMOKE_RETRY_ONLY=true PAY_SMOKE_STATE_FILE="$state_file" \
      OPENSHELF_PAY_URL="$gateway_origin" npm run --silent pay:smoke \
      >>"$client_log" 2>&1 \
      || ! grep -q '"status": "retry-blocked"' "$client_log" \
      || ! assert_sql_count 1 'SELECT COUNT(*) FROM direct_pay_sh_attempts;' \
      "durable attempt count after retry" \
      || ! assert_sql_count 0 'SELECT COUNT(*) FROM settlements;' "settlement count after retry"; then
      dump_logs
      exit 1
    fi
    echo "A process death after durable prepare blocked a new signed charge after restart."
  else
    if ! PAY_SMOKE_RETRY_ONLY=true PAY_SMOKE_STATE_FILE="$state_file" \
      OPENSHELF_PAY_URL="$gateway_origin" npm run --silent pay:smoke \
      >>"$client_log" 2>&1 \
      || ! grep -q '"status": "retry-blocked"' "$client_log" \
      || ! assert_sql_count 1 \
      "SELECT COUNT(*) FROM direct_pay_sh_attempts WHERE status = 'prepared';" \
      "prepared attempt retained for finalized-chain recovery" \
      || ! assert_sql_count 0 'SELECT COUNT(*) FROM settlements;' \
      "settlement count before receipt recovery" \
      || ! assert_sql_count 0 'SELECT COUNT(*) FROM memory_access_events;' \
      "content-access count before receipt recovery"; then
      dump_logs
      exit 1
    fi
    if ! RUST_API_URL="$backend_origin" \
      OPENSHELF_INTERNAL_TOKEN="$internal_token" \
      PAY_SH_RPC_URL=https://402.surfnet.dev:8899 \
      npm --prefix agent-orchestrator exec -- tsx scripts/pay-sh-reconcile-once.ts \
      >>"$client_log" 2>&1 \
      || ! PAY_SMOKE_RECOVER_ONLY=true PAY_SMOKE_STATE_FILE="$state_file" \
      OPENSHELF_PAY_URL="$gateway_origin" npm run --silent pay:smoke \
      >>"$client_log" 2>&1 \
      || ! grep -q '"status": "recovered-after-crash"' "$client_log" \
      || ! assert_sql_count 1 'SELECT COUNT(*) FROM settlements;' \
      "settlement count after exact recovery" \
      || ! assert_sql_count 1 \
      "SELECT COUNT(*) FROM direct_pay_sh_attempts WHERE status = 'settled';" \
      "settled attempt count after exact recovery" \
      || ! assert_sql_count 1 'SELECT COUNT(*) FROM memory_access_events;' \
      "content-access count after exact recovery" \
      || ! assert_sql_count 1 \
      "SELECT COUNT(*) FROM chain_transaction_registry WHERE settlement_kind = 'pay_sh_direct';" \
      "global chain-signature claim after exact recovery"; then
      dump_logs
      exit 1
    fi
    echo "A process death after Pay collection recovered the exact finalized transfer without a second charge."
  fi
fi

echo "Sandbox logs: $smoke_dir"
