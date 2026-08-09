#!/usr/bin/env bash
set -euo pipefail
umask 077

raw="https://raw.githubusercontent.com/jlyfshhh/shed/main"
install_dir="${SHED_INSTALL_DIR:-$HOME/shed}"

command -v curl >/dev/null || { echo "Shed needs curl."; exit 1; }
command -v docker >/dev/null || { echo "Shed needs Docker with the Compose plugin."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose is not available."; exit 1; }
if docker info >/dev/null 2>&1; then
  docker_cmd=(docker)
elif command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker_cmd=(sudo docker)
else
  echo "Docker is installed, but this user cannot access it." >&2
  exit 1
fi

# A script piped through sudo otherwise chooses uid 0 and quietly puts the
# application back in a root container. Prefer the invoking account; a direct
# root install falls back to the dedicated uid baked into the image.
host_uid="${SUDO_UID:-$(id -u)}"
host_gid="${SUDO_GID:-$(id -g)}"
if [ "$host_uid" = 0 ]; then
  host_uid=10001
  host_gid=10001
fi

mkdir -p "$install_dir"
chmod 0700 "$install_dir"
cd "$install_dir"
mkdir -p data backups scripts
chmod 0700 data backups scripts

download_private() {
  local url="$1" destination="$2" mode="$3" temporary
  temporary="${destination}.new.$$"
  rm -f "$temporary"
  if ! curl -fsSL "$url" -o "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  chmod "$mode" "$temporary" || { rm -f "$temporary"; return 1; }
  mv -f "$temporary" "$destination" || { rm -f "$temporary"; return 1; }
}

# An image install needs only Compose, settings, and the host-side backup tool.
# Always refresh the non-secret files; this also updates older repository-clone
# installs whose checkout is dirty or no longer receives fast-forward pulls.
download_private "$raw/compose.yaml" compose.yaml 0600
if ! download_private "$raw/scripts/backup.sh" scripts/backup.sh 0700; then
  rm -f scripts/backup.sh.new.*
  echo "Warning: could not download scripts/backup.sh; backups will be unavailable." >&2
fi

new_secret() {
  openssl rand -hex 24 2>/dev/null \
    || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

created_env=false
if [ ! -f .env ]; then
  download_private "$raw/.env.example" .env 0600
  created_env=true
fi

# Never start a public example secret, even when someone first copied the
# example manually and only later ran the installer.
if grep -q '^SHED_BOOTSTRAP_TOKEN=replace-with-a-different-long-random-secret$' .env; then
  token="$(new_secret)"
  sed -i.bak "s/SHED_BOOTSTRAP_TOKEN=replace-with-a-different-long-random-secret/SHED_BOOTSTRAP_TOKEN=$token/" .env
  rm -f .env.bak
fi
if grep -q '^SHED_DISPLAY_TOKEN=replace-with-a-separate-long-random-secret$' .env; then
  display_token="$(new_secret)"
  sed -i.bak "s/SHED_DISPLAY_TOKEN=replace-with-a-separate-long-random-secret/SHED_DISPLAY_TOKEN=$display_token/" .env
  rm -f .env.bak
fi

env_value() {
  sed -n "s/^$1=//p" .env | tail -n 1
}

env_default() {
  local key="$1" value="$2"
  if ! grep -q "^${key}=" .env; then
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

env_replace() {
  local key="$1" value="$2"
  sed -i.bak "s/^${key}=.*/${key}=${value}/" .env
  rm -f .env.bak
}

if [ "$created_env" = true ]; then
  env_replace SHED_UID "$host_uid"
  env_replace SHED_GID "$host_gid"
fi

# Preserve intentional values on an existing installation. Only old files
# missing the new non-root and resource-boundary settings receive defaults.
env_default SHED_AUTH_REQUIRED true
env_default SHED_UID "$host_uid"
env_default SHED_GID "$host_gid"
env_default SHED_MEMORY_LIMIT 1g
env_default SHED_CPU_LIMIT 2.0
env_default SHED_PIDS_LIMIT 256
env_default SHED_DATA_PATH ./data
env_default SHED_BACKUP_PATH ./backups
env_default SHED_BACKUP_KEEP 30
chmod 0600 .env compose.yaml

shed_uid="$(env_value SHED_UID)"
shed_gid="$(env_value SHED_GID)"
case "$shed_uid" in ''|*[!0-9]*|0) echo "SHED_UID must be a non-zero numeric uid." >&2; exit 1 ;; esac
case "$shed_gid" in ''|*[!0-9]*) echo "SHED_GID must be a numeric gid." >&2; exit 1 ;; esac

data_path="$(env_value SHED_DATA_PATH)"
data_path="${data_path:-./data}"
backup_path="$(env_value SHED_BACKUP_PATH)"
backup_path="${backup_path:-./backups}"
case "$data_path" in
  /|.|..) echo "SHED_DATA_PATH must name a dedicated data directory, not $data_path." >&2; exit 1 ;;
