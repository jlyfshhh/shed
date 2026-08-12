#!/usr/bin/env bash
# Standalone installer regression: staged validation, private credentials,
# canonical storage policy, verified pre-update backup, and exact rollback.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
work="$(mktemp -d "$root/.installer-test.XXXXXX")"
trap 'rm -rf "$work"' EXIT
bin="$work/bin"
mkdir -p "$bin"

cat >"$bin/docker" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$DOCKER_CALLS"

case "${1:-}" in
  info) exit 0 ;;
  inspect)
    if [[ "${2:-}" == shed ]]; then
      [[ "${MOCK_PREVIOUS:-false}" == true ]]
      exit
    fi
    if [[ "${2:-}" == --format ]]; then
      case "${3:-}" in
        '{{.Image}}') printf 'sha256:old-shed\n' ;;
        '{{.Config.Image}}') printf 'ghcr.io/jlyfshhh/shed:latest\n' ;;
        '{{.State.Running}}') printf '%s\n' "${MOCK_PREVIOUS_RUNNING:-true}" ;;
        *'com.docker.compose.project.working_dir'*) printf '%s\n' "${MOCK_WORKING_DIR:-$CURRENT_INSTALL}" ;;
        *'.Mounts'*) printf '%s\n' "$CURRENT_INSTALL/data" ;;
        *'.State.Health'*) printf '%s\n' "${MOCK_HEALTH:-healthy}" ;;
        *) printf '%s\n' "${MOCK_HEALTH:-healthy}" ;;
      esac
      exit 0
    fi
    ;;
  image)
    [[ "${2:-}" == tag ]]
    exit 0
    ;;
  compose)
    joined="$*"
    case "$joined" in
      "compose version") exit 0 ;;
      *" config --quiet")
        [[ "${MOCK_FAIL:-}" != config ]]
        exit
        ;;
      "compose pull")
        if [[ "${REQUIRE_BACKUP_BEFORE_PULL:-false}" == true ]]; then
          find "$CURRENT_INSTALL/backups" -maxdepth 1 -type f -name 'shed-*.sqlite' -print -quit | grep -q . || {
            echo "pull happened before a verified backup" >&2
            exit 9
          }
        fi
        [[ "${MOCK_FAIL:-}" != pull ]]
        exit
        ;;
      "compose stop shed")
        [[ "${MOCK_FAIL:-}" != stop ]]
        exit
        ;;
      "compose up -d")
        [[ "${MOCK_FAIL:-}" != up ]]
        exit
        ;;
      "compose up -d --no-build --pull never") exit 0 ;;
      "compose ps -q shed") printf 'shed-test-container\n'; exit 0 ;;
      "compose logs --tail 80 shed") exit 0 ;;
      "compose down --remove-orphans") exit 0 ;;
    esac
    ;;
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
set -euo pipefail
printf 'chown %s\n' "$*" >>"$DOCKER_CALLS"
[[ "${MOCK_FAIL:-}" != chown ]]
SH

cat >"$bin/sudo" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${MOCK_FAIL:-}" == chown && "${1:-}" == chown ]]; then
  exit 1
fi
exec "$@"
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
  *backup.sh.new.*) cp "$TEST_ROOT/scripts/backup.sh" "$destination" ;;
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

run_install() {
  local fixture="$1"
  mkdir -p "$fixture/home"
  : >"$fixture/docker-calls"
  PATH="$bin:/usr/bin:/bin" \
  TEST_ROOT="$root" \
  DOCKER_CALLS="$fixture/docker-calls" \
  CURRENT_INSTALL="$fixture/shed" \
  SHED_INSTALL_DIR="$fixture/shed" \
  HOME="$fixture/home" \
  bash "$root/get-shed.sh"
}

write_env() {
  local directory="$1" data_path="${2:-./data}" backup_path="${3:-./backups}" external="${4:-false}"
  mkdir -p "$directory"
  cat >"$directory/.env" <<ENV
SHED_TIME_ZONE=America/New_York
SHED_AUTH_REQUIRED=true
SHED_BOOTSTRAP_TOKEN=private-bootstrap-token
SHED_DISPLAY_TOKEN=private-display-token
SHED_PORT=3000
SHED_DATA_PATH=$data_path
SHED_BACKUP_PATH=$backup_path
SHED_BACKUP_KEEP=30
SHED_ALLOW_EXTERNAL_PATHS=$external
SHED_UID=$(id -u)
SHED_GID=$(id -g)
SHED_MEMORY_LIMIT=1g
SHED_CPU_LIMIT=2.0
SHED_PIDS_LIMIT=256
ENV
  chmod 0600 "$directory/.env"
}

