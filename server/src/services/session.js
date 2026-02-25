import path from "path";
import os from "os";
import fs from "fs";
import multer from "multer";
import { fileURLToPath } from "url";
import {
  runAsCommand,
  runAsCommandOutput,
  runAsCommandOutputWithStatus,
} from "../runAs.js";
import storage from "../storage/index.js";
import {
  generateId,
  generateSessionName,
  createMessageId,
  sanitizeFilename,
  getSessionTmpDir,
} from "../helpers.js";
import { debugApiWsLog } from "../middleware/debug.js";
import {
  VIBE80_DEFAULT_GIT_AUTHOR_NAME,
  VIBE80_DEFAULT_GIT_AUTHOR_EMAIL,
  GIT_HOOKS_DIR,
} from "../config.js";
import {
  getWorkspacePaths,
  getWorkspaceSshPaths,
  ensureWorkspaceDir,
  writeWorkspaceFile,
  appendWorkspaceFile,
  readWorkspaceConfig,
  listEnabledProviders,
  pickDefaultProvider,
  workspacePathExists,
  listWorkspaceEntries,
  getWorkspaceStat,
  readWorkspaceFileBuffer,
  writeWorkspaceFilePreserveMode,
  appendAuditLog,
  isMonoUser,
} from "./workspace.js";
import {
  getSessionRuntime,
  deleteSessionRuntime,
} from "../runtimeStore.js";
import {
  getWorktree,
  appendWorktreeMessage,
  clearWorktreeMessages,
  getWorktreeDiff,
  updateWorktreeStatus,
  updateWorktreeThreadId,
  getMainWorktreeStorageId,
} from "../worktreeManager.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parseSessionTtlSeconds = (value) => {
  if (value == null) {
    return 0;
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }
  return parsed;
};

const sessionGcIntervalMs =
  Number(process.env.VIBE80_SESSION_GC_INTERVAL_MS) || 5 * 60 * 1000;
const sessionIdleTtlMs =
  parseSessionTtlSeconds(process.env.VIBE80_SESSION_IDLE_TTL_SECONDS) * 1000;
const sessionMaxTtlMs =
  parseSessionTtlSeconds(process.env.VIBE80_SESSION_MAX_TTL_SECONDS) * 1000;
export const sessionIdPattern = /^s[0-9a-f]{24}$/;

const TREE_IGNORED_NAMES = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  "out",
  "worktrees",
  "attachments",
  ".cache",
  ".turbo",
  ".idea",
  ".vscode",
  "venv",
  ".venv",
]);
export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_WRITE_BYTES = 500 * 1024;

const modelCache = new Map();
const modelCacheTtlMs = 60 * 60 * 1000;
export { modelCache, modelCacheTtlMs };

export { sessionGcIntervalMs };

// ---------------------------------------------------------------------------
// Session env / command helpers
// ---------------------------------------------------------------------------

export const buildSessionEnv = (session, options = {}) => {
  const tmpDir = session?.dir ? getSessionTmpDir(session.dir) : null;
  const env = { ...(options.env || {}) };
  if (tmpDir) {
    env.TMPDIR = tmpDir;
  }
  return env;
};

export const runSessionCommand = (session, command, args, options = {}) =>
  runAsCommand(session.workspaceId, command, args, {
    ...options,
    env: buildSessionEnv(session, options),
  });

export const runSessionCommandOutput = (session, command, args, options = {}) =>
  runAsCommandOutput(session.workspaceId, command, args, {
    ...options,
    env: buildSessionEnv(session, options),
  });

export const runSessionCommandOutputWithStatus = (session, command, args, options = {}) =>
  runAsCommandOutputWithStatus(session.workspaceId, command, args, {
    ...options,
    env: buildSessionEnv(session, options),
  });

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export const touchSession = async (session) => {
  if (!session) return;
  const updated = { ...session, lastActivityAt: Date.now() };
  await storage.saveSession(session.sessionId, updated);
  return updated;
};

