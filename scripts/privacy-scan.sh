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
#
# That leniency has a sharp edge: a run that *should* have a denylist and does
# not looks exactly like a clean scan. On 2026-08-10 the repository had no
# secrets configured at all, so this had been passing in CI while checking
# nothing — on the one guard that exists to keep real names out of a public
# repository. Set PRIVACY_SCAN_STRICT=1 for runs that can reach secrets (the
# workflow does this for pushes and same-repo pull requests) and an unconfigured
# scan becomes a failure instead of a shrug.
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
  if [[ -n "${PRIVACY_SCAN_STRICT:-}" && "${PRIVACY_SCAN_STRICT}" != "false" && "${PRIVACY_SCAN_STRICT}" != "0" ]]; then
    echo "privacy-scan: no denylist configured, and this run was expected to have one." >&2
    echo "Nothing was checked. Set the PRIVACY_DENYLIST repository secret, or a" >&2
    echo "local .privacy-denylist, so this scan can do its job." >&2
    exit 1
  fi
  # Not fatal by default, but it must not be quiet either: this is the state
  # where the scan looks green and has checked nothing.
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::warning title=Privacy scan did nothing::No denylist configured, so no names were checked. Set the PRIVACY_DENYLIST repository secret."
  fi
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
