#!/usr/bin/env bash
# CI runtime proof for the same boundary used by Compose. This exercises amd64
# Linux; the release checklist still requires one arm64 Raspberry Pi run.
set -euo pipefail

image="${SHED_TEST_IMAGE:-shed:test}"
work="$(mktemp -d)"
data="$work/data"
name="shed-boundary-$RANDOM-$$"
mkdir -p "$data"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if ! rm -rf "$work" 2>/dev/null; then
    sudo rm -rf "$work"
  fi
}
trap cleanup EXIT

# The image's dedicated account is 10001. get-shed.sh performs the equivalent
# ownership repair for the host account selected in .env.
sudo chown -R 10001:10001 "$data"
chmod 0700 "$data"

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
