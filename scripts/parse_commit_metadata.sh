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
SESSION_ID="${tag_value%%/*}"
WORKTREE_ID="${tag_value#*/}"

echo "sessionId=$sessionId"
echo "worktreeId=$worktreeId"

# Optional: export for subsequent steps
export SESSION_ID
export WORKTREE_ID
