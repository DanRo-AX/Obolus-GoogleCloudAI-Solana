#!/usr/bin/env bash
set -euo pipefail

if [[ ! "${OPENSHELF_PAY_FRONT_TOKEN:-}" =~ ^[A-Za-z0-9_-]{32,256}$ ]]; then
  echo "OPENSHELF_PAY_FRONT_TOKEN must be a 32-256 character URL-safe secret" >&2
  exit 1
fi

export PORT="${PORT:-8080}"
envsubst '${PORT} ${OPENSHELF_PAY_FRONT_TOKEN}' \
  < /app/nginx.conf.template > /tmp/openshelf-nginx.conf

pay gate api /app/paywall.yml \
  --bind 127.0.0.1:8081 \
  --openapi /app/openapi.json \
  --no-register &
pay_pid=$!

nginx -c /tmp/openshelf-nginx.conf -g 'daemon off;' &
nginx_pid=$!

shutdown() {
  kill "${pay_pid}" "${nginx_pid}" 2>/dev/null || true
}
trap shutdown EXIT INT TERM

wait -n "${pay_pid}" "${nginx_pid}"
