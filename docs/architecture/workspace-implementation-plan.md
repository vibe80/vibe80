# Workspace Architecture Implementation Plan

## Phase 0 - Specs
- Define ID formats: w{hash}, s{hash}
- Define providers/auth schema at workspace level
- Define JWT signing key strategy and claims
- Confirm storage paths inside workspace home
- Update API docs/specs accordingly

## Phase 1 - Workspace API + Auth
- POST /api/workspaces
  - Create Linux user w{hash}
  - Create home + workspace root
  - Persist workspaceSecret in home
  - Persist providers/auth config in home
- PATCH /api/workspaces/{workspaceId}
  - Update providers/auth config for the workspace
- POST /api/workspaces/login
  - Validate workspaceId + workspaceSecret
  - Issue JWT (24h)
- Auth middleware
  - Verify JWT signature
  - Resolve workspaceId from sub claim

## Phase 2 - UID Isolation
- Run subprocesses under workspace UID/GID
- Apply 0700/0600 permissions to workspace data and secrets
- Enforce no cross-workspace access (tests)

## Phase 3 - Sessions
- Store sessions under ~/vibecoder_workspace/sessions/{sessionId}
- Remove providers from session creation
- Session inherits providers from workspace
- Ensure clone per session (no shared repo)

## Phase 4 - WebSocket
- Require workspaceToken on WS connections
- Map WS connection to workspaceId via JWT
- Enforce session/worktree scope under workspace

## Phase 5 - Cleanup and Hardening
- Session GC (TTL/inactivity/quotas)
- Audit logs per workspace
- Security tests for isolation

## Decisions Locked
- Token TTL: 24h
- Workspace secret stored in home
- Token type: JWT signed
- Providers configured at workspace creation
