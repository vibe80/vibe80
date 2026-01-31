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

  const client =
    provider === "claude"
      ? new ClaudeCliClient({
          cwd: session.repoDir,
          attachmentsDir: session.attachmentsDir,
          repoDir: session.repoDir,
          env: process.env,
          workspaceId: session.workspaceId,
        })
      : new CodexAppServerClient({
          cwd: session.repoDir,
          attachmentsDir: session.attachmentsDir,
          repoDir: session.repoDir,
          env: process.env,
          workspaceId: session.workspaceId,
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
  internetAccess
) {
  const client =
    worktree.provider === "claude"
      ? new ClaudeCliClient({
          cwd: worktree.path,
          attachmentsDir,
          repoDir,
          internetAccess,
          env: process.env,
          workspaceId: worktree.workspaceId,
        })
      : new CodexAppServerClient({
          cwd: worktree.path,
          attachmentsDir,
          repoDir,
          internetAccess,
          env: process.env,
          workspaceId: worktree.workspaceId,
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
