#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

raw="https://raw.githubusercontent.com/jlyfshhh/shed/main"
install_dir="${SHED_INSTALL_DIR:-$HOME/shed}"
rollback_root=""
rollback_armed=false
service_touched=false

die() {
  echo "$*" >&2
  exit 1
}

reject_unsafe_path_text() {
  local label="$1" value="$2"
  case "$value" in
    "") die "$label cannot be blank." ;;
    -*) die "$label cannot begin with a dash." ;;
    *$'\n'*|*$'\r'*) die "$label cannot contain line breaks." ;;
    \'*|\"*|*\'|*\") die "$label must be an unquoted path value; quote characters at the edges are ambiguous in .env." ;;
    *'$'*|*'`'*|*\\*|*:*|*'#'*) die "$label contains characters that Docker Compose and this installer would interpret differently." ;;
  esac
}

command -v curl >/dev/null || die "Shed needs curl."
command -v docker >/dev/null || die "Shed needs Docker with the Compose plugin."
docker compose version >/dev/null 2>&1 || die "Docker Compose is not available."
if docker info >/dev/null 2>&1; then
  docker_cmd=(docker)
elif command -v sudo >/dev/null 2>&1 && sudo docker info >/dev/null 2>&1; then
  docker_cmd=(sudo docker)
else
  die "Docker is installed, but this user cannot access it."
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

reject_unsafe_path_text SHED_INSTALL_DIR "$install_dir"
canonical_target_without_creating() {
  local candidate="$1" suffix="" leaf
  case "$candidate" in /*) ;; *) candidate="$PWD/$candidate" ;; esac
  [ "$candidate" = / ] || candidate="${candidate%/}"
  while [ ! -e "$candidate" ]; do
    leaf="${candidate##*/}"
    [ -n "$leaf" ] || return 1
    suffix="/$leaf$suffix"
    candidate="${candidate%/*}"
    [ -n "$candidate" ] || candidate=/
  done
  [ -d "$candidate" ] || return 1
  printf '%s%s\n' "$(cd -- "$candidate" && pwd -P)" "$suffix"
}

install_candidate="$(canonical_target_without_creating "$install_dir")" ||
  die "SHED_INSTALL_DIR has no usable parent directory."
