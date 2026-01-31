# Workspace Architecture Model (Validated)

## Goals
- Persistent workspaces bound to a Linux user (strict isolation)
- Sessions hosted inside a workspace, each with its own git clone
- Worktrees scoped to sessions, one branch per worktree
- Providers and credentials managed at workspace level
- REST/WS authenticated via a short-lived workspace token (JWT)

## Entities and Relationships
- Workspace
  - ID: w{hash} (e.g., w9276276c9992d115016c5be8)
  - Linux user: same ID
  - Persistent
  - Providers + auth stored at workspace level
- Session
  - ID: s{hash} (proposed)
  - Belongs to one workspace
  - Requires a git repo (mandatory)
  - Owns a dedicated git clone
  - Inherits providers from workspace
- Worktree
  - Child of a session
  - Exactly one branch
  - Chat/actions/diff/logs are per worktree

## Storage Layout
- Home: /home/w{hash}
- Workspace root: ~/vibecoder_workspace/
- Sessions: ~/vibecoder_workspace/sessions/{sessionId}/
  - repository/ (git clone)
  - attachments/
  - worktrees/
  - logs/
- Credentials (workspace-scoped):
  - ~/.codex/auth.json
  - ~/.claude/...

## Security Model (Strict Isolation)
- One Linux user per workspace
- Server runs unprivileged (`vibecoder`) and delegates privileged actions to root helpers
- File permissions: directories 02750 (setgid + group for workspace), secrets 0600
- All subprocesses (git/codex/claude/pty) run under workspace UID/GID via `vibecoder-run-as`
- Cross-workspace access forbidden (must not be readable or visible)

## Storage Backend (Env)
- `STORAGE_BACKEND` is mandatory: `redis` or `sqlite`
- When `STORAGE_BACKEND=redis`:
  - `REDIS_URL` is required
  - Optional: `REDIS_KEY_PREFIX` (default: `vc`)
- When `STORAGE_BACKEND=sqlite`:
  - `SQLITE_PATH` is required (absolute or relative path to the DB file)

## Providers
- Providers are configured at workspace creation
- Sessions do not accept providers; they inherit from the workspace
- No rotation/versioning for now

## Provider Sandbox Whitelist
- Claude CLI: uses `--add-dir` to whitelist paths
- Codex app-server: uses `sandbox_workspace_write.writable_roots`
- Whitelisted paths:
  - Session repository: `.../sessions/<session_id>/repository/`
  - Current worktree: `.../sessions/<session_id>/worktrees/<worktree_id>/`
  - Attachments: `.../sessions/<session_id>/attachments/`

## Auth Model (Option B)
- POST /api/workspaces returns workspaceSecret (non-expiring)
- POST /api/workspaces/login exchanges secret for JWT workspaceToken
- Token TTL: 24 hours
- JWT claims: sub, exp, iat, iss, aud, jti
- REST and WS use only workspaceToken
  - REST: Authorization: Bearer <token>
  - WS: ws://.../ws?token=<token>

## API Notes (Concept)
- Workspace endpoints
  - POST /api/workspaces (providers + auth)
  - DELETE /api/workspaces/{id} (policy TBD)
  - POST /api/workspaces/login (get short token)
- Session endpoints
  - POST /api/sessions (repoUrl only; inherits providers)
  - Session data includes workspaceId server-side
- Worktree endpoints
  - Remain session-scoped; no cross-session access

## Session Lifecycle
- Sessions can live long
- GC mechanism needed later (TTL/inactivity/quotas)
- Persistence in DB possible later, not priority

## Constraints
- Repo clones are per session (no shared clones)
- Worktree transfer between sessions not in scope
- Security isolation is an absolute requirement
