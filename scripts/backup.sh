#!/usr/bin/env bash
set -euo pipefail

root="${SHED_INSTALL_DIR:-$HOME/shed}"
data="${SHED_DATA_PATH:-$root/data}"
destination="${SHED_BACKUP_PATH:-$root/backups}"
keep="${SHED_BACKUP_KEEP:-30}"
mkdir -p "$destination"
database="$(find "$data" -type f -name '*.sqlite' -print -quit)"
[ -n "$database" ] || { echo "No Shed SQLite database was found under $data"; exit 1; }
stamp="$(date +%Y%m%d-%H%M%S)"
cp "$database" "$destination/shed-$stamp.sqlite"
find "$destination" -type f -name 'shed-*.sqlite' -mtime "+$keep" -delete
echo "$destination/shed-$stamp.sqlite"
