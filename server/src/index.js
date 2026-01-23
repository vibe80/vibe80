import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import * as pty from "node-pty";
import { CodexAppServerClient } from "./codexClient.js";
import { ClaudeCliClient } from "./claudeClient.js";
import {
  getOrCreateClient,
  getActiveClient,
  isValidProvider,
} from "./clientFactory.js";
import {
  createWorktree,
  removeWorktree,
  getWorktreeDiff,
  getWorktreeCommits,
  mergeWorktree,
  abortMerge,
  cherryPickCommit,
  listWorktrees,
  getWorktree,
  updateWorktreeStatus,
  appendWorktreeMessage,
  clearWorktreeMessages,
  renameWorktree,
} from "./worktreeManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const terminalWss = new WebSocketServer({ noServer: true });

const cwd = process.cwd();
const sessions = new Map();
const homeDir = process.env.HOME_DIR || os.homedir();
const sshDir = path.join(homeDir, ".ssh");
const knownHostsPath = path.join(sshDir, "known_hosts");
const sshConfigPath = path.join(sshDir, "config");
const codexConfigDir = path.join(homeDir, ".codex");
const codexAuthPath = path.join(codexConfigDir, "auth.json");
const claudeConfigDir = path.join(homeDir, ".claude");
const claudeCredPath = path.join(claudeConfigDir, ".credentials.json");

app.use(express.json());

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });

const runCommandOutput = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });

const normalizeRemoteBranches = (output, remote) =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((ref) => !ref.endsWith("/HEAD"))
    .map((ref) =>
      ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref
    );

const getCurrentBranch = async (repoDir) => {
  const output = await runCommandOutput("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoDir,
  });
  const trimmed = output.trim();
  return trimmed === "HEAD" ? "" : trimmed;
};

