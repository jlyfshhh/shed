#!/usr/bin/env bash
set -euo pipefail

repo="https://github.com/jlyfshhh/shed.git"
install_dir="${SHED_INSTALL_DIR:-$HOME/shed}"

command -v git >/dev/null || { echo "Shed needs git."; exit 1; }
command -v docker >/dev/null || { echo "Shed needs Docker with the Compose plugin."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "Docker Compose is not available."; exit 1; }

if [ -d "$install_dir/.git" ]; then
  git -C "$install_dir" pull --ff-only
else
  git clone "$repo" "$install_dir"
fi

cd "$install_dir"
mkdir -p data backups
if [ ! -f .env ]; then
  umask 077
  token="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cp .env.example .env
  sed -i.bak "s/SHED_AUTH_REQUIRED=false/SHED_AUTH_REQUIRED=true/; s/replace-with-a-different-long-random-secret/$token/" .env
  rm -f .env.bak
fi

docker compose up -d --build
host="$(hostname -f 2>/dev/null || hostname)"
echo
echo "Shed is running at http://$host:${PORT:-3000}"
echo "On first visit, use the one-time setup token stored in $install_dir/.env."
echo "Run this installer again to update without replacing your database or settings."
