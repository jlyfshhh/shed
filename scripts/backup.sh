#!/usr/bin/env bash
# A verified point-in-time copy of Shed's live database.
#
# Prints the archive path on success. Exits non-zero, having written nothing
# into place, if the database cannot be found or the copy cannot be verified.
set -euo pipefail
umask 077

root="${SHED_INSTALL_DIR:-$HOME/shed}"

reject_unsafe_path_text() {
  local label="$1" value="$2"
  case "$value" in
    "") echo "$label cannot be blank." >&2; return 1 ;;
    -*) echo "$label cannot begin with a dash." >&2; return 1 ;;
    *$'\n'*|*$'\r'*) echo "$label cannot contain line breaks." >&2; return 1 ;;
    \'*|\"*|*\'|*\") echo "$label must be an unquoted path value; quote characters at the edges are ambiguous in .env." >&2; return 1 ;;
    *'$'*|*'`'*|*\\*|*:*|*'#'*) echo "$label contains characters that Docker Compose and this tool would interpret differently." >&2; return 1 ;;
  esac
}

reject_unsafe_path_text SHED_INSTALL_DIR "$root"
[ -d "$root" ] || { echo "No Shed install directory at $root." >&2; exit 1; }
root="$(cd -- "$root" && pwd -P)"
case "$root" in /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/mnt|/opt|/private/etc|/private/tmp|/private/var|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|"${HOME:-/nonexistent}")
  echo "SHED_INSTALL_DIR must be a dedicated application directory, not $root." >&2; exit 1 ;;
esac
settings="$root/.env"

setting() {
  local key="$1"
  [ -f "$settings" ] || return 0
  sed -n "s/^${key}=//p" "$settings" | tail -n 1
}

data="${SHED_DATA_PATH:-$(setting SHED_DATA_PATH)}"
destination="${SHED_BACKUP_PATH:-$(setting SHED_BACKUP_PATH)}"
keep="${SHED_BACKUP_KEEP:-$(setting SHED_BACKUP_KEEP)}"
allow_external="${SHED_ALLOW_EXTERNAL_PATHS:-$(setting SHED_ALLOW_EXTERNAL_PATHS)}"
data="${data:-data}"
destination="${destination:-backups}"
keep="${keep:-30}"
allow_external="${allow_external:-false}"

case "$allow_external" in
  true|false) ;;
  *) echo "SHED_ALLOW_EXTERNAL_PATHS must be true or false." >&2; exit 1 ;;
esac
reject_unsafe_path_text SHED_DATA_PATH "$data"
reject_unsafe_path_text SHED_BACKUP_PATH "$destination"

