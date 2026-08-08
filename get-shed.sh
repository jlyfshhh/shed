#!/usr/bin/env bash
set -euo pipefail

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

mkdir -p "$install_dir"
cd "$install_dir"
mkdir -p data backups

if [ -d .git ]; then
  # An install from when this script cloned the repository. Keep it current so
  # its compose.yaml picks up the published image like everyone else's.
  command -v git >/dev/null && git pull --ff-only || true
else
  # Shed now runs from a published image, so an install is a compose file and
  # a settings file. No checkout, no toolchain, and no build on this machine.
  curl -fsSL "$raw/compose.yaml" -o compose.yaml
fi

if [ ! -f .env ]; then
  umask 077
  curl -fsSL "$raw/.env.example" -o .env
  token="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  display_token="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  sed -i.bak \
    "s/SHED_AUTH_REQUIRED=false/SHED_AUTH_REQUIRED=true/; s/replace-with-a-different-long-random-secret/$token/; s/replace-with-a-separate-long-random-secret/$display_token/" \
    .env
  rm -f .env.bak
fi

if ! "${docker_cmd[@]}" compose pull; then
  echo >&2
  echo "Could not download the Shed image from ghcr.io." >&2
  echo "Check this machine's internet access and try again." >&2
  exit 1
fi
"${docker_cmd[@]}" compose up -d

host="$(hostname -f 2>/dev/null || hostname)"
echo
echo "Shed is running at http://$host:${SHED_PORT:-3000}"
echo "On first visit, use the one-time setup token stored in $install_dir/.env."
echo "Run this installer again to update; your database and settings are left alone."
