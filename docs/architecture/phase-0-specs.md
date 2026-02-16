# Phase 0 Specs (Workspace Model)

## IDs
- Workspace ID format: `w{24-hex}`
  - Example: `w9276276c9992d115016c5be8`
- Session ID format: `s{24-hex}`
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
    - `iss`: vibe80
    - `aud`: workspace
    - `jti`: UUID (for future revocation)

## Workspace Providers Schema
- `providers` is defined at workspace creation
- Sessions inherit providers from workspace
- Allowed auth types:
  - `api_key`
  - `auth_json_b64`
  - `setup_token`
- Minimal schema (extensible):

```json
{
  "providers": {
    "codex": {
      "enabled": true,
      "auth": {
        "type": "api_key",
        "value": "API_KEY"
      }
    },
    "claude": {
      "enabled": true,
      "auth": {
        "type": "auth_json_b64",
        "value": "B64_ENCODED_AUTH_JSON"
      }
    }
  }
}
```

## Storage Layout (Workspace Data)
- Multi-user workspace root: `/workspaces/{workspaceId}/`
- Mono-user workspace root: `~/vibe80_workspace/`
- Common layout:
  - `metadata/`
    - `workspace.json` (providers + config)
    - `workspace.secret` (secret)
  - `sessions/`
    - `{sessionId}/`
      - `repository/`
      - `attachments/`
      - `worktrees/`
      - `logs/`

## Storage Layout (Server Global)
- Global JWT signing key (shared for all workspaces)
  - Suggested path: `/var/lib/vibe80/jwt.key`

## JWT Signing Key Strategy
- Global signing key (shared for all workspaces)

## API Changes (Spec Only)
- New endpoints:
  - `POST /api/v1/workspaces` (providers + auth)
  - `POST /api/v1/workspaces/login` (exchange secret for token)
  - `DELETE /api/v1/workspaces/{workspaceId}` (policy TBD)
  - `PATCH /api/v1/workspaces/{workspaceId}` (update providers/auth)
- `POST /api/v1/session` no longer accepts provider(s)
  - Remove `POST /api/v1/auth-file` and `POST /api/v1/claude-auth-file` (workspace manages creds)

## Notes
- No implementation in Phase 0
- Specs are used to update docs/api and align future work
