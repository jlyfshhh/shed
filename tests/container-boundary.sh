#!/usr/bin/env bash
# Cheap, deterministic release assertions for the Docker security boundary.
# A real Linux/arm64 container smoke test is still required before release.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

require() {
  local needle="$1" file="$2"
  grep -Fq -- "$needle" "$file" || {
    echo "$file is missing required container boundary: $needle" >&2
    exit 1
  }
}

require 'USER 10001:10001' Dockerfile
require 'org.opencontainers.image.source=' Dockerfile
require 'org.opencontainers.image.revision=' Dockerfile
require 'org.opencontainers.image.version=' Dockerfile
require 'org.opencontainers.image.licenses="MIT"' Dockerfile
require 'user: "${SHED_UID:-10001}:${SHED_GID:-10001}"' compose.yaml
require 'read_only: true' compose.yaml
require 'cap_drop:' compose.yaml
require '      - ALL' compose.yaml
require 'no-new-privileges:true' compose.yaml
require '/app/dist/server/.wrangler:' compose.yaml
require '/tmp:' compose.yaml
require 'mem_limit: ${SHED_MEMORY_LIMIT:-1g}' compose.yaml
require 'cpus: "${SHED_CPU_LIMIT:-2.0}"' compose.yaml
require 'mktemp /data/.shed-write-test.' docker-entrypoint.sh
require 'SHED_AUTH_REQUIRED:-true' docker-entrypoint.sh
require 'chmod 0600 "$runtime_env"' docker-entrypoint.sh
require 'provenance: mode=max' .github/workflows/publish-image.yml
require 'sbom: true' .github/workflows/publish-image.yml
require 'SHED_VCS_REF=${{ github.sha }}' .github/workflows/publish-image.yml

if grep -Eq '^[[:space:]]*privileged:[[:space:]]*true' compose.yaml; then
  echo "compose.yaml must never run Shed privileged." >&2
  exit 1
fi

echo "Container boundary assertions passed."
