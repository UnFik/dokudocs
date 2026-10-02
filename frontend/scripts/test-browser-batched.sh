#!/usr/bin/env bash
# Runs the browser tests of the given files/dirs in small batches, one fresh
# vitest process (and so one fresh Chromium) per batch.
#
# Why: the unbundled Muya module graph costs ~235 requests per spec file. After
# roughly 1200-1700 requests in one Chromium, further module fetches fail with
# net::ERR_INSUFFICIENT_RESOURCES, vitest reports "Cannot connect to the
# iframe" / "Failed to fetch dynamically imported module", and the run can hang.
# A single `vitest run` over the whole muya tree therefore aborts partway.
#
# A batch that fails or hangs is retried (fresh browser) before it counts.
#
# Usage: scripts/test-browser-batched.sh <file-or-dir>...
# Env:   BATCH_SIZE (default 5), BATCH_TIMEOUT seconds (default 60),
#        BATCH_RETRIES (default 2)
set -uo pipefail

cd "$(dirname "$0")/.."

BATCH_SIZE="${BATCH_SIZE:-5}"
BATCH_TIMEOUT="${BATCH_TIMEOUT:-60}"
BATCH_RETRIES="${BATCH_RETRIES:-2}"

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <file-or-dir>..." >&2
  exit 2
fi

mapfile -t files < <(
  find "$@" -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) | sort
)
total=${#files[@]}
if [ "$total" -eq 0 ]; then
  echo "no test files found under: $*" >&2
  exit 2
fi

failed=()
for ((i = 0; i < total; i += BATCH_SIZE)); do
  batch=("${files[@]:i:BATCH_SIZE}")
  n=$((i / BATCH_SIZE + 1))
  ok=0
  for ((attempt = 0; attempt <= BATCH_RETRIES; attempt++)); do
    echo "== batch $n (files $((i + 1))-$((i + ${#batch[@]})) of $total), attempt $((attempt + 1))"
    if timeout --kill-after=10 "$BATCH_TIMEOUT" ./node_modules/.bin/vitest run --browser.headless "${batch[@]}"; then
      ok=1
      break
    fi
  done
  if [ "$ok" -ne 1 ]; then
    failed+=("batch $n: ${batch[*]}")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "FAILED batches:" >&2
  printf '  %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "all $total files passed"
