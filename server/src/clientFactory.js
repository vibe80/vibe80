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
        })
      : new CodexAppServerClient({ cwd: session.repoDir });

  session.clients[provider] = client;

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