const getBranchInfo = async (session, remote = "origin") => {
  await runCommand("git", ["fetch", "--prune"], { cwd: session.repoDir });
  const [current, branchesOutput] = await Promise.all([
    getCurrentBranch(session.repoDir),
    runCommandOutput(
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

const createMessageId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

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

const ensureKnownHost = async (repoUrl) => {
  const host = resolveRepoHost(repoUrl);
  if (!host) {
    return;
  }
  await runCommand("sh", [
    "-c",
    `mkdir -p "${sshDir}" && ssh-keyscan -H ${host} >> "${knownHostsPath}" 2>/dev/null || true`,
  ]);
};

const ensureSshConfigEntry = async (host, keyPath) => {
  if (!host) {
    return;
  }
  const keyPathConfig = `~/.ssh/${path.basename(keyPath)}`;
  let existing = "";
  try {
    existing = await fs.promises.readFile(sshConfigPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  const entry = `Host ${host}\n  IdentityFile ${keyPathConfig}\n`;
  if (existing.includes(entry)) {
    return;
  }
  const nextContent = existing ? `${existing.trimEnd()}\n\n${entry}` : entry;
  await fs.promises.writeFile(sshConfigPath, nextContent, { mode: 0o600 });
  await fs.promises.chmod(sshConfigPath, 0o600).catch(() => {});
};

const createSession = async (repoUrl, auth, provider = "codex", providers = null) => {
  while (true) {
    const sessionId = crypto.randomBytes(12).toString("hex");
    const dir = path.join(os.tmpdir(), sessionId);
    let sessionRecord = null;
    let sessionSshKeyPath = null;
    try {
      await fs.promises.mkdir(dir, { recursive: false });
      const attachmentsDir = path.join(dir, "attachments");
      await fs.promises.mkdir(attachmentsDir, { recursive: true });
      const repoDir = path.join(dir, "repository");
      const env = { ...process.env };
      if (auth?.type === "ssh" && auth.privateKey) {
        await fs.promises.mkdir(sshDir, { recursive: true, mode: 0o700 });
        await fs.promises.chmod(sshDir, 0o700).catch(() => {});
        const keyPath = path.join(sshDir, `codex_session_${sessionId}`);
        const normalizedKey = `${auth.privateKey.trimEnd()}\n`;
        await fs.promises.writeFile(keyPath, normalizedKey, { mode: 0o600 });
        await fs.promises.chmod(keyPath, 0o600).catch(() => {});
        sessionSshKeyPath = keyPath;
        const sshHost = resolveRepoHost(repoUrl);
        await ensureSshConfigEntry(sshHost, keyPath);
        await ensureKnownHost(repoUrl);
        env.GIT_SSH_COMMAND = `ssh -o IdentitiesOnly=yes -o UserKnownHostsFile="${knownHostsPath}"`;
      } else if (auth?.type === "http" && auth.username && auth.password) {
        const authInfo = resolveHttpAuthInfo(repoUrl);
        if (!authInfo) {
          throw new Error("Invalid HTTP repository URL for credential auth.");
        }
        const gitConfigPath = path.join(dir, "gitconfig");
        const credFile = path.join(dir, "git-credentials");
        const credInputPath = path.join(dir, "git-credential-input");
        env.GIT_CONFIG_GLOBAL = gitConfigPath;
        env.GIT_TERMINAL_PROMPT = "0";
        await fs.promises.writeFile(credFile, "", { mode: 0o600 });
        await fs.promises.chmod(credFile, 0o600).catch(() => {});
        await runCommand(
          "git",
          ["config", "--global", "credential.helper", "cache --timeout=43200"],
          { env }
        );
        await runCommand(
          "git",
          ["config", "--global", "--add", "credential.helper", `store --file ${credFile}`],
          { env }
        );
        const credentialPayload = [
          `protocol=${authInfo.protocol}`,
          `host=${authInfo.host}`,
          `username=${auth.username}`,
          `password=${auth.password}`,
          "",
          "",
        ].join("\n");
        await fs.promises.writeFile(credInputPath, credentialPayload, { mode: 0o600 });
        await fs.promises.chmod(credInputPath, 0o600).catch(() => {});
        await runCommand("sh", ["-c", `git credential approve < "${credInputPath}"`], {
          env,
        });
        await fs.promises.rm(credInputPath, { force: true });
      }
      await runCommand("git", ["clone", repoUrl, repoDir], { env });
      if (auth?.type === "http" && auth.username && auth.password) {
        await runCommand(
          "git",
          ["-C", repoDir, "config", "--add", "credential.helper", "cache --timeout=43200"],
          { env }
        );
        await runCommand(
          "git",
          ["-C", repoDir, "config", "--add", "credential.helper", "store --file ../git-credentials"],
          { env }
        );
      }
      const normalizedProviders = Array.isArray(providers)
        ? providers.filter((entry) => isValidProvider(entry))
        : [];
      if (!normalizedProviders.includes(provider)) {
        normalizedProviders.unshift(provider);
      }
      // Initialize session with multi-client structure
      const session = {
        dir,
        attachmentsDir,
        repoDir,
        repoUrl,
        activeProvider: provider,
        providers: normalizedProviders,
        clients: {
          codex: null,
          claude: null,
        },
        sockets: new Set(),
        messagesByProvider: {
          codex: [],
          claude: [],
        },
        messages: [],
        rpcLogs: [],
      };
      session.messages = session.messagesByProvider[provider];
      sessions.set(sessionId, session);
      sessionRecord = session;

      // Create and start the initial provider client
      const client = await getOrCreateClient(session, provider);
      if (provider === "claude") {
        attachClaudeEvents(sessionId, client, provider);
      } else {
        attachClientEvents(sessionId, client, provider);
      }
      client.start().catch((error) => {
        const label = provider === "claude" ? "Claude CLI" : "Codex app-server";
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
        sessions.delete(sessionId);
      }
      if (sessionSshKeyPath) {
        await fs.promises.rm(sessionSshKeyPath, { force: true });
      }
      await fs.promises.rm(dir, { recursive: true, force: true });
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
};

const getSession = (sessionId) =>
  sessionId ? sessions.get(sessionId) || null : null;

const getSessionFromRequest = (req) => {
  if (!req?.url) {
    return null;
  }
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get("session");
    return getSession(sessionId);
  } catch {
    return null;
  }
};

const sanitizeFilename = (originalName) =>
  path.basename(originalName || "attachment");

const appendSessionMessage = (sessionId, message) => {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }
  const provider = message?.provider || session.activeProvider || "codex";
  if (!session.messagesByProvider) {
    session.messagesByProvider = {};
    if (Array.isArray(session.messages) && session.messages.length > 0) {
      session.messagesByProvider[session.activeProvider || "codex"] =
        session.messages;
    }
  }
  if (!Array.isArray(session.messagesByProvider[provider])) {
    session.messagesByProvider[provider] = [];
  }
  session.messagesByProvider[provider].push(message);
  if (session.activeProvider === provider) {
    session.messages = session.messagesByProvider[provider];
  }
};

const getMessagesSince = (session, provider, lastSeenMessageId) => {
  const messages =
    session?.messagesByProvider?.[provider] || session?.messages || [];
  if (!lastSeenMessageId) {
    return messages;
  }
  const index = messages.findIndex((message) => message?.id === lastSeenMessageId);
  if (index === -1) {
    return messages;
  }
  return messages.slice(index + 1);
};

const appendRpcLog = (sessionId, entry) => {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }
  session.rpcLogs.push(entry);
  if (session.rpcLogs.length > 500) {
    session.rpcLogs.splice(0, session.rpcLogs.length - 500);
  }
};

const broadcastRepoDiff = async (sessionId) => {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }
  try {
    const [status, diff] = await Promise.all([
      runCommandOutput("git", ["status", "--porcelain"], { cwd: session.repoDir }),
      runCommandOutput("git", ["diff"], { cwd: session.repoDir }),
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
  }
};

const getRepoDiff = async (session) => {
  if (!session?.repoDir) {
    return { status: "", diff: "" };
  }
  try {
    const [status, diff] = await Promise.all([
      runCommandOutput("git", ["status", "--porcelain"], { cwd: session.repoDir }),
      runCommandOutput("git", ["diff"], { cwd: session.repoDir }),
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

const ensureUniqueFilename = async (dir, filename, reserved) => {
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
    try {
      if (reserved) {
        reserved.add(candidate);
      }
      await fs.promises.access(path.join(dir, candidate));
      candidate = `${base}-${counter}${extension}`;
      counter += 1;
    } catch (error) {
      if (error.code === "ENOENT") {
        return candidate;
      }
      if (reserved) {
        reserved.delete(candidate);
      }
      throw error;
    }
  }
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const sessionId = req.query.session;
      const session = getSession(sessionId);
      if (!session) {
        cb(new Error("Invalid session."));
        return;
      }
      cb(null, session.attachmentsDir);
    },
    filename: async (req, file, cb) => {
      const sessionId = req.query.session;
      const session = getSession(sessionId);
      if (!session) {
        cb(new Error("Invalid session."));
        return;
      }
      try {
        const safeName = sanitizeFilename(file.originalname);
        const reserved =
          req._reservedFilenames || (req._reservedFilenames = new Set());
        const uniqueName = await ensureUniqueFilename(
          session.attachmentsDir,
          safeName,
          reserved
        );
        cb(null, uniqueName);
      } catch (error) {
        cb(error);
      }
    },
  }),
  limits: { files: 20, fileSize: 50 * 1024 * 1024 },
});
const authUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 2 * 1024 * 1024 },
});

const getProviderLabel = (session) =>
  session?.activeProvider === "claude" ? "Claude CLI" : "Codex app-server";

function broadcastToSession(sessionId, payload) {
  const session = getSession(sessionId);
  if (!session) {
    return;
  }
  const message = JSON.stringify(payload);
  for (const socket of session.sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

function attachClientEvents(sessionId, client, provider) {
  const session = getSession(sessionId);

  client.on("ready", ({ threadId }) => {
    // Only broadcast if this is the active provider
    if (session?.activeProvider === provider) {
      broadcastToSession(sessionId, { type: "ready", threadId, provider });
    }
  });

  client.on("log", (message) => {
    if (message) {
      console.log(`[codex:${sessionId}] ${message}`);
    }
  });

  client.on("exit", ({ code, signal }) => {
    if (session?.activeProvider === provider) {
      broadcastToSession(sessionId, {
        type: "error",
        message: "Codex app-server stopped.",
      });
    }
    console.error("Codex app-server stopped.", { code, signal, sessionId });
  });

  client.on("notification", (message) => {
    // Ignore notifications from inactive provider
    if (session?.activeProvider !== provider) {
      return;
    }

    switch (message.method) {
      case "item/agentMessage/delta": {
        const { delta, itemId, turnId } = message.params;
        broadcastToSession(sessionId, {
          type: "assistant_delta",
          delta,
          itemId,
          turnId,
          provider,
        });
        break;
      }
      case "item/commandExecution/outputDelta": {
        const { delta, itemId, turnId, threadId } = message.params;
        broadcastToSession(sessionId, {
          type: "command_execution_delta",
          delta,
          itemId,
          turnId,
          threadId,
          provider,
        });
        break;
      }
      case "item/completed": {
        const { item, turnId } = message.params;
        if (item?.type === "agentMessage") {
          appendSessionMessage(sessionId, {
            id: item.id,
            role: "assistant",
            text: item.text,
            provider,
          });
          broadcastToSession(sessionId, {
            type: "assistant_message",
            text: item.text,
            itemId: item.id,
            turnId,
            provider,
          });
          void broadcastRepoDiff(sessionId);
        }
        if (item?.type === "commandExecution") {
          appendSessionMessage(sessionId, {
            id: item.id,
            role: "tool_result",
            text: item.aggregatedOutput || "",
            provider,
            toolResult: {
              callId: item.id,
              name: item.command || "command",
              output: item.aggregatedOutput || "",
              success: item.status === "completed",
            },
          });
          broadcastToSession(sessionId, {
            type: "command_execution_completed",
            item,
            itemId: item.id,
            turnId,
            provider,
          });
        }
        break;
      }
      case "turn/completed": {
        const { turn, threadId } = message.params;
        broadcastToSession(sessionId, {
          type: "turn_completed",
          threadId,
          turnId: turn.id,
          status: turn.status,
          error: turn.error?.message || null,
          provider,
        });
        break;
      }
      case "turn/started": {
        const { turn, threadId } = message.params;
        broadcastToSession(sessionId, {
          type: "turn_started",
          threadId,
          turnId: turn.id,
          status: turn.status,
          provider,
        });
        break;
      }
      case "item/started": {
        const { item, turnId, threadId } = message.params;
        broadcastToSession(sessionId, {
          type: "item_started",
          threadId,
          turnId,
          item,
          provider,
        });
        break;
      }
      case "error": {
        const { error, threadId, turnId, willRetry } = message.params;
        broadcastToSession(sessionId, {
          type: "turn_error",
          threadId,
          turnId,
          willRetry,
          message: error?.message || "Unknown error",
          provider,
        });
        break;
      }
      case "account/login/completed": {
        const { success, error, loginId } = message.params;
        broadcastToSession(sessionId, {
          type: "account_login_completed",
          success: Boolean(success),
          error: error || null,
          loginId: loginId || null,
          provider,
        });
        break;
      }
      default:
        break;
    }
  });

  client.on("rpc_out", (payload) => {
    const entry = {
      direction: "stdin",
      timestamp: Date.now(),
      payload,
      provider,
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
  });

  client.on("rpc_in", (payload) => {
    const entry = {
      direction: "stdout",
      timestamp: Date.now(),
      payload,
      provider,
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
  });
}

// Broadcast diff for a specific worktree
const broadcastWorktreeDiff = async (sessionId, worktreeId) => {
  const session = getSession(sessionId);
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

// Attach events to a Codex client for a worktree
function attachClientEventsForWorktree(sessionId, worktree) {
  const session = getSession(sessionId);
  const client = worktree.client;
  const worktreeId = worktree.id;
  const provider = worktree.provider;

  client.on("ready", ({ threadId }) => {
    updateWorktreeStatus(session, worktreeId, "ready");
    broadcastToSession(sessionId, {
      type: "worktree_ready",
      worktreeId,
      threadId,
      provider,
    });
  });

  client.on("log", (message) => {
    if (message) {
      console.log(`[codex:${sessionId}:wt-${worktreeId}] ${message}`);
    }
  });

  client.on("exit", ({ code, signal }) => {
    updateWorktreeStatus(session, worktreeId, "error");
    broadcastToSession(sessionId, {
      type: "worktree_status",
      worktreeId,
      status: "error",
      error: "Codex app-server stopped.",
    });
    console.error("Worktree Codex app-server stopped.", { code, signal, sessionId, worktreeId });
  });

  client.on("notification", (message) => {
    switch (message.method) {
      case "item/agentMessage/delta": {
        const { delta, itemId, turnId } = message.params;
        broadcastToSession(sessionId, {
          type: "assistant_delta",
          worktreeId,
          delta,
          itemId,
          turnId,
          provider,
        });
        break;
      }
      case "item/commandExecution/outputDelta": {
        const { delta, itemId, turnId, threadId } = message.params;
        broadcastToSession(sessionId, {
          type: "command_execution_delta",
          worktreeId,
          delta,
          itemId,
          turnId,
          threadId,
          provider,
        });
        break;
      }
      case "item/completed": {
        const { item, turnId } = message.params;
        if (item?.type === "agentMessage") {
          appendWorktreeMessage(session, worktreeId, {
            id: item.id,
            role: "assistant",
            text: item.text,
            provider,
          });
          broadcastToSession(sessionId, {
            type: "assistant_message",
            worktreeId,
            text: item.text,
            itemId: item.id,
            turnId,
            provider,
          });
          void broadcastWorktreeDiff(sessionId, worktreeId);
        }
        if (item?.type === "commandExecution") {
          appendWorktreeMessage(session, worktreeId, {
            id: item.id,
            role: "tool_result",
            text: item.aggregatedOutput || "",
            provider,
            toolResult: {
              callId: item.id,
              name: item.command || "command",
              output: item.aggregatedOutput || "",
              success: item.status === "completed",
            },
          });
          broadcastToSession(sessionId, {
            type: "command_execution_completed",
            worktreeId,
            item,
            itemId: item.id,
            turnId,
            provider,
          });
        }
        break;
      }
      case "turn/completed": {
        const { turn, threadId } = message.params;
        updateWorktreeStatus(session, worktreeId, "ready");
        broadcastToSession(sessionId, {
          type: "turn_completed",
          worktreeId,
          threadId,
          turnId: turn.id,
          status: turn.status,
          error: turn.error?.message || null,
          provider,
        });
        break;
      }
      case "turn/started": {
        const { turn, threadId } = message.params;
        updateWorktreeStatus(session, worktreeId, "processing");
        broadcastToSession(sessionId, {
          type: "turn_started",
          worktreeId,
          threadId,
          turnId: turn.id,
          status: turn.status,
          provider,
        });
        break;
      }
      case "item/started": {
        const { item, turnId, threadId } = message.params;
        broadcastToSession(sessionId, {
          type: "item_started",
          worktreeId,
          threadId,
          turnId,
          item,
          provider,
        });
        break;
      }
      case "error": {
        const { error, threadId, turnId, willRetry } = message.params;
        broadcastToSession(sessionId, {
          type: "turn_error",
          worktreeId,
          threadId,
          turnId,
          willRetry,
          message: error?.message || "Unknown error",
          provider,
        });
        break;
      }
      default:
        break;
    }
  });

  client.on("rpc_out", (payload) => {
    const entry = {
      direction: "stdin",
      timestamp: Date.now(),
      payload,
      provider,
      worktreeId,
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
  });

  client.on("rpc_in", (payload) => {
    const entry = {
      direction: "stdout",
      timestamp: Date.now(),
      payload,
      provider,
      worktreeId,
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
  });
}

// Attach events to a Claude client for a worktree
function attachClaudeEventsForWorktree(sessionId, worktree) {
  const session = getSession(sessionId);
  const client = worktree.client;
  const worktreeId = worktree.id;
  const provider = worktree.provider;

  client.on("ready", ({ threadId }) => {
    updateWorktreeStatus(session, worktreeId, "ready");
    broadcastToSession(sessionId, {
      type: "worktree_ready",
      worktreeId,
      threadId,
      provider,
    });
  });

  client.on("log", (message) => {
    if (message) {
      console.log(`[claude:${sessionId}:wt-${worktreeId}] ${message}`);
    }
  });

  client.on("stdout_json", ({ message }) => {
    const entry = {
      direction: "stdout",
      timestamp: Date.now(),
      payload: message,
      provider,
      worktreeId,
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
  });

  client.on("assistant_message", ({ id, text, turnId }) => {
    appendWorktreeMessage(session, worktreeId, { id, role: "assistant", text, provider });
    broadcastToSession(sessionId, {
      type: "assistant_message",
      worktreeId,
      text,
      itemId: id,
      turnId,
      provider,
    });
    void broadcastWorktreeDiff(sessionId, worktreeId);
  });

  client.on("command_execution_completed", (payload) => {
    appendWorktreeMessage(session, worktreeId, {
      id: payload.itemId,
      role: "tool_result",
      text: payload.item?.aggregatedOutput || "",
      provider,
      toolResult: {
        callId: payload.itemId,
        name: payload.item?.command || "tool",
        output: payload.item?.aggregatedOutput || "",
        success: payload.item?.status === "completed",
      },
    });
    broadcastToSession(sessionId, {
      type: "command_execution_completed",
      worktreeId,
      item: payload.item,
      itemId: payload.itemId,
      turnId: payload.turnId,
      provider,
    });
  });

  client.on("turn_completed", ({ turnId, status }) => {
    updateWorktreeStatus(session, worktreeId, "ready");
    broadcastToSession(sessionId, {
      type: "turn_completed",
      worktreeId,
      turnId,
      status: status || "success",
      error: null,
      provider,
    });
  });

  client.on("turn_error", ({ turnId, message }) => {
    broadcastToSession(sessionId, {
      type: "turn_error",
      worktreeId,
      turnId,
      message: message || "Claude CLI error.",
      provider,
    });
  });
}

function attachClaudeEvents(sessionId, client, provider) {
  const session = getSession(sessionId);

  client.on("ready", ({ threadId }) => {
    if (session?.activeProvider === provider) {
      broadcastToSession(sessionId, { type: "ready", threadId, provider });
    }
  });

  client.on("log", (message) => {
    if (message) {
      console.log(`[claude:${sessionId}] ${message}`);
    }
  });

  client.on("stdout_json", ({ message }) => {
    const entry = {
      direction: "stdout",
      timestamp: Date.now(),
      payload: message,
      provider,
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
  });

  client.on("assistant_message", ({ id, text, turnId }) => {
    if (session?.activeProvider !== provider) return;

    appendSessionMessage(sessionId, { id, role: "assistant", text, provider });
    broadcastToSession(sessionId, {
      type: "assistant_message",
      text,
      itemId: id,
      turnId,
      provider,
    });
    void broadcastRepoDiff(sessionId);
  });

  client.on("command_execution_completed", (payload) => {
    if (session?.activeProvider !== provider) return;

    appendSessionMessage(sessionId, {
      id: payload.itemId,
      role: "tool_result",
      text: payload.item?.aggregatedOutput || "",
      provider,
      toolResult: {
        callId: payload.itemId,
        name: payload.item?.command || "tool",
        output: payload.item?.aggregatedOutput || "",
        success: payload.item?.status === "completed",
      },
    });
    broadcastToSession(sessionId, {
      type: "command_execution_completed",
      item: payload.item,
      itemId: payload.itemId,
      turnId: payload.turnId,
      provider,
    });
  });

  client.on("turn_completed", ({ turnId, status }) => {
    if (session?.activeProvider !== provider) return;

    broadcastToSession(sessionId, {
      type: "turn_completed",
      turnId,
      status: status || "success",
      error: null,
      provider,
    });
  });

  client.on("turn_error", ({ turnId, message }) => {
    if (session?.activeProvider !== provider) return;

    broadcastToSession(sessionId, {
      type: "turn_error",
      turnId,
      message: message || "Claude CLI error.",
      provider,
    });
  });
}

wss.on("connection", (socket, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sessionId = url.searchParams.get("session");
  const session = getSession(sessionId);
  if (!session) {
    socket.send(
      JSON.stringify({ type: "error", message: "Unknown session." })
    );
    socket.close();
    return;
  }
  session.sockets.add(socket);

  const activeClient = getActiveClient(session);
  if (activeClient?.ready && activeClient?.threadId) {
    socket.send(
      JSON.stringify({
        type: "ready",
        threadId: activeClient.threadId,
        provider: session.activeProvider,
      })
    );
  } else {
    socket.send(
      JSON.stringify({
        type: "status",
        message: `Starting ${getProviderLabel(session)}...`,
        provider: session.activeProvider,
      })
    );
  }

  socket.on("message", async (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch (error) {
      socket.send(
        JSON.stringify({ type: "error", message: "Invalid JSON message." })
      );
      return;
    }

    if (payload.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
      return;
    }

    if (payload.type === "sync_messages") {
      const provider = isValidProvider(payload.provider)
        ? payload.provider
        : session.activeProvider || "codex";
      const messages = getMessagesSince(
        session,
        provider,
        payload.lastSeenMessageId || null
      );
      socket.send(
        JSON.stringify({
          type: "messages_sync",
          provider,
          messages,
        })
      );
      return;
    }

    // ============== Worktree WebSocket Handlers ==============

    // Send message to a specific worktree
    if (payload.type === "worktree_message") {
      const worktreeId = payload.worktreeId;
      const worktree = getWorktree(session, worktreeId);

      if (!worktree) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Worktree not found.",
            worktreeId,
          })
        );
        return;
      }

      if (!worktree.client?.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Worktree client not ready yet.",
            worktreeId,
          })
        );
        return;
      }

      try {
        const result = await worktree.client.sendTurn(payload.text);
        appendWorktreeMessage(session, worktreeId, {
          id: createMessageId(),
          role: "user",
          text: payload.displayText || payload.text,
          provider: worktree.provider,
        });
        updateWorktreeStatus(session, worktreeId, "processing");
        broadcastToSession(sessionId, {
          type: "turn_started",
          worktreeId,
          turnId: result.turn.id,
          threadId: worktree.client.threadId,
          provider: worktree.provider,
        });
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to send message to worktree.",
            worktreeId,
          })
        );
      }
      return;
    }

    // Create a new worktree with an initial message (parallel request)
    if (payload.type === "create_parallel_request") {
      const provider = payload.provider;
      if (!isValidProvider(provider)) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid provider. Must be 'codex' or 'claude'.",
          })
        );
        return;
      }
      if (
        Array.isArray(session.providers) &&
        session.providers.length &&
        !session.providers.includes(provider)
      ) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Provider not enabled for this session.",
          })
        );
        return;
      }

      try {
        const worktree = await createWorktree(session, {
          provider,
          name: payload.name || null,
          parentWorktreeId: payload.parentWorktreeId || null,
        });

        // Attach events to the client
        if (worktree.client) {
          if (provider === "claude") {
            attachClaudeEventsForWorktree(sessionId, worktree);
          } else {
            attachClientEventsForWorktree(sessionId, worktree);
          }

          // Wait for client to be ready before sending initial message
          const startClient = async () => {
            await worktree.client.start();

            // Send initial message if provided
            if (payload.text) {
              const result = await worktree.client.sendTurn(payload.text);
              appendWorktreeMessage(session, worktree.id, {
                id: createMessageId(),
                role: "user",
                text: payload.displayText || payload.text,
                provider,
              });
              updateWorktreeStatus(session, worktree.id, "processing");
              broadcastToSession(sessionId, {
                type: "turn_started",
                worktreeId: worktree.id,
                turnId: result.turn.id,
                threadId: worktree.client.threadId,
                provider,
              });
            }
          };

          startClient().catch((error) => {
            console.error("Failed to start worktree client:", error);
            updateWorktreeStatus(session, worktree.id, "error");
            broadcastToSession(sessionId, {
              type: "worktree_status",
              worktreeId: worktree.id,
              status: "error",
              error: error.message,
            });
          });
        }

        broadcastToSession(sessionId, {
          type: "worktree_created",
          worktreeId: worktree.id,
          name: worktree.name,
          branchName: worktree.branchName,
          provider: worktree.provider,
          status: worktree.status,
          color: worktree.color,
        });
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to create parallel request.",
          })
        );
      }
      return;
    }

    // Interrupt a turn in a specific worktree
    if (payload.type === "worktree_turn_interrupt") {
      const worktreeId = payload.worktreeId;
      const worktree = getWorktree(session, worktreeId);

      if (!worktree) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Worktree not found.",
            worktreeId,
          })
        );
        return;
      }

      if (!worktree.client?.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Worktree client not ready.",
            worktreeId,
          })
        );
        return;
      }

      try {
        await worktree.client.interruptTurn(payload.turnId);
        socket.send(
          JSON.stringify({
            type: "turn_interrupt_sent",
            worktreeId,
          })
        );
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to interrupt worktree turn.",
            worktreeId,
          })
        );
      }
      return;
    }

    // Sync messages for a specific worktree
    if (payload.type === "sync_worktree_messages") {
      const worktreeId = payload.worktreeId;
      const worktree = getWorktree(session, worktreeId);

      if (!worktree) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Worktree not found.",
            worktreeId,
          })
        );
        return;
      }

      socket.send(
        JSON.stringify({
          type: "worktree_messages_sync",
          worktreeId,
          messages: worktree.messages,
          status: worktree.status,
        })
      );
      return;
    }

    // List all worktrees
    if (payload.type === "list_worktrees") {
      const worktrees = listWorktrees(session);
      socket.send(
        JSON.stringify({
          type: "worktrees_list",
          worktrees,
        })
      );
      return;
    }

    // ============== End Worktree WebSocket Handlers ==============

    if (payload.type === "user_message") {
      const client = getActiveClient(session);
      if (!client?.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: `${getProviderLabel(session)} not ready yet.`,
          })
        );
        return;
      }

      try {
        const provider = session.activeProvider;
        const result = await client.sendTurn(payload.text);
        appendSessionMessage(sessionId, {
          id: createMessageId(),
          role: "user",
          text: payload.displayText || payload.text,
          provider,
        });
        socket.send(
          JSON.stringify({
            type: "turn_started",
            turnId: result.turn.id,
            threadId: client.threadId,
            provider,
          })
        );
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to send message.",
          })
        );
      }
    }

    if (payload.type === "turn_interrupt") {
      const client = getActiveClient(session);
      if (!client?.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: `${getProviderLabel(session)} not ready yet.`,
          })
        );
        return;
      }
      try {
        await client.interruptTurn(payload.turnId);
        socket.send(JSON.stringify({ type: "turn_interrupt_sent" }));
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to interrupt turn.",
          })
        );
      }
    }

    if (payload.type === "model_list") {
      const client = getActiveClient(session);
      if (!client?.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: `${getProviderLabel(session)} not ready yet.`,
          })
        );
        return;
      }
      try {
        let cursor = null;
        const models = [];
        do {
          const result = await client.listModels(cursor, 200);
          if (Array.isArray(result?.data)) {
            models.push(...result.data);
          }
          cursor = result?.nextCursor ?? null;
        } while (cursor);
        socket.send(
          JSON.stringify({
            type: "model_list",
            models,
            provider: session.activeProvider,
          })
        );
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to list models.",
          })
        );
      }
    }

    if (payload.type === "model_set") {
      const client = getActiveClient(session);
      if (!client?.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: `${getProviderLabel(session)} not ready yet.`,
          })
        );
        return;
      }
      try {
        await client.setDefaultModel(
          payload.model || null,
          payload.reasoningEffort ?? null
        );
        socket.send(
          JSON.stringify({
            type: "model_set",
            model: payload.model || null,
            reasoningEffort: payload.reasoningEffort ?? null,
            provider: session.activeProvider,
          })
        );
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to set model.",
          })
        );
      }
    }

    if (payload.type === "account_login_start") {
      try {
        const requestedProvider = isValidProvider(payload.provider)
          ? payload.provider
          : session.activeProvider || "codex";
        if (
          Array.isArray(session.providers) &&
          session.providers.length &&
          !session.providers.includes(requestedProvider)
        ) {
          socket.send(
            JSON.stringify({
              type: "account_login_error",
              message: "Provider not enabled for this session.",
            })
          );
          return;
        }
        const client = await getOrCreateClient(session, requestedProvider);
        if (!client.ready) {
          await client.start();
        }
        const result = await client.startAccountLogin(payload.params);
        socket.send(
          JSON.stringify({
            type: "account_login_started",
            result,
            provider: requestedProvider,
          })
        );
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "account_login_error",
            message: error.message || "Failed to start account login.",
          })
        );
      }
    }

    if (payload.type === "switch_provider") {
      const newProvider = payload.provider;
      if (!isValidProvider(newProvider)) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid provider. Must be 'codex' or 'claude'.",
          })
        );
        return;
      }
      if (
        Array.isArray(session.providers) &&
        session.providers.length &&
        !session.providers.includes(newProvider)
      ) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Provider not enabled for this session.",
          })
        );
        return;
      }

      if (session.activeProvider === newProvider) {
        // Already on this provider, just confirm
        const messages =
          session.messagesByProvider?.[newProvider] || session.messages || [];
        socket.send(
          JSON.stringify({
            type: "provider_switched",
            provider: newProvider,
            messages,
          })
        );
        return;
      }

      try {
        // Get or create the new provider's client
        const newClient = await getOrCreateClient(session, newProvider);

        // Attach event handlers if this is a new client
        if (!newClient.listenerCount("ready")) {
          if (newProvider === "claude") {
            attachClaudeEvents(sessionId, newClient, newProvider);
          } else {
            attachClientEvents(sessionId, newClient, newProvider);
          }
        }

        // Start the client if not already started
        if (!newClient.ready) {
          await newClient.start();
        }

        // Switch active provider
        const previousProvider = session.activeProvider || "codex";
        session.activeProvider = newProvider;
        if (!session.messagesByProvider) {
          session.messagesByProvider = {};
          if (Array.isArray(session.messages) && session.messages.length > 0) {
            session.messagesByProvider[previousProvider] = session.messages;
          }
        }
        if (!Array.isArray(session.messagesByProvider[newProvider])) {
          session.messagesByProvider[newProvider] = [];
        }
        session.messages = session.messagesByProvider[newProvider];

        // Fetch models for the new provider
        let models = [];
        try {
          let cursor = null;
          do {
            const result = await newClient.listModels(cursor, 200);
            if (Array.isArray(result?.data)) {
              models.push(...result.data);
            }
            cursor = result?.nextCursor ?? null;
          } while (cursor);
        } catch {
          // Models fetch failed, continue without models
        }

        // Broadcast to all connected sockets
        broadcastToSession(sessionId, {
          type: "provider_switched",
          provider: newProvider,
          models,
          messages: session.messagesByProvider[newProvider],
          threadId: newClient.threadId || null,
        });
      } catch (error) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: error.message || "Failed to switch provider.",
          })
        );
      }
    }
  });

  socket.on("close", () => {
    session.sockets.delete(socket);
  });
});