case "$install_candidate" in
  /|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/lib|/lib/*|/lib64|/lib64/*|/private/etc|/private/etc/*|/private/tmp|/private/tmp/*|/private/var|/private/var/*|/proc|/proc/*|/run|/run/*|/sbin|/sbin/*|/sys|/sys/*|/tmp|/tmp/*|/usr|/usr/*|/var|/var/*|/home|/mnt|/opt|/root|/srv|"${HOME:-/nonexistent}")
    die "SHED_INSTALL_DIR must be a dedicated application directory, not $install_candidate."
    ;;
esac
mkdir -p -- "$install_candidate"
install_dir="$(cd -- "$install_candidate" && pwd -P)"
chmod 0700 "$install_dir"

# Compose normally lets exported variables silently override .env. The
# installer deliberately treats its private .env as the single source of truth
# so validation, ownership repair, startup, and rollback all use the same paths.
compose_clean() {
  (
    cd "$install_dir"
    env \
      -u SHED_PORT -u SHED_TAG -u SHED_DATA_PATH -u SHED_BACKUP_PATH \
      -u SHED_BACKUP_KEEP -u SHED_ALLOW_EXTERNAL_PATHS \
      -u SHED_UID -u SHED_GID -u SHED_MEMORY_LIMIT -u SHED_CPU_LIMIT \
      -u SHED_PIDS_LIMIT \
      "${docker_cmd[@]}" compose "$@"
  )
}

cleanup_rollback_files() {
  [ -z "$rollback_root" ] || [ ! -d "$rollback_root" ] || rm -rf -- "$rollback_root"
}
trap cleanup_rollback_files EXIT

rollback_root="$(mktemp -d "${TMPDIR:-/tmp}/shed-install.XXXXXX")"
state="$rollback_root/previous"
stage="$rollback_root/stage"
mkdir -p -- "$state" "$stage"

snapshot_file() {
  local relative="$1" saved
  saved="$state/${relative//\//__}"
  if [ -f "$install_dir/$relative" ]; then
    cp -p -- "$install_dir/$relative" "$saved"
    : > "$saved.present"
  fi
}

restore_file() {
  local relative="$1" saved
  saved="$state/${relative//\//__}"
  if [ -f "$saved.present" ]; then
    mkdir -p -- "$(dirname "$install_dir/$relative")"
    cp -p -- "$saved" "$install_dir/$relative"
  else
    rm -f -- "$install_dir/$relative"
  fi
}

snapshot_file .env
snapshot_file compose.yaml
snapshot_file scripts/backup.sh

previous_container=false
if "${docker_cmd[@]}" inspect shed >/dev/null 2>&1; then
  previous_container=true
  previous_working_dir="$("${docker_cmd[@]}" inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' shed 2>/dev/null || true)"
  if [ -z "$previous_working_dir" ] || [ ! -d "$previous_working_dir" ] ||
     [ "$(cd -- "$previous_working_dir" && pwd -P)" != "$install_dir" ]; then
    die "A container named shed belongs to a different or unidentifiable Compose project. Refusing to stop it."
  fi
  [ -f "$install_dir/compose.yaml" ] ||
    die "The existing Shed container has no restorable compose.yaml in $install_dir."
  "${docker_cmd[@]}" inspect --format '{{.Image}}' shed > "$state/image.id"
  "${docker_cmd[@]}" inspect --format '{{.Config.Image}}' shed > "$state/image.ref"
  "${docker_cmd[@]}" inspect --format '{{.State.Running}}' shed > "$state/running"
  "${docker_cmd[@]}" inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}}{{end}}{{end}}' shed > "$state/data.mount"
fi

rollback_install() {
  local failed=false image_id image_ref was_running
  rollback_armed=false
  trap - ERR INT TERM
  echo "Restoring the previous Shed configuration..." >&2

  if [ "$service_touched" = true ] && [ -f "$install_dir/compose.yaml" ]; then
    compose_clean down --remove-orphans >/dev/null 2>&1 || true
  fi
  restore_file .env
  restore_file compose.yaml
  restore_file scripts/backup.sh

  if [ "$previous_container" = true ]; then
    image_id="$(cat "$state/image.id")"
    image_ref="$(cat "$state/image.ref")"
    was_running="$(cat "$state/running")"
    if [ -n "$image_id" ] && [ -n "$image_ref" ] &&
       [[ "$image_ref" != *@sha256:* && "$image_ref" != sha256:* ]]; then
      "${docker_cmd[@]}" image tag "$image_id" "$image_ref" >/dev/null 2>&1 || failed=true
    fi
    if [ "$service_touched" = true ] && [ -f "$install_dir/compose.yaml" ]; then
      compose_clean up -d --no-build --pull never >/dev/null 2>&1 || failed=true
      if [ "$was_running" != true ]; then
        compose_clean stop shed >/dev/null 2>&1 || failed=true
      fi
    elif [ "$service_touched" = true ]; then
      failed=true
    fi
  fi

  if [ "$failed" = true ]; then
    echo "Shed's records were not removed, but the previous service could not be restarted automatically." >&2
    return 1
  fi
  echo "The previous Shed service and settings were restored; no application data was removed." >&2
}

fail_with_rollback() {
  local message="$1"
  trap - ERR INT TERM
  if [ "$rollback_armed" = true ]; then
    rollback_install || true
  fi
  die "$message"
}

handle_unexpected_error() {
  local line="$1" status="$2"
  trap - ERR INT TERM
  if [ "$rollback_armed" = true ]; then
    rollback_install || true
  fi
  echo "Shed installation failed near line $line. No application data was removed." >&2
  exit "$status"
}

handle_signal() {
  local status="$1"
  trap - ERR INT TERM
  if [ "$rollback_armed" = true ]; then
    rollback_install || true
  fi
  exit "$status"
}

trap 'handle_unexpected_error "$LINENO" "$?"' ERR
trap 'handle_signal 130' INT
trap 'handle_signal 143' TERM

download_private() {
  local url="$1" destination="$2" mode="$3" temporary
  temporary="${destination}.new.$$"
  rm -f -- "$temporary"
  if ! curl -fsSL "$url" -o "$temporary"; then
    rm -f -- "$temporary"
    return 1
  fi
  chmod "$mode" "$temporary" || { rm -f -- "$temporary"; return 1; }
  mv -f -- "$temporary" "$destination" || { rm -f -- "$temporary"; return 1; }
}

# Download into an isolated staging directory. The working install is not
# touched until all files and the rendered Compose configuration validate.
download_private "$raw/compose.yaml" "$stage/compose.yaml" 0600 ||
  fail_with_rollback "Could not download Shed's Compose configuration."
download_private "$raw/scripts/backup.sh" "$stage/backup.sh" 0700 ||
  fail_with_rollback "Could not download Shed's backup tool."

new_secret() {
  openssl rand -hex 24 2>/dev/null \
    || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

created_env=false
if [ -f "$install_dir/.env" ]; then
  cp -p -- "$install_dir/.env" "$stage/.env"
else
  download_private "$raw/.env.example" "$stage/.env" 0600 ||
    fail_with_rollback "Could not download Shed's settings template."
  created_env=true
fi

env_value() {
  local key="$1" file="${2:-$stage/.env}"
  sed -n "s/^$key=//p" "$file" | tail -n 1
}

env_default() {
  local key="$1" value="$2" file="${3:-$stage/.env}"
  if ! grep -q "^${key}=" "$file"; then
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

env_replace() {
  local key="$1" value="$2" file="${3:-$stage/.env}"
  sed -i.bak "s/^${key}=.*/${key}=${value}/" "$file"
  rm -f -- "$file.bak"
}