export const getSession = async (sessionId, workspaceId = null) => {
  if (!sessionId) {
    return null;
  }
  const session = await storage.getSession(sessionId);
  if (!session) {
    return null;
  }
  if (workspaceId && session.workspaceId !== workspaceId) {
    return null;
  }
  return session;
};

export const getSessionFromRequest = async (req) => {
  if (!req?.url) {
    return null;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session");
    return getSession(sessionId, req.workspaceId);
  } catch {
    return null;
  }
};

export const resolveDefaultDenyGitCredentialsAccess = (session) =>
  typeof session?.defaultDenyGitCredentialsAccess === "boolean"
    ? session.defaultDenyGitCredentialsAccess
    : true;

// ---------------------------------------------------------------------------
// Stop / cleanup
// ---------------------------------------------------------------------------

export const stopClient = async (client) => {
  if (!client) {
    return;
  }
  if (typeof client.stop === "function") {
    try {
      await client.stop();
      return;
    } catch {
      // fallthrough
    }
  }
  if (client.proc && typeof client.proc.kill === "function") {
    try {
      client.proc.kill();
    } catch {
      // ignore
    }
  }
};

export const cleanupSession = async (sessionId, reason) => {
  const session = await storage.getSession(sessionId);
  if (!session) {
    return;
  }
  const runtime = getSessionRuntime(sessionId);
  if (runtime?.sockets) {
    for (const socket of runtime.sockets) {
      try {
        socket.close();
      } catch {
        // ignore
      }
    }
  }
  if (runtime?.worktreeClients) {
    for (const client of runtime.worktreeClients.values()) {
      await stopClient(client);
    }
    runtime.worktreeClients.clear();
  }
  if (runtime?.clients) {
    for (const client of Object.values(runtime.clients || {})) {
      await stopClient(client);
    }
  }

  const worktrees = await storage.listWorktrees(sessionId);
  for (const worktree of worktrees) {
    if (worktree?.path) {
      await runAsCommand(session.workspaceId, "/bin/rm", ["-rf", worktree.path]).catch(() => {});
    }
  }

  if (session.dir) {
    await runAsCommand(session.workspaceId, "/bin/rm", ["-rf", session.dir]).catch(() => {});
  }
  if (session.sshKeyPath) {
    await runAsCommand(session.workspaceId, "/bin/rm", ["-f", session.sshKeyPath]).catch(() => {});
  }
  await storage.deleteSession(sessionId, session.workspaceId);
  deleteSessionRuntime(sessionId);
  await appendAuditLog(session.workspaceId, "session_removed", { sessionId, reason });
};

export const runSessionGc = async () => {
  const now = Date.now();
  const sessions = await storage.listSessions();
  for (const session of sessions) {
    if (!session?.sessionId) {
      continue;
    }
    const createdAt = session.createdAt || now;
    const lastActivity = session.lastActivityAt || createdAt;
    const expiredByIdle = sessionIdleTtlMs > 0 && now - lastActivity > sessionIdleTtlMs;
    const expiredByMax = sessionMaxTtlMs > 0 && now - createdAt > sessionMaxTtlMs;
    if (expiredByIdle || expiredByMax) {
      await cleanupSession(session.sessionId, expiredByIdle ? "idle_timeout" : "max_ttl");
    }
  }
};

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

const normalizeRemoteBranches = (output, remote) =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((ref) => !ref.endsWith("/HEAD"))
    .map((ref) =>
      ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref
    );

export const getCurrentBranch = async (session) => {
  const output = await runSessionCommandOutput(
    session,
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: session.repoDir }
  );
  const trimmed = output.trim();
  return trimmed === "HEAD" ? "" : trimmed;
};

export const getLastCommit = async (session, cwd) => {
  const output = await runSessionCommandOutput(
    session,
    "git",
    ["log", "-1", "--format=%H|%s"],
    { cwd }
  );
  const [sha, message] = output.trim().split("|");
  return { sha: sha || "", message: message || "" };
};