terminalWss.on("connection", (socket, req) => {
  const session = getSessionFromRequest(req);
  if (!session) {
    socket.close();
    return;
  }
  const shell = process.env.SHELL || "bash";
  let term = null;
  let closed = false;

  const startTerminal = (cols = 80, rows = 24) => {
    if (term) {
      return;
    }
    term = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: session.repoDir,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    term.onData((data) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "output", data }));
      }
    });

    term.onExit(({ exitCode }) => {
      if (closed) {
        return;
      }
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: "exit", code: exitCode }));
      }
      socket.close();
    });
  };

  socket.on("message", (raw) => {
    let message = null;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!message?.type) {
      return;
    }
    if (message.type === "init") {
      startTerminal(message.cols, message.rows);
      return;
    }
    if (!term) {
      startTerminal();
    }
    if (message.type === "resize") {
      if (
        Number.isFinite(message.cols) &&
        Number.isFinite(message.rows) &&
        term
      ) {
        term.resize(message.cols, message.rows);
      }
      return;
    }
    if (message.type === "input" && typeof message.data === "string" && term) {
      term.write(message.data);
    }
  });

  socket.on("close", () => {
    closed = true;
    if (term) {
      term.kill();
      term = null;
    }
  });
});

app.get("/api/health", (req, res) => {
  const session = getSession(req.query.session);
  if (!session) {
    res.json({ ok: true, ready: false, threadId: null });
    return;
  }
  const activeClient = getActiveClient(session);
  res.json({
    ok: true,
    ready: activeClient?.ready || false,
    threadId: activeClient?.threadId || null,
    provider: session.activeProvider || "codex",
  });
});