seed_database() {
  local directory="$1"
  local d1="$directory/data/v3/d1/miniflare-D1DatabaseObject"
  local live="$d1/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
  mkdir -p "$d1" "$directory/backups"
  sqlite3 "$live" "CREATE TABLE animals(id TEXT); CREATE TABLE care_schedules(id TEXT); CREATE TABLE husbandry_events(id TEXT); INSERT INTO animals VALUES('history');" >/dev/null
}

seed_update() {
  local fixture="$1" directory
  directory="$fixture/shed"
  write_env "$directory"
  seed_database "$directory"
  cp "$root/compose.yaml" "$directory/compose.yaml"
  printf '\n# exact previous compose\n' >>"$directory/compose.yaml"
  mkdir -p "$directory/scripts"
  printf '#!/usr/bin/env bash\necho previous-backup-tool\n' >"$directory/scripts/backup.sh"
  chmod 0700 "$directory/scripts/backup.sh"
  cp "$directory/.env" "$fixture/original.env"
  cp "$directory/compose.yaml" "$fixture/original.compose"
  cp "$directory/scripts/backup.sh" "$fixture/original.backup"
}

assert_rolled_back() {
  local fixture="$1"
  cmp "$fixture/original.env" "$fixture/shed/.env"
  cmp "$fixture/original.compose" "$fixture/shed/compose.yaml"
  cmp "$fixture/original.backup" "$fixture/shed/scripts/backup.sh"
  sqlite3 "$fixture/shed/data/v3/d1/miniflare-D1DatabaseObject/"*.sqlite \
    "SELECT COUNT(*) FROM animals WHERE id='history';" | grep -qx 1
  grep -q '^image tag sha256:old-shed ghcr.io/jlyfshhh/shed:latest$' "$fixture/docker-calls"
}

# A fresh install rotates examples, validates before pull, and starts healthy.
fresh="$work/fresh"
mkdir -p "$fresh"
fresh_output="$(run_install "$fresh")"
grep -q 'http://shed-test.local:3000' <<<"$fresh_output"
grep -q '^SHED_AUTH_REQUIRED=true$' "$fresh/shed/.env"
grep -q '^SHED_ALLOW_EXTERNAL_PATHS=false$' "$fresh/shed/.env"
! grep -q 'replace-with-' "$fresh/shed/.env"
expected_uid="$(id -u)"
expected_gid="$(id -g)"
if [ "$expected_uid" = 0 ]; then expected_uid=10001; expected_gid=10001; fi
grep -q "^SHED_UID=$expected_uid$" "$fresh/shed/.env"
grep -q "^SHED_GID=$expected_gid$" "$fresh/shed/.env"
[ "$(mode_of "$fresh/shed")" = 700 ]
[ "$(mode_of "$fresh/shed/data")" = 700 ]
[ "$(mode_of "$fresh/shed/backups")" = 700 ]
[ "$(mode_of "$fresh/shed/.env")" = 600 ]
[ "$(mode_of "$fresh/shed/compose.yaml")" = 600 ]
[ "$(mode_of "$fresh/shed/scripts/backup.sh")" = 700 ]
grep -q 'config --quiet$' "$fresh/docker-calls"
grep -q '^compose pull$' "$fresh/docker-calls"
grep -q '^compose up -d$' "$fresh/docker-calls"
echo "  fresh install validates, rotates credentials, and starts privately"

# Candidate validation happens before backup, pull, file replacement, or an
# interruption to the existing service.
invalid="$work/invalid"
mkdir -p "$invalid"
seed_update "$invalid"
if MOCK_PREVIOUS=true MOCK_FAIL=config run_install "$invalid" >"$invalid/out" 2>"$invalid/err"; then
  echo "An invalid candidate Compose file was accepted." >&2
  exit 1
fi
cmp "$invalid/original.env" "$invalid/shed/.env"
cmp "$invalid/original.compose" "$invalid/shed/compose.yaml"
! grep -q '^compose pull$' "$invalid/docker-calls"
! grep -q '^compose stop shed$' "$invalid/docker-calls"
! grep -q '^compose down --remove-orphans$' "$invalid/docker-calls"
echo "  invalid candidates leave the running install untouched"

# A generic container name is not authorization to stop it. The installer
# must prove that an existing `shed` container belongs to this exact Compose
# project and that its previous graph is restorable before doing any work.
foreign="$work/foreign-container"
mkdir -p "$foreign" "$work/other-compose-project"
seed_update "$foreign"
if MOCK_PREVIOUS=true \
   MOCK_WORKING_DIR="$work/other-compose-project" \
   run_install "$foreign" >"$foreign/out" 2>"$foreign/err"; then
  echo "A foreign container named shed was accepted as this installation." >&2
  exit 1
