#!/usr/bin/env bash
# Standalone installer regression: early boot can have no LAN address, and the
# address printed after install must use the port Compose reads from .env.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
bin="$work/bin"
mkdir -p "$bin"

cat >"$bin/docker" <<'SH'
#!/usr/bin/env bash
exit 0
SH

cat >"$bin/ip" <<'SH'
#!/usr/bin/env bash
# A valid, temporary early-boot state: networking has no RFC1918 address yet.
exit 0
SH

cat >"$bin/hostname" <<'SH'
#!/usr/bin/env bash
printf 'shed-test\n'
SH

cat >"$bin/openssl" <<'SH'
#!/usr/bin/env bash
printf '0123456789abcdef0123456789abcdef0123456789abcdef\n'
SH

cat >"$bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
destination=""
while (($#)); do
  if [[ "$1" == -o ]]; then
    shift
    destination="$1"
  fi
  shift
done
[[ -n "$destination" ]] || exit 2
mkdir -p "$(dirname "$destination")"
case "$destination" in
  */compose.yaml)
    printf 'services:\n  shed:\n    image: example.invalid/shed:test\n' >"$destination"
    ;;
  */backup.sh.new)
    printf '#!/usr/bin/env bash\nexit 0\n' >"$destination"
    ;;
  */.env)
    cat >"$destination" <<'ENV'
SHED_AUTH_REQUIRED=false
SHED_BOOTSTRAP_TOKEN=replace-with-a-different-long-random-secret
SHED_DISPLAY_TOKEN=replace-with-a-separate-long-random-secret
SHED_PORT=3333
SHED_DATA_PATH=./data
ENV
    ;;
  *) exit 3 ;;
esac
SH

chmod +x "$bin"/*
output="$(
  PATH="$bin:/usr/bin:/bin" \
  SHED_INSTALL_DIR="$work/shed" \
  HOME="$work/home" \
  bash "$root/get-shed.sh"
)"

grep -q 'http://shed-test.local:3333' <<<"$output" || {
  echo "Standalone install did not fall back to mDNS with the configured port." >&2
  printf '%s\n' "$output" >&2
  exit 1
}
grep -q '^SHED_AUTH_REQUIRED=true$' "$work/shed/.env" || {
  echo "Standalone install did not enable authentication." >&2
  exit 1
}

echo "Standalone installer tests passed."