app.get("/api/session/:sessionId", async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  const repoDiff = await getRepoDiff(session);
  const activeProvider = session.activeProvider || "codex";
  const messages =
    session.messagesByProvider?.[activeProvider] || session.messages || [];
  res.json({
    sessionId: req.params.sessionId,
    path: session.dir,
    repoUrl: session.repoUrl,
    provider: activeProvider,
    providers: session.providers || [activeProvider],
    messages,
    repoDiff,
    rpcLogs: session.rpcLogs || [],
  });
});

app.post("/api/session/:sessionId/clear", async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  const worktreeId = req.body?.worktreeId;
  if (worktreeId) {
    const worktree = getWorktree(session, worktreeId);
    if (!worktree) {
      res.status(404).json({ error: "Worktree not found." });
      return;
    }
    clearWorktreeMessages(session, worktreeId);
    res.json({ ok: true, worktreeId });
    return;
  }
  const provider = isValidProvider(req.body?.provider)
    ? req.body.provider
    : session.activeProvider || "codex";
  if (!session.messagesByProvider) {
    session.messagesByProvider = {};
  }
  session.messagesByProvider[provider] = [];
  if (session.activeProvider === provider) {
    session.messages = session.messagesByProvider[provider];
  }
  res.json({ ok: true, provider });
});

