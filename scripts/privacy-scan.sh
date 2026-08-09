#!/usr/bin/env bash
# Fail if anything tracked in this repository contains a private identity.
#
# The forbidden values are never stored here — that would publish the very
# strings we are trying to keep out. They come from either:
#   * $PRIVACY_DENYLIST — newline- or comma-separated (CI passes a repo secret), or
#   * .privacy-denylist — a local, git-ignored file, one value per line.
#
# With neither set the scan reports that it is unconfigured and passes, so forks
# and outside pull requests are not blocked by a secret they cannot have.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

collect_terms() {
  # The trailing newline matters: `read` returns non-zero on a final line
  # without one, and the loop below would silently drop the last term.
  if [[ -n "${PRIVACY_DENYLIST:-}" ]]; then
    printf '%s\n' "$PRIVACY_DENYLIST" | tr ',' '\n'
  elif [[ -f .privacy-denylist ]]; then
    cat .privacy-denylist
    printf '\n'
  fi
}

terms=()
while IFS= read -r term; do
  term="$(printf '%s' "$term" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
  # Very short terms match half the dictionary; require something specific.
  [[ -z "$term" || "$term" == \#* ]] && continue
  if ((${#term} < 3)); then
    echo "Skipping denylist entry shorter than 3 characters." >&2
    continue
  fi
  terms+=("$term")
done < <(collect_terms)

if ((${#terms[@]} == 0)); then
  echo "privacy-scan: no denylist configured (set PRIVACY_DENYLIST or .privacy-denylist); skipping."
  exit 0
fi

status=0
for term in "${terms[@]}"; do
  # `git grep` searches tracked files only and is portable — an earlier version
  # built a file array with `mapfile`, which does not exist in bash 3.2, so the
  # list came out empty and the scan passed while a real name was present.
  # Lockfiles carry unrelated package names that collide with short words.
  while IFS=: read -r file line _; do
    [[ -z "$file" ]] && continue
    # Printed without the matched value: CI logs on a public repository would
    # otherwise leak the very strings this is protecting.
    echo "PRIVACY: $file:$line contains a denylisted identity (value withheld)."
    status=1
  done < <(git grep -IniwF -- "$term" -- . ':(exclude)package-lock.json' ':(exclude).privacy-denylist' 2>/dev/null)
done

if ((status != 0)); then
  echo >&2
  echo "Remove the identity above and use a generic one such as 'Keeper One'." >&2
  exit 1
fi

echo "privacy-scan: ${#terms[@]} term(s) checked, no matches."