esac
case "$backup_path" in
  /|.|..) echo "SHED_BACKUP_PATH must name a dedicated backup directory, not $backup_path." >&2; exit 1 ;;
esac
mkdir -p "$data_path" "$backup_path"

if ! "${docker_cmd[@]}" compose pull; then
  echo >&2
  echo "Could not download the Shed image from ghcr.io." >&2
  echo "Check this machine's internet access and try again." >&2
  exit 1
fi

# Stop an older root process before repairing ownership so it cannot recreate a
# root-owned WAL or lock file between chown and the replacement startup.
"${docker_cmd[@]}" compose stop shed >/dev/null 2>&1 || true

repair_owner() {
  if chown -R "$shed_uid:$shed_gid" "$data_path" "$backup_path" 2>/dev/null; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 && sudo chown -R "$shed_uid:$shed_gid" "$data_path" "$backup_path"; then
    return 0
  fi
  echo "Cannot repair Shed data ownership. Run: sudo chown -R $shed_uid:$shed_gid '$data_path' '$backup_path'" >&2
  return 1
}
repair_owner
find "$data_path" "$backup_path" -type d -exec chmod 0700 {} +
find "$data_path" "$backup_path" -type f -exec chmod 0600 {} +

"${docker_cmd[@]}" compose up -d

container_id="$("${docker_cmd[@]}" compose ps -q shed)"
if [ -z "$container_id" ]; then
  echo "Shed did not create a container." >&2
  "${docker_cmd[@]}" compose logs --tail 80 shed >&2 || true
  exit 1
fi

healthy=false
for _ in $(seq 1 30); do
  health="$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$health" in
    healthy) healthy=true; break ;;
    unhealthy|exited|dead) break ;;
  esac
  sleep 2
done
if [ "$healthy" != true ]; then
  echo "Shed started but did not become healthy (status: ${health:-unknown})." >&2
  "${docker_cmd[@]}" compose logs --tail 80 shed >&2 || true
  "${docker_cmd[@]}" compose stop shed >/dev/null 2>&1 || true
  exit 1
fi

host="$(hostname)"
# `hostname -f` can return a name that resolves nowhere, and a .local name needs
# mDNS that Windows and many Android phones do not have. The LAN address works
# from the same network, so lead with it when one is available.
lan_ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth|virbr|tun|tap)/ {print $4}' | cut -d/ -f1 \
  | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -n 1 || true)"
port="${SHED_PORT:-$(env_value SHED_PORT)}"
port="${port:-3000}"
echo
echo "Shed is running. Open it from any device on the same network:"
if [ -n "$lan_ip" ]; then
  echo "  http://$lan_ip:$port"
  echo "  or http://$host.local:$port"
else
  echo "  http://$host.local:$port"
fi
echo
echo "On first visit, use the one-time setup token stored in $install_dir/.env."
echo "Run this installer again to update; your database and settings are left alone."
echo
echo "If the address will not load: curl -fsSL https://animalroom.app/doctor.sh | bash"