app.post("/api/session", async (req, res) => {
  const repoUrl = req.body?.repoUrl;
  if (!repoUrl) {
    res.status(400).json({ error: "repoUrl is required." });
    return;
  }
  try {
    const auth = req.body?.auth || null;
    const provider = req.body?.provider || "codex";
    const providers = Array.isArray(req.body?.providers)
      ? req.body.providers.filter((entry) => isValidProvider(entry))
      : null;
    if (provider !== "codex" && provider !== "claude") {
      res.status(400).json({ error: "Invalid provider." });
      return;
    }
    const session = await createSession(repoUrl, auth, provider, providers);
    res.json({
      sessionId: session.sessionId,
      path: session.dir,
      repoUrl,
      provider,
      providers: session.providers || [provider],
      messages: [],
    });
  } catch (error) {
    console.error("Failed to create session for repo:", {
      repoUrl,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to create session." });
  }
});

app.get("/api/branches", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  try {
    const info = await getBranchInfo(session);
    res.json(info);
  } catch (error) {
    console.error("Failed to list branches:", {
      sessionId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to list branches." });
  }
});

app.post("/api/branches/switch", async (req, res) => {
  const sessionId = req.body?.session;
  const target = req.body?.branch;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "Branch is required." });
    return;
  }
  const branchName = target.replace(/^origin\//, "").trim();
  try {
    const dirty = await runCommandOutput("git", ["status", "--porcelain"], {
      cwd: session.repoDir,
    });
    if (dirty.trim()) {
      res.status(409).json({
        error: "Modifications locales detectees. Stashez ou committez avant.",
      });
      return;
    }

    try {
      await runCommand("git", ["check-ref-format", "--branch", branchName], {
        cwd: session.repoDir,
      });
    } catch (error) {
      res.status(400).json({ error: "Nom de branche invalide." });
      return;
    }
    await runCommand("git", ["fetch", "--prune"], { cwd: session.repoDir });

    let switched = false;
    try {
      await runCommand("git", ["show-ref", "--verify", `refs/heads/${branchName}`], {
        cwd: session.repoDir,
      });
      await runCommand("git", ["switch", branchName], { cwd: session.repoDir });
      switched = true;
    } catch (error) {
      // ignore and try remote
    }

    if (!switched) {
      try {
        await runCommand(
          "git",
          ["show-ref", "--verify", `refs/remotes/origin/${branchName}`],
          { cwd: session.repoDir }
        );
      } catch (error) {
        res.status(404).json({ error: "Branche introuvable." });
        return;
      }
      await runCommand("git", ["switch", "--track", `origin/${branchName}`], {
        cwd: session.repoDir,
      });
    }

    await broadcastRepoDiff(sessionId);
    const info = await getBranchInfo(session);
    res.json(info);
  } catch (error) {
    console.error("Failed to switch branch:", {
      sessionId,
      branch: branchName,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to switch branch." });
  }
});

// ============== Worktree API Endpoints ==============

app.get("/api/worktrees", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  try {
    const worktrees = listWorktrees(session);
    res.json({ worktrees });
  } catch (error) {
    console.error("Failed to list worktrees:", {
      sessionId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to list worktrees." });
  }
});

app.post("/api/worktree", async (req, res) => {
  const sessionId = req.body?.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  const provider = req.body?.provider;
  if (!isValidProvider(provider)) {
    res.status(400).json({ error: "Invalid provider. Must be 'codex' or 'claude'." });
    return;
  }
  if (
    Array.isArray(session.providers) &&
    session.providers.length &&
    !session.providers.includes(provider)
  ) {
    res.status(400).json({ error: "Provider not enabled for this session." });
    return;
  }

  try {
    const worktree = await createWorktree(session, {
      provider,
      name: req.body?.name || null,
      parentWorktreeId: req.body?.parentWorktreeId || null,
      startingBranch: req.body?.startingBranch || null,
    });

    // Attacher les événements au client
    if (worktree.client) {
      if (provider === "claude") {
        attachClaudeEventsForWorktree(sessionId, worktree);
      } else {
        attachClientEventsForWorktree(sessionId, worktree);
      }
      // Démarrer le client
      worktree.client.start().catch((error) => {
        console.error("Failed to start worktree client:", error);
        updateWorktreeStatus(session, worktree.id, "error");
        broadcastToSession(sessionId, {
          type: "worktree_status",
          worktreeId: worktree.id,
          status: "error",
          error: error.message,
        });
      });
    }

    res.json({
      worktreeId: worktree.id,
      name: worktree.name,
      branchName: worktree.branchName,
      provider: worktree.provider,
      status: worktree.status,
      color: worktree.color,
    });
  } catch (error) {
    console.error("Failed to create worktree:", {
      sessionId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to create worktree." });
  }
});

app.get("/api/worktree/:worktreeId", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  const worktree = getWorktree(session, req.params.worktreeId);
  if (!worktree) {
    res.status(404).json({ error: "Worktree not found." });
    return;
  }

  try {
    const diff = await getWorktreeDiff(session, worktree.id);
    res.json({
      id: worktree.id,
      name: worktree.name,
      branchName: worktree.branchName,
      provider: worktree.provider,
      status: worktree.status,
      messages: worktree.messages,
      color: worktree.color,
      createdAt: worktree.createdAt,
      diff,
    });
  } catch (error) {
    console.error("Failed to get worktree:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to get worktree." });
  }
});

app.delete("/api/worktree/:worktreeId", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  try {
    await removeWorktree(session, req.params.worktreeId);
    broadcastToSession(sessionId, {
      type: "worktree_removed",
      worktreeId: req.params.worktreeId,
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to remove worktree:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to remove worktree." });
  }
});

app.patch("/api/worktree/:worktreeId", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  const worktree = getWorktree(session, req.params.worktreeId);
  if (!worktree) {
    res.status(404).json({ error: "Worktree not found." });
    return;
  }

  if (req.body?.name) {
    renameWorktree(session, req.params.worktreeId, req.body.name);
    broadcastToSession(sessionId, {
      type: "worktree_renamed",
      worktreeId: req.params.worktreeId,
      name: req.body.name,
    });
  }

  res.json({
    id: worktree.id,
    name: worktree.name,
    branchName: worktree.branchName,
    status: worktree.status,
  });
});

app.get("/api/worktree/:worktreeId/diff", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  try {
    const diff = await getWorktreeDiff(session, req.params.worktreeId);
    res.json(diff);
  } catch (error) {
    console.error("Failed to get worktree diff:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to get worktree diff." });
  }
});

app.get("/api/worktree/:worktreeId/commits", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  try {
    const limit = parseInt(req.query.limit, 10) || 20;
    const commits = await getWorktreeCommits(session, req.params.worktreeId, limit);
    res.json({ commits });
  } catch (error) {
    console.error("Failed to get worktree commits:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to get worktree commits." });
  }
});

