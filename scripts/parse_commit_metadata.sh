#!/bin/bash
set -eu

# Retrieve the full message of the latest commit
commit_msg="$(git log -1 --pretty=%B)"

# Extract the VIBE80-Tag line
tag_line="$(printf "%s\n" "$commit_msg" | grep '^VIBE80-Tag:' || true)"

if [ -z "$tag_line" ]; then
  echo "VIBE80-Tag not found in commit message"
  exit 1
fi

# Remove the prefix
tag_value="${tag_line#VIBE80-Tag: }"

# Split sessionId / worktreeId
VIBE80_SESSION_ID="${tag_value%%/*}"
VIBE80_WORKTREE_ID="${tag_value#*/}"

# Optional: export for subsequent steps
export VIBE80_SESSION_ID
export VIBE80_WORKTREE_ID
