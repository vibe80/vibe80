import path from "path";
import { CodexAppServerClient } from "./codexClient.js";
import { ClaudeCliClient } from "./claudeClient.js";
import { getSessionRuntime } from "./runtimeStore.js";

/**
 * Get an existing client or create a new one for the given provider.
 * Clients are lazily initialized and cached in session.clients.
 *
 * @param {object} session - The session object
 * @param {"codex" | "claude"} provider - The provider to get or create
 * @returns {Promise<CodexAppServerClient | ClaudeCliClient>}
 */
export async function getOrCreateClient(session, provider) {
  const runtime = getSessionRuntime(session.sessionId);
  if (runtime?.clients?.[provider]) {
    return runtime.clients[provider];
  }

  const defaultDenyGitCredentialsAccess =
    typeof session.defaultDenyGitCredentialsAccess === "boolean"
      ? session.defaultDenyGitCredentialsAccess
      : true;

  const client =
    provider === "claude"
      ? new ClaudeCliClient({
          cwd: session.repoDir,
          attachmentsDir: session.attachmentsDir,
          repoDir: session.repoDir,
          internetAccess: session.defaultInternetAccess,
          denyGitCredentialsAccess: defaultDenyGitCredentialsAccess,
          gitDir: session.gitDir || path.join(session.dir, "git"),
          env: {
            ...process.env,
            TMPDIR: path.join(session.dir, "tmp"),
            CLAUDE_CODE_TMPDIR: path.join(session.dir, "tmp"),
          },
          workspaceId: session.workspaceId,
          tmpDir: path.join(session.dir, "tmp"),
          sessionId: session.sessionId,
          worktreeId: "main",
        })
      : new CodexAppServerClient({
          cwd: session.repoDir,
          attachmentsDir: session.attachmentsDir,
          repoDir: session.repoDir,
          internetAccess: session.defaultInternetAccess,
          denyGitCredentialsAccess: defaultDenyGitCredentialsAccess,
          gitDir: session.gitDir || path.join(session.dir, "git"),
          threadId: session.threadId || null,
          env: {
            ...process.env,
            TMPDIR: path.join(session.dir, "tmp"),
          },
          workspaceId: session.workspaceId,
          tmpDir: path.join(session.dir, "tmp"),
          sessionId: session.sessionId,
          worktreeId: "main",
        });

  if (runtime) {
    runtime.clients[provider] = client;
  }

  return client;
}

/**
 * Create a new client for a worktree (not cached, each worktree gets its own client).
 *
 * @param {object} worktree - The worktree object
 * @param {string} worktree.path - The worktree directory path
 * @param {"codex" | "claude"} worktree.provider - The provider
 * @param {string} [attachmentsDir] - The attachments directory
 * @returns {CodexAppServerClient | ClaudeCliClient}
 */
export function createWorktreeClient(
  worktree,
  attachmentsDir,
  repoDir,
  internetAccess,
  threadId,
  gitDir
) {
  const sessionDir = repoDir ? path.dirname(repoDir) : null;
  const tmpDir = sessionDir ? path.join(sessionDir, "tmp") : null;
  const denyGitCredentialsAccess =
    typeof worktree.denyGitCredentialsAccess === "boolean"
      ? worktree.denyGitCredentialsAccess
      : true;
  const client =
    worktree.provider === "claude"
      ? new ClaudeCliClient({
          cwd: worktree.path,
          attachmentsDir,
          repoDir,
          internetAccess,
          denyGitCredentialsAccess,
          gitDir,
          env: {
            ...process.env,
            ...(tmpDir
              ? { TMPDIR: tmpDir, CLAUDE_CODE_TMPDIR: tmpDir }
              : {}),
          },
          workspaceId: worktree.workspaceId,
          tmpDir,
          sessionId: worktree.sessionId,
          worktreeId: worktree.id,
        })
      : new CodexAppServerClient({
          cwd: worktree.path,
          attachmentsDir,
          repoDir,
          internetAccess,
          denyGitCredentialsAccess,
          gitDir,
          threadId: threadId || worktree.threadId || null,
          env: {
            ...process.env,
            ...(tmpDir ? { TMPDIR: tmpDir } : {}),
          },
          workspaceId: worktree.workspaceId,
          tmpDir,
          sessionId: worktree.sessionId,
          worktreeId: worktree.id,
        });

  return client;
}

/**
 * Get the currently active client for the session.
 *
 * @param {object} session - The session object
 * @returns {CodexAppServerClient | ClaudeCliClient | null}
 */
export function getActiveClient(session) {
  const runtime = getSessionRuntime(session.sessionId);
  return runtime?.clients?.[session.activeProvider] || null;
}

/**
 * Check if a provider string is valid.
 *
 * @param {string} provider
 * @returns {provider is "codex" | "claude"}
 */
export function isValidProvider(provider) {
  return provider === "codex" || provider === "claude";
}