app.post("/api/worktree/:worktreeId/merge", async (req, res) => {
  const sessionId = req.body?.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  const targetWorktreeId = req.body?.targetWorktreeId;
  if (!targetWorktreeId) {
    res.status(400).json({ error: "Target worktree ID is required." });
    return;
  }

  try {
    const result = await mergeWorktree(session, req.params.worktreeId, targetWorktreeId);
    if (result.success) {
      // Broadcast diff update for target worktree
      const diff = await getWorktreeDiff(session, targetWorktreeId);
      broadcastToSession(sessionId, {
        type: "worktree_diff",
        worktreeId: targetWorktreeId,
        ...diff,
      });
    }
    res.json(result);
  } catch (error) {
    console.error("Failed to merge worktree:", {
      sessionId,
      sourceWorktreeId: req.params.worktreeId,
      targetWorktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to merge worktree." });
  }
});

app.post("/api/worktree/:worktreeId/abort-merge", async (req, res) => {
  const sessionId = req.body?.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  try {
    await abortMerge(session, req.params.worktreeId);
    res.json({ ok: true });
  } catch (error) {
    console.error("Failed to abort merge:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to abort merge." });
  }
});

app.post("/api/worktree/:worktreeId/cherry-pick", async (req, res) => {
  const sessionId = req.body?.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }

  const commitSha = req.body?.commitSha;
  if (!commitSha) {
    res.status(400).json({ error: "Commit SHA is required." });
    return;
  }

  try {
    const result = await cherryPickCommit(session, commitSha, req.params.worktreeId);
    if (result.success) {
      const diff = await getWorktreeDiff(session, req.params.worktreeId);
      broadcastToSession(sessionId, {
        type: "worktree_diff",
        worktreeId: req.params.worktreeId,
        ...diff,
      });
    }
    res.json(result);
  } catch (error) {
    console.error("Failed to cherry-pick:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      commitSha,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to cherry-pick commit." });
  }
});