# Never start a public example secret, including when someone copied the
# template manually before switching to the installer.
if grep -q '^SHED_BOOTSTRAP_TOKEN=replace-with-a-different-long-random-secret$' "$stage/.env"; then
  env_replace SHED_BOOTSTRAP_TOKEN "$(new_secret)"
fi
if grep -q '^SHED_DISPLAY_TOKEN=replace-with-a-separate-long-random-secret$' "$stage/.env"; then
  env_replace SHED_DISPLAY_TOKEN "$(new_secret)"
fi

if [ "$created_env" = true ]; then
  env_replace SHED_UID "$host_uid"
  env_replace SHED_GID "$host_gid"
fi

# Preserve intentional values on an existing installation. Only old files
# missing hardened-runtime settings receive defaults.
env_default SHED_AUTH_REQUIRED true
env_default SHED_UID "$host_uid"
env_default SHED_GID "$host_gid"
env_default SHED_MEMORY_LIMIT 1g
env_default SHED_CPU_LIMIT 2.0
env_default SHED_PIDS_LIMIT 256
env_default SHED_DATA_PATH ./data
env_default SHED_BACKUP_PATH ./backups
env_default SHED_BACKUP_KEEP 30
env_default SHED_ALLOW_EXTERNAL_PATHS false
chmod 0600 "$stage/.env"

shed_uid="$(env_value SHED_UID)"
shed_gid="$(env_value SHED_GID)"
case "$shed_uid" in ''|*[!0-9]*|0) fail_with_rollback "SHED_UID must be a non-zero numeric uid." ;; esac
case "$shed_gid" in ''|*[!0-9]*) fail_with_rollback "SHED_GID must be a numeric gid." ;; esac

