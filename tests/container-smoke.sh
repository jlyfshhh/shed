#!/usr/bin/env bash
# CI runtime proof for the same boundary used by Compose. This exercises amd64
# Linux; the release checklist still requires one arm64 Raspberry Pi run.
set -euo pipefail

image="${SHED_TEST_IMAGE:-shed:test}"
work="$(mktemp -d)"
data="$work/data"
rejected_data="$work/rejected-data"
name="shed-boundary-$RANDOM-$$"
rejected_bootstrap="shed-example-bootstrap-$RANDOM-$$"
rejected_display="shed-example-display-$RANDOM-$$"
mkdir -p "$data" "$rejected_data"

cleanup() {
  docker rm -f "$name" "$rejected_bootstrap" "$rejected_display" >/dev/null 2>&1 || true
  if ! rm -rf "$work" 2>/dev/null; then
    sudo rm -rf "$work"
  fi
}
trap cleanup EXIT

# The image's dedicated account is 10001. get-shed.sh performs the equivalent
# ownership repair for the host account selected in .env.
# chmod first: after the chown this directory belongs to 10001, and the CI
# runner is not that user, so chmod would fail with "Operation not permitted".
chmod 0700 "$data" "$rejected_data"
sudo chown -R 10001:10001 "$data" "$rejected_data"

# Copying .env.example and forgetting to replace a published credential must
# fail closed even outside the installer. The application layer independently
# treats the same values as unconfigured.
if docker run --name "$rejected_bootstrap" \
  --read-only \
  --user 10001:10001 \
  --mount "type=bind,src=$rejected_data,dst=/data" \
  -e SHED_BOOTSTRAP_TOKEN=replace-with-a-different-long-random-secret \
  -e SHED_DISPLAY_TOKEN=private-display-token \
  "$image" >/dev/null 2>&1; then
  echo "The image started with the published bootstrap token." >&2
  exit 1
fi
docker logs "$rejected_bootstrap" 2>&1 | grep -q 'published example bootstrap token'

if docker run --name "$rejected_display" \
  --read-only \
  --user 10001:10001 \
  --mount "type=bind,src=$rejected_data,dst=/data" \
  -e SHED_BOOTSTRAP_TOKEN=private-bootstrap-token \
  -e SHED_DISPLAY_TOKEN=replace-with-a-separate-long-random-secret \
  "$image" >/dev/null 2>&1; then
  echo "The image started with the published display token." >&2
  exit 1
fi
docker logs "$rejected_display" 2>&1 | grep -q 'published example display token'

docker run -d \
  --name "$name" \
  --init \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user 10001:10001 \
  --pids-limit 256 \
  --memory 1g \
  --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777 \
  --tmpfs /app/dist/server/.wrangler:rw,nosuid,nodev,noexec,size=128m,mode=0700,uid=10001,gid=10001 \
  --mount "type=bind,src=$data,dst=/data" \
  -e SHED_AUTH_REQUIRED=true \
  -e SHED_BOOTSTRAP_TOKEN=ci-only-bootstrap-token-not-a-secret \
  -e SHED_DISPLAY_TOKEN=ci-only-display-token-not-a-secret \
  "$image" >/dev/null

status=starting
for _ in $(seq 1 45); do
  status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name")"
  case "$status" in
    healthy) break ;;
    unhealthy|exited|dead) break ;;
  esac
  sleep 2
done
if [ "$status" != healthy ]; then
  echo "Hardened Shed container did not become healthy ($status)." >&2
  docker logs "$name" >&2 || true
  exit 1
fi

docker exec "$name" sh -eu -c '
  [ "$(id -u)" != 0 ]
  ! touch /app/root-filesystem-must-stay-read-only 2>/dev/null
  umask 077
  touch /data/privacy-probe
  [ "$(stat -c %a /data/privacy-probe)" = 600 ]
  node -e "fetch(\"http://127.0.0.1:3000/api/health\").then(r => { if (!r.ok) process.exit(1) })"
'

[ "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$name")" = true ]
docker inspect --format '{{json .HostConfig.CapDrop}}' "$name" | grep -q 'ALL'
docker inspect --format '{{json .HostConfig.SecurityOpt}}' "$name" | grep -q 'no-new-privileges'

echo "Hardened container runtime smoke test passed."