// ============== End Worktree API Endpoints ==============

app.get("/api/attachments", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  try {
    const entries = await fs.promises.readdir(session.attachmentsDir, {
      withFileTypes: true,
    });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(session.attachmentsDir, entry.name);
      const stats = await fs.promises.stat(filePath);
      files.push({
        name: entry.name,
        path: filePath,
        size: stats.size,
      });
    }
    res.json({ files });
  } catch (error) {
    res.status(500).json({ error: "Failed to list attachments." });
  }
});

app.post(
  "/api/attachments/upload",
  upload.array("files"),
  async (req, res) => {
    const sessionId = req.query.session;
    const session = getSession(sessionId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    const uploaded = (req.files || []).map((file) => ({
      name: file.filename,
      path: file.path,
      size: file.size,
    }));
    res.json({ files: uploaded });
  }
);

app.post("/api/auth-file", authUpload.single("file"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "Auth file is required." });
    return;
  }
  const raw = req.file.buffer.toString("utf8");
  try {
    JSON.parse(raw);
  } catch (error) {
    res.status(400).json({ error: "Invalid auth.json file." });
    return;
  }
  try {
    await fs.promises.mkdir(codexConfigDir, { recursive: true, mode: 0o700 });
    await fs.promises.writeFile(codexAuthPath, raw, { mode: 0o600 });
    await fs.promises.chmod(codexAuthPath, 0o600).catch(() => {});
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to write auth.json." });
  }
});

app.post(
  "/api/claude-auth-file",
  authUpload.single("file"),
  async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: "Auth file is required." });
      return;
    }
    const raw = req.file.buffer.toString("utf8");
    try {
      JSON.parse(raw);
    } catch (error) {
      res.status(400).json({ error: "Invalid credentials.json file." });
      return;
    }
    try {
      await fs.promises.mkdir(claudeConfigDir, { recursive: true, mode: 0o700 });
      await fs.promises.writeFile(claudeCredPath, raw, { mode: 0o600 });
      await fs.promises.chmod(claudeCredPath, 0o600).catch(() => {});
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to write credentials.json." });
    }
  }
);

app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/attachments")) {
    res.status(400).json({ error: err.message || "Attachment error." });
    return;
  }
  next(err);
});

const distPath = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

const port = process.env.PORT || 5179;
server.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`);
});
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (url.pathname === "/terminal") {
    terminalWss.handleUpgrade(req, socket, head, (ws) => {
      terminalWss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});
