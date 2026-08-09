#!/usr/bin/env bash
# A verified point-in-time copy of Shed's live database.
#
# Prints the archive path on success. Exits non-zero, having written nothing
# into place, if the database cannot be found or the copy cannot be verified.
set -euo pipefail
umask 077

root="${SHED_INSTALL_DIR:-$HOME/shed}"
data="${SHED_DATA_PATH:-$root/data}"
destination="${SHED_BACKUP_PATH:-$root/backups}"
keep="${SHED_BACKUP_KEEP:-30}"

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
[ -d "$d1_dir" ] || {
  echo "No Shed database directory at $d1_dir — is SHED_DATA_PATH right?" >&2
  exit 1
}

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

mkdir -p "$destination"
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
sqlite3 "$live" ".timeout 15000" ".backup '$partial'"

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
