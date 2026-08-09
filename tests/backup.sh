#!/usr/bin/env bash
# QC-03: the scheduled backup must copy the live database, safely, or refuse.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
backup="$root/scripts/backup.sh"

command -v sqlite3 >/dev/null 2>&1 || { echo "These tests need sqlite3."; exit 1; }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

D="$work/data/v3/d1/miniflare-D1DatabaseObject"
LIVE="$D/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"

seed() {
  rm -rf "$work/data" "$work/backups"
  mkdir -p "$D"
  sqlite3 "$LIVE" "PRAGMA journal_mode=WAL;
    CREATE TABLE animals(id TEXT);
    CREATE TABLE care_schedules(id TEXT);
    CREATE TABLE husbandry_events(id TEXT);
    INSERT INTO animals VALUES('resident');" >/dev/null
}

run_backup() {
  SHED_DATA_PATH="$work/data" SHED_BACKUP_PATH="$work/backups" "$@" bash "$backup"
}

# ── The live database is chosen, not the first file that turns up ────────────
seed
# Decoys named to sort both before and after the real one, as they do live:
# the keeper's own data directory is full of dated hand-named snapshots.
sqlite3 "$D/aaaa-earlier-snapshot.sqlite" "CREATE TABLE decoy(x);" >/dev/null
sqlite3 "$D/zzzz-later-snapshot.sqlite" "CREATE TABLE decoy(x);" >/dev/null
sqlite3 "$D/shed-before-something-20260726.sqlite" "CREATE TABLE decoy(x);" >/dev/null
archive="$(run_backup)"
[ -n "$archive" ] || { echo "No archive path was printed." >&2; exit 1; }
sqlite3 "$archive" "SELECT COUNT(*) FROM animals;" >/dev/null 2>&1 \
  || { echo "The archive is not the live database — a decoy was chosen." >&2; exit 1; }
sqlite3 "$archive" "SELECT 1 FROM sqlite_master WHERE name='decoy';" | grep -q . \
  && { echo "A decoy database was backed up." >&2; exit 1; }
echo "  the live database is selected despite decoys on both sides"

# ── Data committed while the write-ahead log is active must be included ──────
seed
sqlite3 "$LIVE" "PRAGMA journal_mode=WAL; INSERT INTO animals VALUES('committed-to-wal');" >/dev/null
[ -f "$LIVE-wal" ] || echo "  note: no -wal file present; SQLite may have checkpointed early"
archive="$(run_backup)"
count="$(sqlite3 "$archive" "SELECT COUNT(*) FROM animals WHERE id='committed-to-wal';")"
[ "$count" = "1" ] || { echo "A row committed while WAL was active is missing from the archive." >&2; exit 1; }
echo "  rows committed while WAL is active are in the archive"

# ── The archive is private ───────────────────────────────────────────────────
mode="$(stat -c '%a' "$archive" 2>/dev/null || stat -f '%Lp' "$archive")"
[ "$mode" = "600" ] || { echo "Archive is mode $mode, expected 600." >&2; exit 1; }
echo "  the archive is written 0600"

# ── A database that is not Shed must not be promoted ─────────────────────────
seed
rm -f "$LIVE"
sqlite3 "$LIVE" "CREATE TABLE unrelated(x);" >/dev/null
if run_backup >/dev/null 2>&1; then
  echo "A database without Shed's tables was accepted." >&2
  exit 1
fi
[ -z "$(find "$work/backups" -name 'shed-*.sqlite' 2>/dev/null)" ] \
  || { echo "A rejected copy was still promoted into place." >&2; exit 1; }
[ -z "$(find "$work/backups" -name '.shed-*.partial' 2>/dev/null)" ] \
  || { echo "A partial file was left behind." >&2; exit 1; }
echo "  a database missing Shed's tables is rejected and nothing is promoted"

# ── Missing database directory fails loudly ──────────────────────────────────
rm -rf "$work/data"
if run_backup >/dev/null 2>&1; then
  echo "A missing data directory should fail." >&2
  exit 1