# Compose resolves relative bind paths beside compose.yaml. Do the same even
# when the backup command is launched from another working directory.
case "$data" in /*) ;; *) data="$root/${data#./}" ;; esac
case "$destination" in /*) ;; *) destination="$root/${destination#./}" ;; esac
case "$keep" in ''|*[!0-9]*) echo "SHED_BACKUP_KEEP must be a whole number of days." >&2; exit 1 ;; esac

create_internal_directory() {
  local candidate="$1" remainder component current next
  case "$candidate" in
    "$root"/*) remainder="${candidate#"$root"/}" ;;
    *) return 1 ;;
  esac
  current="$root"
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

# The installer normally creates both directories. Refuse to manufacture an
# external path from a typo in .env; an explicit external mount must already
# exist before the backup job is allowed to use it.
if [ ! -d "$data" ]; then
  echo "No Shed data directory at $data." >&2
  exit 1
fi
data="$(cd -- "$data" && pwd -P)"

if [ -e "$destination" ]; then
  [ -d "$destination" ] || { echo "SHED_BACKUP_PATH is not a directory: $destination" >&2; exit 1; }
elif ! create_internal_directory "$destination"; then
  echo "External SHED_BACKUP_PATH must already be a dedicated directory, and internal paths cannot traverse symlinks or '..': $destination" >&2
  exit 1
fi
destination="$(cd -- "$destination" && pwd -P)"

case "$data" in
  "$root"/*) ;;
  *)
    [ "$allow_external" = true ] || {
      echo "SHED_DATA_PATH resolves outside $root. Set SHED_ALLOW_EXTERNAL_PATHS=true only for a dedicated, pre-created mount." >&2
      exit 1
    }
    ;;
esac
case "$destination" in
  "$root"/*) ;;
  *)
    [ "$allow_external" = true ] || {
      echo "SHED_BACKUP_PATH resolves outside $root. Set SHED_ALLOW_EXTERNAL_PATHS=true only for a dedicated, pre-created mount." >&2
      exit 1
    }
    ;;
esac

case "$data/" in
  "$destination/"*) echo "SHED_DATA_PATH and SHED_BACKUP_PATH cannot contain one another." >&2; exit 1 ;;
esac
case "$destination/" in
  "$data/"*) echo "SHED_DATA_PATH and SHED_BACKUP_PATH cannot contain one another." >&2; exit 1 ;;
esac

case "$data" in /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/mnt|/opt|/private/etc|/private/tmp|/private/var|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|"${HOME:-/nonexistent}")
  echo "SHED_DATA_PATH must be a dedicated directory, not $data." >&2; exit 1 ;;
esac
case "$destination" in /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/mnt|/opt|/private/etc|/private/tmp|/private/var|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/var|"${HOME:-/nonexistent}")
  echo "SHED_BACKUP_PATH must be a dedicated directory, not $destination." >&2; exit 1 ;;
esac

command -v sqlite3 >/dev/null 2>&1 || {
  echo "Shed's backup needs the sqlite3 command. Install it with: sudo apt-get install -y sqlite3" >&2
  exit 1
}

# The live database is the one Miniflare names after a 64-character hex id, in
# its own object directory. Everything else under data/ that ends in .sqlite is
# a previous backup or a hand-named snapshot — and this script used to take
# "the first .sqlite found anywhere", which on the keeper's own Pi selected a
# 340 KB snapshot from July instead of the 2.4 MB live database.
d1_dir="$data/v3/d1/miniflare-D1DatabaseObject"
# "Not there" and "there but not readable by you" need different answers. The
# data directory belongs to the container's user and is mode 0700, so running
# this by hand as the login user gets permission denied on a directory that is
# perfectly fine — and being told to check SHED_DATA_PATH sends you looking for
# a problem that does not exist. The scheduled backup runs as root and is
# unaffected either way.
if [ ! -d "$d1_dir" ]; then
  if [ -e "$data" ] && [ ! -r "$data" ]; then
    echo "Cannot read $data — it belongs to the container's user." >&2
    echo "Run this with sudo, or let the scheduled backup handle it." >&2
  else
    echo "No Shed database directory at $d1_dir — is SHED_DATA_PATH right?" >&2
  fi
  exit 1
fi

live=""
found=0
while IFS= read -r candidate; do
  base="$(basename "$candidate" .sqlite)"
  case "$base" in
    # Exactly 64 lowercase hex characters and nothing else.
    [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]*)
      [ "${#base}" -eq 64 ] || continue
      case "$base" in *[!0-9a-f]*) continue ;; esac
      live="$candidate"
      found=$((found + 1))
      ;;
  esac
done < <(find "$d1_dir" -maxdepth 1 -type f -name '*.sqlite')

if [ "$found" -eq 0 ]; then
  echo "No live Shed database found in $d1_dir." >&2
  exit 1
elif [ "$found" -gt 1 ]; then
  echo "Found $found candidate databases in $d1_dir; refusing to guess." >&2
  exit 1
fi

chmod 0700 "$destination"
stamp="$(date +%Y%m%d-%H%M%S)"
final="$destination/shed-$stamp.sqlite"
# Two runs inside the same second would otherwise land on the same name and the
# second would silently replace the first — losing a backup precisely when
# someone is taking an extra one because they are about to do something risky.
suffix=2
while [ -e "$final" ]; do
  final="$destination/shed-$stamp-$suffix.sqlite"
  suffix=$((suffix + 1))
done
partial="$destination/.$(basename "$final" .sqlite).partial"
trap 'rm -f "$partial"' EXIT

# `.backup` uses SQLite's online backup API, which takes a consistent snapshot
# including anything committed to the write-ahead log. A plain `cp` of the main
# file while Shed is running can miss committed data or copy a torn page.
# SQLite dot commands have their own quoting rules. Double-quote and escape the
# filename for that parser instead of interpolating it inside single quotes;
# apostrophes in a legitimate directory name must not truncate the destination.
sqlite_destination="${partial//\\/\\\\}"
sqlite_destination="${sqlite_destination//\"/\\\"}"
sqlite3 "$live" ".timeout 15000" ".backup \"$sqlite_destination\""

integrity="$(sqlite3 "$partial" 'PRAGMA integrity_check;' 2>/dev/null || echo failed)"
[ "$integrity" = "ok" ] || {
  echo "The copy failed its integrity check ($integrity); nothing was written." >&2
  exit 1
}

# An intact but empty file passes integrity_check. Confirm it is actually Shed.
for table in animals care_schedules husbandry_events; do
  present="$(sqlite3 "$partial" \
    "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$table';" 2>/dev/null || echo 0)"
  [ "$present" = "1" ] || {
    echo "The copy is missing the $table table; nothing was written." >&2
    exit 1
  }
done

chmod 600 "$partial"
mv -f "$partial" "$final"   # atomic within one filesystem
trap - EXIT

# Retention runs after a good archive exists, never before, and always leaves
# the most recent one alone even if it is older than the window — a quiet
# machine must not end up with no backup at all.
newest="$(ls -1t "$destination"/shed-*.sqlite 2>/dev/null | head -n 1 || true)"
while IFS= read -r old; do
  # `[ x ] && continue` is a statement whose status is 1 when the test fails,
  # which under `set -e` ends the script before anything is deleted — and
  # before the archive path is printed. Written as `if` so it cannot.
  if [ -n "$old" ] && [ "$old" != "$newest" ]; then
    rm -f "$old" || echo "Could not remove old archive $old" >&2
  fi
done < <(find "$destination" -maxdepth 1 -type f -name 'shed-*.sqlite' -mtime "+$keep" 2>/dev/null)

echo "$final"
