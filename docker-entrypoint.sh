#!/bin/sh
set -eu

runtime_env="/tmp/shed-worker.env"
umask 077
{
  printf 'SHED_TIME_ZONE=%s\n' "${SHED_TIME_ZONE:-America/New_York}"
  printf 'SHED_AUTH_REQUIRED=%s\n' "${SHED_AUTH_REQUIRED:-false}"
  printf 'SHED_TRUSTED_PROXY_IP_HEADER=%s\n' "${SHED_TRUSTED_PROXY_IP_HEADER:-}"
  printf 'SHED_BOOTSTRAP_TOKEN=%s\n' "${SHED_BOOTSTRAP_TOKEN:-}"
  printf 'SHED_DISPLAY_TOKEN=%s\n' "${SHED_DISPLAY_TOKEN:-}"
} > "$runtime_env"

exec ./node_modules/.bin/wrangler dev \
  --config dist/server/wrangler.json \
  --local \
  --persist-to /data \
  --ip 0.0.0.0 \
  --port "${PORT:-3000}" \
  --env-file "$runtime_env" \
  --log-level warn \
  --show-interactive-dev-session=false