fi
cmp "$foreign/original.env" "$foreign/shed/.env"
cmp "$foreign/original.compose" "$foreign/shed/compose.yaml"
! grep -q '^compose pull$' "$foreign/docker-calls"
! grep -q '^compose stop shed$' "$foreign/docker-calls"
grep -q 'different or unidentifiable Compose project' "$foreign/err"

missing_graph="$work/missing-rollback-graph"
mkdir -p "$missing_graph/shed"
write_env "$missing_graph/shed"
seed_database "$missing_graph/shed"
cp "$missing_graph/shed/.env" "$missing_graph/original.env"
if MOCK_PREVIOUS=true run_install "$missing_graph" >"$missing_graph/out" 2>"$missing_graph/err"; then
  echo "An existing container without a restorable Compose graph was accepted." >&2
  exit 1
fi
cmp "$missing_graph/original.env" "$missing_graph/shed/.env"
[ ! -f "$missing_graph/shed/compose.yaml" ]
! grep -q '^compose pull$' "$missing_graph/docker-calls"
! grep -q '^compose stop shed$' "$missing_graph/docker-calls"
grep -q 'no restorable compose.yaml' "$missing_graph/err"
echo "  foreign or unidentifiable existing containers are never interrupted"

# A broken database cannot be called a backup; refuse before changing the
# working configuration or stopping the existing service.
bad_backup="$work/bad-backup"
mkdir -p "$bad_backup"
seed_update "$bad_backup"
live="$(find "$bad_backup/shed/data" -name '*.sqlite' -print -quit)"
sqlite3 "$live" 'DROP TABLE husbandry_events;' >/dev/null
if MOCK_PREVIOUS=true run_install "$bad_backup" >"$bad_backup/out" 2>"$bad_backup/err"; then
  echo "An update continued after backup verification failed." >&2
  exit 1
fi
cmp "$bad_backup/original.env" "$bad_backup/shed/.env"
cmp "$bad_backup/original.compose" "$bad_backup/shed/compose.yaml"
! grep -q '^compose pull$' "$bad_backup/docker-calls"
! grep -q '^compose stop shed$' "$bad_backup/docker-calls"
grep -q 'pre-update backup' "$bad_backup/err"
echo "  a failed backup aborts before service interruption"

# Every failure after replacement restores exact config, the old mutable image
# tag, prior running state, and untouched records. A pull failure happens before
# stop and therefore does not bounce the still-running container; ownership is
# repaired only after stopping the old writer, so that path does restart it.
for failure in pull stop chown up health; do
  fixture="$work/fail-$failure"
  mkdir -p "$fixture"
  seed_update "$fixture"
  if [ "$failure" = pull ]; then
    # The file may have been edited since the current container was created.
    # Back up the mount Docker says is live, not the candidate path in .env.
    sed -i.bak 's#^SHED_DATA_PATH=.*#SHED_DATA_PATH=./new-data#' "$fixture/shed/.env"
    rm -f "$fixture/shed/.env.bak"
    mkdir -p "$fixture/shed/new-data"
    cp "$fixture/shed/.env" "$fixture/original.env"
  fi
  health=healthy
  mock_failure="$failure"
  if [ "$failure" = health ]; then
    health=unhealthy
    mock_failure=""
  fi
  if MOCK_PREVIOUS=true \
     MOCK_FAIL="$mock_failure" \
     MOCK_HEALTH="$health" \
     REQUIRE_BACKUP_BEFORE_PULL=true \
     run_install "$fixture" >"$fixture/out" 2>"$fixture/err"; then
    echo "The $failure failure path reported success." >&2
    exit 1
  fi
  find "$fixture/shed/backups" -maxdepth 1 -type f -name 'shed-*.sqlite' -print -quit | grep -q .
  assert_rolled_back "$fixture"
  grep -q '^compose up -d --no-build --pull never$' "$fixture/docker-calls" || {
    if [ "$failure" != pull ]; then
      echo "The $failure failure did not restart the prior image." >&2
      exit 1
    fi
  }
  if [ "$failure" = pull ]; then
    ! grep -q '^compose down --remove-orphans$' "$fixture/docker-calls" || {
      echo "The $failure failure unnecessarily interrupted the prior container." >&2
      exit 1
    }
  fi
done
echo "  pull, stop, ownership, startup, and health failures roll back exactly"

