#!/bin/sh
set -eu

umask 077
runtime_dir="/tmp/shed-runtime"
runtime_env="$runtime_dir/shed-worker.env"

mkdir -p \
  "$runtime_dir" \
  "${HOME:-/tmp/shed-home}" \
  "${XDG_CACHE_HOME:-/tmp/shed-home/.cache}" \
  "${XDG_CONFIG_HOME:-/tmp/shed-home/.config}" \
  "${XDG_DATA_HOME:-/tmp/shed-home/.local/share}" \
  "${MINIFLARE_CACHE_DIR:-/tmp/miniflare-cache}"

if ! probe="$(mktemp /data/.shed-write-test.XXXXXX 2>/dev/null)"; then
  echo "Shed cannot write to /data as uid $(id -u). Check SHED_UID/SHED_GID and the host data-directory ownership." >&2
  exit 1
fi
rm -f "$probe"

{
  printf 'SHED_TIME_ZONE=%s\n' "${SHED_TIME_ZONE:-America/New_York}"
  printf 'SHED_AUTH_REQUIRED=%s\n' "${SHED_AUTH_REQUIRED:-true}"
  printf 'SHED_TRUSTED_PROXY_IP_HEADER=%s\n' "${SHED_TRUSTED_PROXY_IP_HEADER:-}"
  printf 'SHED_BOOTSTRAP_TOKEN=%s\n' "${SHED_BOOTSTRAP_TOKEN:-}"
  printf 'SHED_DISPLAY_TOKEN=%s\n' "${SHED_DISPLAY_TOKEN:-}"
} > "$runtime_env"
chmod 0600 "$runtime_env"

exec ./node_modules/.bin/wrangler dev \
  --config dist/server/wrangler.json \
  --local \
  --persist-to /data \
  --ip 0.0.0.0 \
  --port "${PORT:-3000}" \
  --env-file "$runtime_env" \
  --log-level warn \
  --show-interactive-dev-session=false
