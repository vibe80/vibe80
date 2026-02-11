# Scripts

This directory contains utility scripts for the Vibe80 ecosystem.

## 1) `worktree_message.sh`

End-to-end API script for a worktree:

1. workspace login (`POST /api/workspaces/login`)
2. worktree wakeup (`POST /api/sessions/:sessionId/worktrees/:worktreeId/wakeup`, fallback `wakup`)
3. optional attachments upload
4. send a user message (`POST /api/sessions/:sessionId/worktrees/:worktreeId/messages`)

### Requirements

- `bash`
- `curl`
- `jq`

### Example (without attachments)

```bash
export BASE_URL="http://localhost:3000"
export WORKSPACE_ID="<workspaceId>"
export WORKSPACE_SECRET="<workspaceSecret>"
export SESSION_ID="<sessionId>"
export WORKTREE_ID="main"

scripts/worktree_message.sh \
  --text "list the current directory"
```

### Example (with multiple attachments)

```bash
export BASE_URL="http://localhost:3000"
export WORKSPACE_ID="<workspaceId>"
export WORKSPACE_SECRET="<workspaceSecret>"
export SESSION_ID="<sessionId>"
export WORKTREE_ID="<worktreeId>"

scripts/worktree_message.sh \
  --text "analyze these files" \
  --file "/tmp/a.txt" \
  --file "/tmp/b.png"
```

### Configuration

- `BASE_URL` (required)
- `WORKSPACE_ID` (required)
- `WORKSPACE_SECRET` (required)
- `SESSION_ID` (required)
- `WORKTREE_ID` (required)
- `TIMEOUT` (optional, default: `30`)

### CLI options

- `--text` (required)
- `--file <path>` (optional, repeatable)

---

## 2) `parse_commit_metadata.sh`

Script that parses `VIBE80-Tag` metadata from the latest Git commit message.

### Expected commit message line

```text
VIBE80-Tag: <sessionId>/<worktreeId>
```

### Behavior

- Reads the latest commit (`git log -1 --pretty=%B`)
- Looks for the `VIBE80-Tag:` line
- Extracts `sessionId` and `worktreeId`
- Exports `SESSION_ID` and `WORKTREE_ID`

### Example

```bash
scripts/parse_commit_metadata.sh
```

Returns a non-zero exit code if the `VIBE80-Tag:` line is missing.