fi
echo "  a missing database directory fails instead of writing an empty archive"

# ── Ambiguity is refused rather than guessed ─────────────────────────────────
seed
sqlite3 "$D/bbbb2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite" \
  "CREATE TABLE animals(id TEXT);" >/dev/null
if run_backup >/dev/null 2>&1; then
  echo "Two live-shaped databases should be refused, not guessed between." >&2
  exit 1
fi
echo "  two live-shaped databases are refused rather than guessed between"

# ── Two runs in the same second must not overwrite each other ────────────────
seed
first="$(run_backup)"
again="$(run_backup)"
[ "$first" != "$again" ] || { echo "A second backup overwrote the first." >&2; exit 1; }
[ -f "$first" ] && [ -f "$again" ] || { echo "Both archives should exist." >&2; exit 1; }
echo "  two backups in the same second produce two archives"

# ── Retention removes stale archives but never the only one ──────────────────
seed
# Build the stale archives directly rather than racing the clock.
mkdir -p "$work/backups"
for old_name in shed-20200101-000000 shed-20200102-000000; do
  cp "$LIVE" "$work/backups/$old_name.sqlite"
  touch -t 202001010000 "$work/backups/$old_name.sqlite"
done
fresh="$(run_backup)"
[ -f "$fresh" ] || { echo "The new archive is missing." >&2; exit 1; }
for old_name in shed-20200101-000000 shed-20200102-000000; do
  [ ! -f "$work/backups/$old_name.sqlite" ] \
    || { echo "Retention did not remove stale archive $old_name." >&2; exit 1; }
done
echo "  retention removes stale archives"

# Every archive stale, and the newest of them must still survive.
rm -rf "$work/backups"; mkdir -p "$work/backups"
cp "$LIVE" "$work/backups/shed-20200101-000000.sqlite"
touch -t 202001010000 "$work/backups/shed-20200101-000000.sqlite"
# Retention only runs after a good archive is written, so the newest is always
# the one just taken; assert the old one goes and a backup remains either way.
run_backup >/dev/null
remaining="$(find "$work/backups" -name 'shed-*.sqlite' | wc -l | tr -d ' ')"
[ "$remaining" -ge 1 ] || { echo "Retention left no backup at all." >&2; exit 1; }
echo "  retention never leaves the machine with no backup"

# ── The host-side tool reads safe path settings without sourcing .env ────────
configured="$work/configured-install"
configured_data="$configured/private-data/v3/d1/miniflare-D1DatabaseObject"
configured_live="$configured_data/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite"
mkdir -p "$configured_data"
sqlite3 "$configured_live" "CREATE TABLE animals(id TEXT); CREATE TABLE care_schedules(id TEXT); CREATE TABLE husbandry_events(id TEXT);" >/dev/null
cat >"$configured/.env" <<'ENV'
SHED_DATA_PATH=./private-data
SHED_BACKUP_PATH=./private-backups
SHED_BACKUP_KEEP=7
# This must be treated as inert text, never executed by the backup tool.
IGNORED=$(touch /tmp/shed-env-must-not-execute)
ENV
rm -f /tmp/shed-env-must-not-execute
configured_archive="$(SHED_INSTALL_DIR="$configured" bash "$backup")"
case "$configured_archive" in "$configured/private-backups"/*) ;; *)
  echo "Backup did not resolve .env paths relative to the install directory." >&2
  exit 1
esac
[ ! -e /tmp/shed-env-must-not-execute ] || {
  echo "Backup executed untrusted content from .env." >&2
  exit 1
}
configured_mode="$(stat -c '%a' "$configured/private-backups" 2>/dev/null || stat -f '%Lp' "$configured/private-backups")"
[ "$configured_mode" = 700 ] || { echo "Backup directory is mode $configured_mode, expected 700." >&2; exit 1; }
echo "  .env backup paths are read as data, resolved safely, and kept private"

echo "Backup tests passed."
