#!/usr/bin/env bash
# Standalone installer regression: secure bootstrap, private files, non-root
# ownership settings, no-IP fallback, health gating, and failure reporting.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
bin="$work/bin"
mkdir -p "$bin"

cat >"$bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_CALLS"
case "$*" in
  "compose ps -q shed") printf 'shed-test-container\n' ;;
  inspect*) printf '%s\n' "${MOCK_HEALTH:-healthy}" ;;
esac
exit 0
SH

cat >"$bin/ip" <<'SH'
#!/usr/bin/env bash
# A valid early-boot state: networking has no RFC1918 address yet.
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

cat >"$bin/chown" <<'SH'
#!/usr/bin/env bash
# Ownership needs root on macOS even when it is unchanged. The environment
# values and Docker user boundary are asserted separately in this unit test;
# the real recursive chown is exercised by the Linux install smoke test.
exit 0
SH

cat >"$bin/sleep" <<'SH'
#!/usr/bin/env bash
exit 0
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
  *compose.yaml.new.*) cp "$TEST_ROOT/compose.yaml" "$destination" ;;
  *scripts/backup.sh.new.*) cp "$TEST_ROOT/scripts/backup.sh" "$destination" ;;
  *.env.new.*) cp "$TEST_ROOT/.env.example" "$destination" ;;
  *) exit 3 ;;
esac
SH

chmod +x "$bin"/*

mode_of() {
  if stat -f '%Lp' "$1" >/dev/null 2>&1; then
    stat -f '%Lp' "$1"
  else
    stat -c '%a' "$1"
  fi
}

calls="$work/docker-calls"
: >"$calls"
output="$(
  PATH="$bin:/usr/bin:/bin" \
  TEST_ROOT="$root" \
  DOCKER_CALLS="$calls" \
  SHED_INSTALL_DIR="$work/shed" \
  HOME="$work/home" \
  bash "$root/get-shed.sh"
)"

grep -q 'http://shed-test.local:3000' <<<"$output" || {
  echo "Standalone install did not fall back to mDNS with the configured port." >&2
  printf '%s\n' "$output" >&2
  exit 1
}
grep -q '^SHED_AUTH_REQUIRED=true$' "$work/shed/.env" || {
  echo "Standalone install did not enable authentication." >&2
  exit 1
}
expected_uid="$(id -u)"
expected_gid="$(id -g)"
if [ "$expected_uid" = 0 ]; then expected_uid=10001; expected_gid=10001; fi
grep -q "^SHED_UID=$expected_uid$" "$work/shed/.env"
grep -q "^SHED_GID=$expected_gid$" "$work/shed/.env"
! grep -q 'replace-with-' "$work/shed/.env" || {
  echo "Standalone install left an example authentication token in place." >&2
  exit 1
}
[ "$(mode_of "$work/shed")" = 700 ]
[ "$(mode_of "$work/shed/data")" = 700 ]
[ "$(mode_of "$work/shed/backups")" = 700 ]
[ "$(mode_of "$work/shed/.env")" = 600 ]
[ "$(mode_of "$work/shed/compose.yaml")" = 600 ]
[ "$(mode_of "$work/shed/scripts/backup.sh")" = 700 ]
grep -q '^compose stop shed$' "$calls"
grep -q '^compose up -d$' "$calls"
grep -q '^inspect --format ' "$calls"

# A crash-loop must be reported as failure, stopped, and never described as a
# successful install. `unhealthy` exits the polling loop immediately.
failed_calls="$work/failed-docker-calls"
: >"$failed_calls"
if PATH="$bin:/usr/bin:/bin" \
   TEST_ROOT="$root" \
   DOCKER_CALLS="$failed_calls" \
   MOCK_HEALTH=unhealthy \
   SHED_INSTALL_DIR="$work/unhealthy" \
   HOME="$work/home" \
   bash "$root/get-shed.sh" >"$work/unhealthy.out" 2>"$work/unhealthy.err"; then
  echo "Standalone installer reported success for an unhealthy container." >&2
  exit 1
fi
grep -q 'did not become healthy' "$work/unhealthy.err"
grep -q '^compose stop shed$' "$failed_calls"
! grep -q 'Shed is running' "$work/unhealthy.out"

echo "Standalone installer tests passed."
