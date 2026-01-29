# Phase 0 Specs (Workspace Model)

## IDs
- Workspace ID format: `w{hash}`
  - Example: `w9276276c9992d115016c5be8`
- Session ID format (proposed): `s{hash}`
- Hash length: 24 hex chars (same as current session hash length)

## Auth (Workspace)
- workspaceSecret
  - Non-expiring secret
  - Stored in workspace home
- workspaceToken
  - JWT signed
  - TTL: 24h
  - Claims:
    - `sub`: workspaceId
    - `exp`: now + 24h
    - `iat`: issued at

## Workspace Providers Schema
- `providers` is defined at workspace creation
- Sessions inherit providers from workspace
- Minimal schema (extensible):

```json
{
  "providers": {
    "codex": {
      "enabled": true,
      "auth": {
        "type": "file",
        "path": "/home/w{hash}/.codex/auth.json"
      }
    },
    "claude": {
      "enabled": true,
      "auth": {
        "type": "file",
        "path": "/home/w{hash}/.claude/credentials.json"
      }
    }
  }
}
```

## Storage Layout (Workspace Home)
- `~/vibecoder_workspace/`
  - `metadata/`
    - `workspace.json` (providers + config)
    - `workspace.secret` (secret)
    - `jwt.key` (signing key, if per-workspace)
  - `sessions/`
    - `{sessionId}/`
      - `repository/`
      - `attachments/`
      - `worktrees/`
      - `logs/`

## JWT Signing Key Strategy
- Global signing key (shared for all workspaces)

## API Changes (Spec Only)
- New endpoints:
  - `POST /api/workspaces` (providers + auth)
  - `POST /api/workspaces/login` (exchange secret for token)
  - `DELETE /api/workspaces/{workspaceId}` (policy TBD)
  - `PATCH /api/workspaces/{workspaceId}` (update providers/auth)
- `POST /api/session` no longer accepts provider(s)
  - Remove `POST /api/auth-file` and `POST /api/claude-auth-file` (workspace manages creds)

## Notes
- No implementation in Phase 0
- Specs are used to update docs/api and align future work
