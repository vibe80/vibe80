import { CodexAppServerClient } from "./codexClient.js";
import { ClaudeCliClient } from "./claudeClient.js";

/**
 * Get an existing client or create a new one for the given provider.
 * Clients are lazily initialized and cached in session.clients.
 *
 * @param {object} session - The session object
 * @param {"codex" | "claude"} provider - The provider to get or create
 * @returns {Promise<CodexAppServerClient | ClaudeCliClient>}
 */
export async function getOrCreateClient(session, provider) {
  if (session.clients[provider]) {
    return session.clients[provider];
  }

  const client =
    provider === "claude"
      ? new ClaudeCliClient({
          cwd: session.repoDir,
          attachmentsDir: session.attachmentsDir,
          env: session.processOptions?.env,
          uid: session.processOptions?.uid,
          gid: session.processOptions?.gid,
        })
      : new CodexAppServerClient({
          cwd: session.repoDir,
          env: session.processOptions?.env,
          uid: session.processOptions?.uid,
          gid: session.processOptions?.gid,
        });

  session.clients[provider] = client;

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
export function createWorktreeClient(worktree, attachmentsDir) {
  const client =
    worktree.provider === "claude"
      ? new ClaudeCliClient({
          cwd: worktree.path,
          attachmentsDir,
          env: worktree.processOptions?.env,
          uid: worktree.processOptions?.uid,
          gid: worktree.processOptions?.gid,
        })
      : new CodexAppServerClient({
          cwd: worktree.path,
          env: worktree.processOptions?.env,
          uid: worktree.processOptions?.uid,
          gid: worktree.processOptions?.gid,
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
  return session.clients[session.activeProvider] || null;
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