# A failed first install is removed without touching the bind-mounted data.
unhealthy="$work/unhealthy-first"
mkdir -p "$unhealthy/shed/data"
printf 'do-not-delete\n' >"$unhealthy/shed/data/sentinel.db"
if MOCK_HEALTH=unhealthy run_install "$unhealthy" >"$unhealthy/out" 2>"$unhealthy/err"; then
  echo "An unhealthy first install reported success." >&2
  exit 1
fi
[ "$(cat "$unhealthy/shed/data/sentinel.db")" = do-not-delete ]
[ ! -f "$unhealthy/shed/.env" ]
[ ! -f "$unhealthy/shed/compose.yaml" ]
grep -q '^compose down --remove-orphans$' "$unhealthy/docker-calls"
echo "  a failed first install retains data and removes only failed runtime files"

# Paths are canonicalized before mutation. External mounts require an opt-in
# and are inspected, never recursively changed by the installer.
unsafe="$work/unsafe"
mkdir -p "$unsafe/shed"
write_env "$unsafe/shed" / ./backups true
if run_install "$unsafe" >"$unsafe/out" 2>"$unsafe/err"; then
  echo "The filesystem root was accepted as Shed data." >&2
  exit 1
fi
! grep -q '^chown ' "$unsafe/docker-calls"

leading="$work/leading"
mkdir -p "$leading/shed"
write_env "$leading/shed" -danger ./backups false
if run_install "$leading" >"$leading/out" 2>"$leading/err"; then
  echo "A leading-dash data path was accepted." >&2
  exit 1
fi
! grep -q '^chown ' "$leading/docker-calls"

expanded="$work/expanded"
mkdir -p "$expanded/shed"
write_env "$expanded/shed" '${HOME}/data' ./backups false
if run_install "$expanded" >"$expanded/out" 2>"$expanded/err"; then
  echo "An interpolated data path was accepted even though Compose would resolve it differently." >&2
  exit 1
fi
! grep -q '^chown ' "$expanded/docker-calls"

escaped="$work/symlink"
mkdir -p "$escaped/shed" "$escaped/outside-data"
ln -s "$escaped/outside-data" "$escaped/shed/data-link"
write_env "$escaped/shed" ./data-link ./backups false
if run_install "$escaped" >"$escaped/out" 2>"$escaped/err"; then
  echo "A symlink escape was accepted without external opt-in." >&2
  exit 1
fi
! grep -q '^chown ' "$escaped/docker-calls"

external="$work/external"
mkdir -p "$external/shed" "$external/data" "$external/backups"
write_env "$external/shed" "$external/data" "$external/backups" true
run_install "$external" >/dev/null
! grep '^chown ' "$external/docker-calls" | grep -Fq "$external/data"
! grep '^chown ' "$external/docker-calls" | grep -Fq "$external/backups"

quoted="$work/quoted"
mkdir -p "$quoted/shed"
write_env "$quoted/shed" ./data "./back'ups" false
run_install "$quoted" >/dev/null
[ -d "$quoted/shed/back'ups" ]
echo "  unsafe paths are rejected and explicit external paths are not recursively mutated"

root_calls="$work/root-install-calls"
: >"$root_calls"
if PATH="$bin:/usr/bin:/bin" \
   TEST_ROOT="$root" \
   DOCKER_CALLS="$root_calls" \
   CURRENT_INSTALL=/ \
   SHED_INSTALL_DIR=/ \
   HOME="$work/root-home" \
   bash "$root/get-shed.sh" >/dev/null 2>&1; then
  echo "The filesystem root was accepted as SHED_INSTALL_DIR." >&2
  exit 1
fi
! grep -q '^chown ' "$root_calls"
echo "  the install root itself must also be a dedicated directory"

# Rejection must happen before mkdir/chmod. This guards against a typo or a
# hostile environment variable causing even an empty directory to appear under
# an operating-system tree.
protected_target="${TMPDIR:-/tmp}/shed-installer-protected-$RANDOM-$$"
[ ! -e "$protected_target" ]
protected_calls="$work/protected-install-calls"
: >"$protected_calls"
if PATH="$bin:/usr/bin:/bin" \
   TEST_ROOT="$root" \
   DOCKER_CALLS="$protected_calls" \
   CURRENT_INSTALL="$protected_target" \
   SHED_INSTALL_DIR="$protected_target" \
   HOME="$work/protected-home" \
   bash "$root/get-shed.sh" >/dev/null 2>&1; then
  echo "A protected temporary-system path was accepted as SHED_INSTALL_DIR." >&2
  exit 1
fi
[ ! -e "$protected_target" ]
! grep -q '^chown ' "$protected_calls"
echo "  protected install targets are rejected before filesystem mutation"

echo "Standalone installer tests passed."