allow_external="$(env_value SHED_ALLOW_EXTERNAL_PATHS)"
allow_external="${allow_external:-false}"
case "$allow_external" in
  true|false) ;;
  *) fail_with_rollback "SHED_ALLOW_EXTERNAL_PATHS must be true or false." ;;
esac

create_internal_directory() {
  local candidate="$1" remainder component current next
  case "$candidate" in
    "$install_dir"/*) remainder="${candidate#"$install_dir"/}" ;;
    *) return 1 ;;
  esac
  current="$install_dir"
  while [ -n "$remainder" ]; do
    case "$remainder" in
      */*) component="${remainder%%/*}"; remainder="${remainder#*/}" ;;
      *) component="$remainder"; remainder="" ;;
    esac
    case "$component" in ""|.|..) return 1 ;; esac
    next="$current/$component"
    [ ! -L "$next" ] || return 1
    if [ -e "$next" ]; then
      [ -d "$next" ] || return 1
    else
      mkdir -- "$next" || return 1
      chmod 0700 "$next" || return 1
    fi
    current="$next"
  done
}

prepare_storage_path() {
  local label="$1" raw_value="$2" path_var="$3" external_var="$4"
  local candidate canonical is_external=false
  reject_unsafe_path_text "$label" "$raw_value"
  case "$raw_value" in
    /*) candidate="$raw_value" ;;
    *) candidate="$install_dir/${raw_value#./}" ;;
  esac

  if [ -e "$candidate" ]; then
    [ -d "$candidate" ] || fail_with_rollback "$label is not a directory: $candidate"
  elif ! create_internal_directory "$candidate"; then
    fail_with_rollback "External $label must already be a dedicated directory, and internal paths cannot traverse symlinks or '..': $candidate"
  fi
  canonical="$(cd -- "$candidate" && pwd -P)"

  case "$canonical" in
    /|/bin|/bin/*|/boot|/boot/*|/dev|/dev/*|/etc|/etc/*|/lib|/lib/*|/lib64|/lib64/*|/private/etc|/private/etc/*|/private/tmp|/private/tmp/*|/private/var|/private/var/*|/proc|/proc/*|/run|/run/*|/sbin|/sbin/*|/sys|/sys/*|/tmp|/tmp/*|/usr|/usr/*|/var|/var/*|/home|/mnt|/opt|/root|/srv|"${HOME:-/nonexistent}")
      fail_with_rollback "$label must be a dedicated directory, not $canonical."
      ;;
  esac
  case "$install_dir/" in
    "$canonical/"*) fail_with_rollback "$label cannot be the Shed install directory or one of its parents." ;;
  esac
  case "$canonical" in
    "$install_dir"/*) ;;
    *) is_external=true ;;
  esac
  if [ "$is_external" = true ] && [ "$allow_external" != true ]; then
    fail_with_rollback "$label resolves outside $install_dir. Set SHED_ALLOW_EXTERNAL_PATHS=true only for a dedicated, pre-created mount."
  fi
  printf -v "$path_var" '%s' "$canonical"
  printf -v "$external_var" '%s' "$is_external"
}

data_setting="$(env_value SHED_DATA_PATH)"
backup_setting="$(env_value SHED_BACKUP_PATH)"
prepare_storage_path SHED_DATA_PATH "${data_setting:-./data}" data_path data_external
prepare_storage_path SHED_BACKUP_PATH "${backup_setting:-./backups}" backup_path backup_external

case "$data_path/" in
  "$backup_path/"*) fail_with_rollback "SHED_DATA_PATH and SHED_BACKUP_PATH cannot contain one another." ;;
esac
case "$backup_path/" in
  "$data_path/"*) fail_with_rollback "SHED_DATA_PATH and SHED_BACKUP_PATH cannot contain one another." ;;
esac

print_ownership_repair() {
  local path="$1"
  printf 'External storage is not owned by uid %s. Review the path, then repair it explicitly if correct:\n  sudo chown -R %q %q\n' \
    "$shed_uid" "$shed_uid:$shed_gid" "$path" >&2
}

verify_external_tree() {
  local path="$1" wrong
  if ! wrong="$(find "$path" ! -user "$shed_uid" -print -quit 2>/dev/null)"; then
    fail_with_rollback "Cannot safely inspect external storage at $path."
  fi
  if [ -n "$wrong" ]; then
    print_ownership_repair "$path"
    fail_with_rollback "Refusing to change an external directory recursively."
  fi
}

[ "$data_external" != true ] || verify_external_tree "$data_path"

# Validate the exact candidate files before replacing the working copies or
# interrupting an existing service.
# Validate the staged bundle in the staging directory, not the install root.
# compose.yaml carries `env_file: .env`, and Compose resolves that against
# --project-directory rather than against the file it appears in. Pointing it at
# the install root asks for an .env that does not exist yet on a first install —
# it is written there only once validation has passed — so every fresh install
# failed with "env file .../.env not found". The staged copy is the one being
# validated and it sits beside its own .env.
if ! (
  cd "$install_dir"
  env \
    -u SHED_PORT -u SHED_TAG -u SHED_DATA_PATH -u SHED_BACKUP_PATH \
    -u SHED_BACKUP_KEEP -u SHED_ALLOW_EXTERNAL_PATHS \
    -u SHED_UID -u SHED_GID -u SHED_MEMORY_LIMIT -u SHED_CPU_LIMIT \
    -u SHED_PIDS_LIMIT \
    "${docker_cmd[@]}" compose --project-directory "$stage" \
      --env-file "$stage/.env" -f "$stage/compose.yaml" config --quiet
); then
  fail_with_rollback "The downloaded Shed Compose configuration is invalid."
fi

database_present="$previous_container"
backup_data_path="$data_path"
backup_allow_external="$allow_external"
if [ "$previous_container" = true ]; then
  # .env may have been edited after the current container was created. Docker's
  # inspected bind source is authoritative for the database that is actually
  # live (or was live, when preserving a deliberately stopped container).
  running_mount="$(cat "$state/data.mount")"
  reject_unsafe_path_text "the running container's /data mount" "$running_mount"
  [ -d "$running_mount" ] ||
    fail_with_rollback "The running container's /data source is not a host directory: $running_mount"
  backup_data_path="$(cd -- "$running_mount" && pwd -P)"
  case "$backup_data_path" in "$install_dir"/*) ;; *) backup_allow_external=true ;; esac
fi
d1_dir="$backup_data_path/v3/d1/miniflare-D1DatabaseObject"
if [ -d "$d1_dir" ]; then
  database_present=true
elif command -v sudo >/dev/null 2>&1 && sudo test -d "$d1_dir"; then
  # A mode-0700 data tree owned by the container uid is intentionally not
  # traversable by the login account. The backup itself uses the same fallback.
  database_present=true
fi

if [ "$database_present" = true ]; then
  backup_error="$stage/backup.err"
  backup_output=""
  if backup_output="$(
    SHED_INSTALL_DIR="$install_dir" \
    SHED_DATA_PATH="$backup_data_path" \
    SHED_BACKUP_PATH="$backup_path" \
    SHED_BACKUP_KEEP="$(env_value SHED_BACKUP_KEEP)" \
    SHED_ALLOW_EXTERNAL_PATHS="$backup_allow_external" \
    bash "$stage/backup.sh" 2>"$backup_error"
  )"; then
    :
  elif command -v sudo >/dev/null 2>&1 && backup_output="$(
    sudo env \
      SHED_INSTALL_DIR="$install_dir" \
      SHED_DATA_PATH="$backup_data_path" \
      SHED_BACKUP_PATH="$backup_path" \
      SHED_BACKUP_KEEP="$(env_value SHED_BACKUP_KEEP)" \
      SHED_ALLOW_EXTERNAL_PATHS="$backup_allow_external" \
      bash "$stage/backup.sh" 2>"$backup_error"
  )"; then
    :
  else
    [ ! -s "$backup_error" ] || cat "$backup_error" >&2
    fail_with_rollback "Shed could not create and verify a pre-update backup, so the running service was left unchanged."
  fi
  [ -n "$backup_output" ] && [ -f "$backup_output" ] ||
    fail_with_rollback "Shed's pre-update backup did not produce a verified archive."
  echo "Verified pre-update backup: $backup_output"
fi

# From this point forward the working configuration or running service can
# change. Any failure must restore the snapshot captured above.
rollback_armed=true
mkdir -p -- "$install_dir/scripts"
chmod 0700 "$install_dir/scripts"
cp -p -- "$stage/compose.yaml" "$install_dir/compose.yaml"
cp -p -- "$stage/.env" "$install_dir/.env"
cp -p -- "$stage/backup.sh" "$install_dir/scripts/backup.sh"
chmod 0600 "$install_dir/.env" "$install_dir/compose.yaml"
chmod 0700 "$install_dir/scripts/backup.sh"

if ! compose_clean pull; then
  fail_with_rollback "Could not download the Shed image from ghcr.io. Check this machine's internet access and try again."
fi

# Stop the older writer before an internal ownership migration, so it cannot
# recreate a root-owned WAL or lock file between repair and replacement start.
service_touched=true
if ! compose_clean stop shed >/dev/null 2>&1; then
  fail_with_rollback "Shed's existing container could not be stopped safely."
fi

secure_internal_tree() {
  local path="$1"
  # Stay on the dedicated directory's filesystem. A nested mount must never be
  # swept into an ownership migration just because it happens to sit below the
  # configured path.
  if find "$path" -xdev -exec chown -- "$shed_uid:$shed_gid" {} + 2>/dev/null; then
    :
  elif command -v sudo >/dev/null 2>&1 &&
       sudo find "$path" -xdev -exec chown -- "$shed_uid:$shed_gid" {} +; then
    :
  else
    printf 'Cannot repair Shed storage ownership. Review the path, then run:\n  sudo chown -R %q %q\n' \
      "$shed_uid:$shed_gid" "$path" >&2
    return 1
  fi
  find "$path" -xdev -type d -exec chmod 0700 {} +
  find "$path" -xdev -type f -exec chmod 0600 {} +
}

[ "$data_external" = true ] || secure_internal_tree "$data_path" ||
  fail_with_rollback "Shed could not secure its data directory."
[ "$backup_external" = true ] || secure_internal_tree "$backup_path" ||
  fail_with_rollback "Shed could not secure its backup directory."

if ! compose_clean up -d; then
  fail_with_rollback "Shed's updated container could not start."
fi

container_id="$(compose_clean ps -q shed)"
if [ -z "$container_id" ]; then
  compose_clean logs --tail 80 shed >&2 || true
  fail_with_rollback "Shed did not create a container."
fi

healthy=false
health="unknown"
for _ in $(seq 1 30); do
  health="$("${docker_cmd[@]}" inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
  case "$health" in
    healthy) healthy=true; break ;;
    unhealthy|exited|dead) break ;;
  esac
  sleep 2
done
if [ "$healthy" != true ]; then
  compose_clean logs --tail 80 shed >&2 || true
  fail_with_rollback "Shed started but did not become healthy (status: ${health:-unknown})."
fi

rollback_armed=false
host="$(hostname)"
# `hostname -f` can return a name that resolves nowhere, and a .local name needs
# mDNS that Windows and many Android phones do not have. Prefer an RFC1918 LAN
# address when one is available.
lan_ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth|virbr|tun|tap)/ {print $4}' | cut -d/ -f1 \
  | grep -E '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -n 1 || true)"
port="$(env_value SHED_PORT "$install_dir/.env")"
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
echo "Run this installer again to update. It takes a verified backup and restores the prior service if the update fails."
echo
echo "If the address will not load: curl -fsSL https://animalroom.app/doctor.sh | bash"