export const getBranchInfo = async (session, remote = "origin") => {
  await runSessionCommand(session, "git", ["fetch", "--prune"], {
    cwd: session.repoDir,
  });
  const [current, branchesOutput] = await Promise.all([
    getCurrentBranch(session),
    runSessionCommandOutput(
      session,
      "git",
      ["for-each-ref", "--format=%(refname:short)", `refs/remotes/${remote}`],
      { cwd: session.repoDir }
    ),
  ]);
  return {
    current,
    remote,
    branches: normalizeRemoteBranches(branchesOutput, remote).sort(),
  };
};

// ---------------------------------------------------------------------------
// Repo URL helpers (for createSession)
// ---------------------------------------------------------------------------

const resolveRepoHost = (repoUrl) => {
  if (repoUrl.startsWith("ssh://")) {
    try {
      return new URL(repoUrl).hostname;
    } catch {
      return null;
    }
  }
  const scpStyle = repoUrl.match(/^[^@]+@([^:]+):/);
  if (scpStyle) {
    return scpStyle[1];
  }
  return null;
};

const resolveHttpAuthInfo = (repoUrl) => {
  try {
    const url = new URL(repoUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return { protocol: url.protocol.replace(":", ""), host: url.host };
  } catch {
    return null;
  }
};

const ensureKnownHost = async (workspaceId, repoUrl, sshPaths) => {
  const host = resolveRepoHost(repoUrl);
  if (!host) {
    return;
  }
  const { sshDir, knownHostsPath } = sshPaths;
  await ensureWorkspaceDir(workspaceId, sshDir, 0o700);
  const output = await runAsCommandOutput(workspaceId, "/usr/bin/ssh-keyscan", ["-H", host]).catch(
    () => ""
  );
  if (output && output.trim()) {
    await appendWorkspaceFile(workspaceId, knownHostsPath, output, 0o600);
  }
};

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

export const createSession = async (
  workspaceId,
  repoUrl,
  auth,
  defaultInternetAccess,
  defaultDenyGitCredentialsAccess,
  name,
  { getOrCreateClient, attachClientEvents, attachClaudeEvents, broadcastToSession }
) => {
  const workspaceConfig = await readWorkspaceConfig(workspaceId);
  const enabledProviders = listEnabledProviders(workspaceConfig?.providers || {});
  const defaultProvider = pickDefaultProvider(enabledProviders);
  if (!defaultProvider) {
    throw new Error("No providers enabled for this workspace.");
  }
  const resolvedInternetAccess =
    typeof defaultInternetAccess === "boolean" ? defaultInternetAccess : true;
  const resolvedDenyGitCredentialsAccess =
    typeof defaultDenyGitCredentialsAccess === "boolean"
      ? defaultDenyGitCredentialsAccess
      : true;
  const resolvedShareGitCredentials = !resolvedDenyGitCredentialsAccess;
  const resolvedName = typeof name === "string" && name.trim()
    ? name.trim()
    : generateSessionName();
  const workspacePaths = getWorkspacePaths(workspaceId);
  const sshPaths = getWorkspaceSshPaths(workspacePaths.homeDir);
  while (true) {
    const sessionId = generateId("s");
    const dir = path.join(workspacePaths.sessionsDir, sessionId);
    let sessionRecord = null;
    let sessionSshKeyPath = null;
    try {
      await runAsCommand(workspaceId, "/bin/mkdir", [dir]);
      await runAsCommand(workspaceId, "/bin/chmod", ["2750", dir]);
      const attachmentsDir = path.join(dir, "attachments");
      await runAsCommand(workspaceId, "/bin/mkdir", ["-p", attachmentsDir]);
      await runAsCommand(workspaceId, "/bin/chmod", ["2750", attachmentsDir]);
      const tmpDir = getSessionTmpDir(dir);
      await runAsCommand(workspaceId, "/bin/mkdir", ["-p", tmpDir]);
      await runAsCommand(workspaceId, "/bin/chmod", ["2750", tmpDir]);
      const repoDir = path.join(dir, "repository");
      const gitCredsDir = path.join(dir, "git");
      const needsGitCredsDir =
        resolvedShareGitCredentials ||
        (auth?.type === "ssh" && auth.privateKey) ||
        (auth?.type === "http" && auth.username && auth.password);
      if (needsGitCredsDir) {
        await runAsCommand(workspaceId, "/bin/mkdir", ["-p", gitCredsDir]);
        await runAsCommand(workspaceId, "/bin/chmod", ["2750", gitCredsDir]);
      }
      const env = { TMPDIR: tmpDir };
      if (auth?.type === "ssh" && auth.privateKey) {
        await ensureWorkspaceDir(workspaceId, sshPaths.sshDir, 0o700);
        const keyPath = path.join(gitCredsDir, `ssh-key-${sessionId}`);
        const normalizedKey = `${auth.privateKey.trimEnd()}\n`;
        await writeWorkspaceFile(workspaceId, keyPath, normalizedKey, 0o600);
        sessionSshKeyPath = keyPath;
        await ensureKnownHost(workspaceId, repoUrl, sshPaths);
        env.GIT_SSH_COMMAND = `ssh -i "${keyPath}" -o IdentitiesOnly=yes -o UserKnownHostsFile="${sshPaths.knownHostsPath}"`;
      } else if (auth?.type === "http" && auth.username && auth.password) {
        const authInfo = resolveHttpAuthInfo(repoUrl);
        if (!authInfo) {
          throw new Error("Invalid HTTP repository URL for credential auth.");
        }
        const credFile = path.join(gitCredsDir, "git-credentials");
        const credInputPath = path.join(gitCredsDir, "git-credential-input");
        env.GIT_TERMINAL_PROMPT = "0";
        await writeWorkspaceFile(workspaceId, credFile, "", 0o600);
        const credentialPayload = [
          `protocol=${authInfo.protocol}`,
          `host=${authInfo.host}`,
          `username=${auth.username}`,
          `password=${auth.password}`,
          "",
          "",
        ].join("\n");
        await writeWorkspaceFile(workspaceId, credInputPath, credentialPayload, 0o600);
        await runAsCommand(
          workspaceId,
          "git",
          ["-c", `credential.helper=store --file ${credFile}`, "credential", "approve"],
          {
            env,
            input: credentialPayload,
          }
        );
        await runAsCommand(workspaceId, "/bin/rm", ["-f", credInputPath]);
      }
      const cloneArgs = ["clone", repoUrl, repoDir];
      const cloneEnv = { ...env };
      const cloneCmd = [];
      if (auth?.type === "http" && auth.username && auth.password) {
        cloneCmd.push(
          "-c",
          `credential.helper=store --file ${path.join(
            gitCredsDir,
            "git-credentials"
          )}`
        );
      }
      if (auth?.type === "ssh" && sessionSshKeyPath) {
        cloneCmd.push(
          "-c",
          `core.sshCommand="ssh -i ${sessionSshKeyPath} -o IdentitiesOnly=yes"`
        );
      }
      cloneCmd.push(...cloneArgs);
      await runAsCommand(workspaceId, "git", cloneCmd, { env: cloneEnv });
      if (auth?.type === "ssh" && sessionSshKeyPath) {
        await runAsCommand(
          workspaceId,
          "git",
          [
            "config",
            "core.sshCommand",
            `ssh -i ${sessionSshKeyPath} -o IdentitiesOnly=yes`,
          ],
          { cwd: repoDir }
        );
      }
      if (VIBE80_DEFAULT_GIT_AUTHOR_NAME && VIBE80_DEFAULT_GIT_AUTHOR_EMAIL) {
        await runAsCommand(
          workspaceId,
          "git",
          ["-C", repoDir, "config", "user.name", VIBE80_DEFAULT_GIT_AUTHOR_NAME],
          { env }
        );
        await runAsCommand(
          workspaceId,
          "git",
          ["-C", repoDir, "config", "user.email", VIBE80_DEFAULT_GIT_AUTHOR_EMAIL],
          { env }
        );
      }
      if (auth?.type === "http" && auth.username && auth.password) {
        await runAsCommand(
          workspaceId,
          "git",
          [
            "-C",
            repoDir,
            "config",
            "--add",
            "credential.helper",
            `store --file ${path.join(gitCredsDir, "git-credentials")}`,
          ],
          { env }
        );
      }
      await runAsCommand(
        workspaceId,
        "git",
        ["-C", repoDir, "config", "core.hooksPath", GIT_HOOKS_DIR],
        { env }
      );
      await runAsCommand(
        workspaceId,
        "git",
        ["-C", repoDir, "config", "extensions.worktreeConfig", "true"],
        { env }
      );
      await runAsCommand(
        workspaceId,
        "git",
        ["-C", repoDir, "config", "--worktree", "vibe80.workspaceId", workspaceId],
        { env }
      );
      await runAsCommand(
        workspaceId,
        "git",
        ["-C", repoDir, "config", "--worktree", "vibe80.sessionId", sessionId],
        { env }
      );
      await runAsCommand(
        workspaceId,
        "git",
        ["-C", repoDir, "config", "--worktree", "vibe80.worktreeId", "main"],
        { env }
      );
      const session = {
        sessionId,
        workspaceId,
        dir,
        attachmentsDir,
        repoDir,
        repoUrl,
        name: resolvedName,
        activeProvider: defaultProvider,
        defaultInternetAccess: resolvedInternetAccess,
        defaultDenyGitCredentialsAccess: resolvedDenyGitCredentialsAccess,
        gitDir: gitCredsDir,
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
        sshKeyPath: sessionSshKeyPath,
        rpcLogs: [],
        threadId: null,
      };
      await storage.saveSession(sessionId, session);
      sessionRecord = session;
      await getWorktree(session, "main");
      await appendAuditLog(workspaceId, "session_created", { sessionId, repoUrl });

      const client = await getOrCreateClient(session, defaultProvider);
      if (defaultProvider === "claude") {
        attachClaudeEvents(sessionId, client, defaultProvider);
      } else {
        attachClientEvents(sessionId, client, defaultProvider);
      }
      client.start().catch((error) => {
        const label = defaultProvider === "claude" ? "Claude CLI" : "Codex app-server";
        console.error(`Failed to start ${label}:`, error);
        broadcastToSession(sessionId, {
          type: "error",
          message: `${label} failed to start.`,
        });
      });
      return { sessionId, dir };
    } catch (error) {
      console.error("Session creation failed:", {
        repoUrl,
        sessionDir: dir,
        error: error?.message || error,
      });
      if (sessionRecord) {
        await storage.deleteSession(sessionId, sessionRecord.workspaceId);
      }
      if (sessionSshKeyPath) {
        await runAsCommand(workspaceId, "/bin/rm", ["-f", sessionSshKeyPath]).catch(() => {});
      }
      await runAsCommand(workspaceId, "/bin/rm", ["-rf", dir]).catch(() => {});
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

export const appendMainMessage = async (session, message) => {
  if (!session) {
    return;
  }
  await appendWorktreeMessage(session, "main", message);
};

export const getWorktreeMessages = async (
  session,
  worktreeId,
  { limit = null, beforeMessageId = null } = {}
) => {
  if (!session) {
    return [];
  }
  const resolvedId =
    worktreeId === "main" ? getMainWorktreeStorageId(session.sessionId) : worktreeId;
  await getWorktree(session, worktreeId);
  return storage.getWorktreeMessages(session.sessionId, resolvedId, {
    limit,
    beforeMessageId,
  });
};

export const appendRpcLog = async (sessionId, entry) => {
  if (!debugApiWsLog) {
    return;
  }
  const session = await getSession(sessionId);
  if (!session) {
    return;
  }
  const rpcLogs = Array.isArray(session.rpcLogs) ? [...session.rpcLogs, entry] : [entry];
  if (rpcLogs.length > 500) {
    rpcLogs.splice(0, rpcLogs.length - 500);
  }
  const updated = { ...session, rpcLogs, lastActivityAt: Date.now() };
  await storage.saveSession(sessionId, updated);
};

// ---------------------------------------------------------------------------
// Broadcast helpers
// ---------------------------------------------------------------------------

export function broadcastToSession(sessionId, payload) {
  const runtime = getSessionRuntime(sessionId);
  if (!runtime) {
    return;
  }
  const message = JSON.stringify(payload);
  for (const socket of runtime.sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

const repoDiffTimers = new Map();
const repoDiffInFlight = new Set();
const repoDiffDebounceMs = 500;

export const broadcastRepoDiff = async (sessionId) => {
  if (!sessionId) {
    return;
  }
  if (repoDiffInFlight.has(sessionId)) {
    if (!repoDiffTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        repoDiffTimers.delete(sessionId);
        void broadcastRepoDiff(sessionId);
      }, repoDiffDebounceMs);
      repoDiffTimers.set(sessionId, timer);
    }
    return;
  }
  const existingTimer = repoDiffTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    repoDiffTimers.delete(sessionId);
  }
  repoDiffInFlight.add(sessionId);
  const session = await getSession(sessionId);
  if (!session) {
    repoDiffInFlight.delete(sessionId);
    return;
  }
  try {
    const [status, diff] = await Promise.all([
      runSessionCommandOutput(session, "git", ["status", "--porcelain"], {
        cwd: session.repoDir,
      }),
      runSessionCommandOutput(session, "git", ["diff"], { cwd: session.repoDir }),
    ]);
    broadcastToSession(sessionId, {
      type: "repo_diff",
      status,
      diff,
    });
  } catch (error) {
    console.error("Failed to compute repo diff:", {
      sessionId,
      error: error?.message || error,
    });
  } finally {
    repoDiffInFlight.delete(sessionId);
    if (repoDiffTimers.has(sessionId)) {
      const timer = setTimeout(() => {
        repoDiffTimers.delete(sessionId);
        void broadcastRepoDiff(sessionId);
      }, repoDiffDebounceMs);
      repoDiffTimers.set(sessionId, timer);
    }
  }
};

export const getRepoDiff = async (session) => {
  if (!session?.repoDir) {
    return { status: "", diff: "" };
  }
  try {
    const [status, diff] = await Promise.all([
      runSessionCommandOutput(session, "git", ["status", "--porcelain"], {
        cwd: session.repoDir,
      }),
      runSessionCommandOutput(session, "git", ["diff"], { cwd: session.repoDir }),
    ]);
    return { status, diff };
  } catch (error) {
    console.error("Failed to load repo diff:", {
      sessionId: session?.sessionId,
      error: error?.message || error,
    });
    return { status: "", diff: "" };
  }
};

export const broadcastWorktreeDiff = async (sessionId, worktreeId) => {
  const session = await getSession(sessionId);
  if (!session) return;

  try {
    const diff = await getWorktreeDiff(session, worktreeId);
    broadcastToSession(sessionId, {
      type: "worktree_diff",
      worktreeId,
      ...diff,
    });
  } catch (error) {
    console.error("Failed to compute worktree diff:", {
      sessionId,
      worktreeId,
      error: error?.message || error,
    });
  }
};

export const getProviderLabel = (session) =>
  session?.activeProvider === "claude" ? "Claude CLI" : "Codex app-server";

export const isValidProvider = (p) => p === "codex" || p === "claude";

// ---------------------------------------------------------------------------
// Directory browsing
// ---------------------------------------------------------------------------

export const resolveWorktreeRoot = async (session, worktreeId) => {
  if (!session) {
    return { rootPath: null, worktree: null };
  }
  if (!worktreeId || worktreeId === "main") {
    return { rootPath: session.repoDir, worktree: null };
  }
  const worktree = await getWorktree(session, worktreeId);
  if (!worktree) {
    return { rootPath: null, worktree: null };
  }
  return { rootPath: worktree.path, worktree };
};

export const listDirectoryEntries = async (
  workspaceId,
  rootPath,
  relativePath = ""
) => {
  const normalized = (relativePath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
  const absPath = path.resolve(rootPath, normalized || ".");
  const relative = path.relative(rootPath, absPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Invalid path.");
  }
  const stat = await getWorkspaceStat(workspaceId, absPath);
  if (!stat?.type || stat.type !== "directory") {
    throw new Error("Path is not a directory.");
  }
  const entries = await listWorkspaceEntries(workspaceId, absPath);
  const visible = entries.filter((entry) => !TREE_IGNORED_NAMES.has(entry.name));
  visible.sort((a, b) => {
    const aIsDir = a.type === "d";
    const bIsDir = b.type === "d";
    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;
    return a.name.localeCompare(b.name);
  });
  const nodes = visible.map((entry) => {
    const entryPath = normalized ? `${normalized}/${entry.name}` : entry.name;
    if (entry.type === "d") {
      return {
        name: entry.name,
        path: entryPath,
        type: "dir",
        children: null,
      };
    }
    return {
      name: entry.name,
      path: entryPath,
      type: "file",
    };
  });
  return { entries: nodes, path: normalized || "" };
};

export const ensureUniqueFilename = async (workspaceId, dir, filename, reserved) => {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension);
  let candidate = filename;
  let counter = 1;
  while (true) {
    if (reserved?.has(candidate)) {
      candidate = `${base}-${counter}${extension}`;
      counter += 1;
      continue;
    }
    if (reserved) {
      reserved.add(candidate);
    }
    const exists = await workspacePathExists(workspaceId, path.join(dir, candidate));
    if (exists) {
      candidate = `${base}-${counter}${extension}`;
      counter += 1;
      continue;
    }
    return candidate;
  }
};

// ---------------------------------------------------------------------------
// Multer upload instance
// ---------------------------------------------------------------------------

const uploadTempDir = path.join(os.tmpdir(), "vibe80_uploads");
fs.mkdirSync(uploadTempDir, { recursive: true, mode: 0o700 });

export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const sessionId = req.params?.sessionId || req.query.session;
      getSession(sessionId, req.workspaceId)
        .then((session) => {
          if (!session) {
            cb(new Error("Invalid session."));
            return;
          }
          cb(null, uploadTempDir);
        })
        .catch((error) => cb(error));
    },
    filename: (req, file, cb) => {
      const sessionId = req.params?.sessionId || req.query.session;
      getSession(sessionId, req.workspaceId)
        .then(async (session) => {
          if (!session) {
            cb(new Error("Invalid session."));
            return;
          }
          try {
            const safeName = sanitizeFilename(file.originalname);
            const reserved =
              req._reservedFilenames || (req._reservedFilenames = new Set());
            const uniqueName = await ensureUniqueFilename(
              session.workspaceId,
              session.attachmentsDir,
              safeName,
              reserved
            );
            cb(null, uniqueName);
          } catch (error) {
            cb(error);
          }
        })
        .catch((error) => cb(error));
    },
  }),
  limits: { files: 20, fileSize: 50 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Re-exports needed by routes
// ---------------------------------------------------------------------------

export {
  getWorktree,
  clearWorktreeMessages,
  getWorktreeDiff,
  updateWorktreeStatus,
  updateWorktreeThreadId,
  readWorkspaceFileBuffer,
  writeWorkspaceFilePreserveMode,
};
