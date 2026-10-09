#!/usr/bin/env bash
# Prints name=tag for each image CI builds, from what goes into that image at a
# commit: a commit that leaves an image's sources alone keeps its tag, so the
# deploy leaves its containers running (docs/deployment.md).
#
#   scripts/deploy/image-tags.sh [commit]
set -euo pipefail

rev=${1:-HEAD}
tree() { git rev-parse "$rev:$1"; }

echo "api=src-$(tree backend)"
echo "frontend=src-$(tree frontend)"
# collab is built from the repository root: its own folder, plus the frontend
# files its Dockerfile copies in.
copied=$(git show "$rev:collab/Dockerfile" | sed -n 's|^COPY \(frontend/[^ ]*\) .*|\1|p')
echo "collab=src-$({
  tree collab
  for path in $copied; do echo "$path $(tree "$path")"; done
} | git hash-object --stdin)"
