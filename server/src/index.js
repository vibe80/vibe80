import express from "express";
import http from "http";
import path from "path";
import os from "os";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { spawn } from "child_process";
import jwt from "jsonwebtoken";
import * as pty from "node-pty";
import { buildSandboxArgs } from "./runAs.js";
import dockerNames from "docker-names";
import { runAsCommand, runAsCommandOutput, runAsCommandOutputWithStatus } from "./runAs.js";
import storage from "./storage/index.js";
import { getSessionRuntime, deleteSessionRuntime } from "./runtimeStore.js";
import {
  DEFAULT_GIT_AUTHOR_EMAIL,
  DEFAULT_GIT_AUTHOR_NAME,
} from "./config.js";
import {
  getOrCreateClient,
  getActiveClient,
  isValidProvider,
  createWorktreeClient,
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
  listStoredWorktrees,
  getWorktree,
  updateWorktreeStatus,
  updateWorktreeThreadId,
  appendWorktreeMessage,
  clearWorktreeMessages,
  renameWorktree,
} from "./worktreeManager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const terminalEnabled = !/^(0|false|no|off)$/i.test(
  process.env.TERMINAL_ENABLED || ""
);
const allowRunSlashCommand = !/^(0|false|no|off)$/i.test(
  process.env.ALLOW_RUN_SLASH_COMMAND || ""
);
const allowGitSlashCommand = !/^(0|false|no|off)$/i.test(
  process.env.ALLOW_GIT_SLASH_COMMAND || ""
);
const terminalWss = terminalEnabled ? new WebSocketServer({ noServer: true }) : null;

const cwd = process.cwd();
const sessions = new Map();
const workspaces = new Map();
const handoffTokens = new Map();
const workspaceUserIds = new Map();
const deploymentMode = process.env.DEPLOYMENT_MODE;
if (!deploymentMode) {
  console.error("DEPLOYMENT_MODE is required (mono_user or multi_user).");
  process.exit(1);
}
if (deploymentMode !== "mono_user" && deploymentMode !== "multi_user") {
  console.error(`Invalid DEPLOYMENT_MODE: ${deploymentMode}. Use mono_user or multi_user.`);
  process.exit(1);
}

const isMonoUser = deploymentMode === "mono_user";
const isMultiUser = deploymentMode === "multi_user";

await storage.init();

const workspaceUidMin = Number.parseInt(process.env.WORKSPACE_UID_MIN, 10) || 200000;
const workspaceUidMax = Number.parseInt(process.env.WORKSPACE_UID_MAX, 10) || 999999999;
const workspaceIdsUsed = new Set();
let workspaceIdsScanned = false;
const workspaceHomeBase = process.env.WORKSPACE_HOME_BASE || "/home";
const workspaceRootName = "vibe80_workspace";
const workspaceMetadataDirName = "metadata";
const workspaceSessionsDirName = "sessions";
const rootHelperPath = process.env.VIBE80_ROOT_HELPER || "/usr/local/bin/vibe80-root";
const runAsHelperPath = process.env.VIBE80_RUN_AS_HELPER || "/usr/local/bin/vibe80-run-as";
const sudoPath = process.env.VIBE80_SUDO_PATH || "sudo";
const jwtKeyPath = process.env.JWT_KEY_PATH || "/var/lib/vibe80/jwt.key";
const jwtIssuer = process.env.JWT_ISSUER || "vibe80";
const jwtAudience = process.env.JWT_AUDIENCE || "workspace";
const sessionGcIntervalMs = Number(process.env.SESSION_GC_INTERVAL_MS) || 5 * 60 * 1000;
const sessionIdleTtlMs = Number(process.env.SESSION_IDLE_TTL_MS) || 24 * 60 * 60 * 1000;
const sessionMaxTtlMs = Number(process.env.SESSION_MAX_TTL_MS) || 7 * 24 * 60 * 60 * 1000;
const handoffTokenTtlMs = Number(process.env.HANDOFF_TOKEN_TTL_MS) || 120 * 1000;
const accessTokenTtlSeconds = Number(process.env.ACCESS_TOKEN_TTL_SECONDS) || 60 * 60;
const refreshTokenTtlMs =
  Number(process.env.REFRESH_TOKEN_TTL_MS) || 30 * 24 * 60 * 60 * 1000;
const refreshTokenTtlSeconds = Math.floor(refreshTokenTtlMs / 1000);
const debugApiWsLog = /^(1|true|yes|on)$/i.test(
  process.env.DEBUG_API_WS_LOG || ""
);
const debugLogMaxBody = Number.isFinite(Number(process.env.DEBUG_API_WS_LOG_MAX_BODY))
  ? Number(process.env.DEBUG_API_WS_LOG_MAX_BODY)
  : 2000;

const createDebugId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(8).toString("hex");

const formatDebugPayload = (payload) => {
  if (payload == null) return null;
  if (Buffer.isBuffer(payload)) {
    const text = payload.toString("utf8");
    if (text.length > debugLogMaxBody) {
      return `${text.slice(0, debugLogMaxBody)}…(truncated)`;
    }
    return text;
  }
  if (typeof payload === "string") {
    if (payload.length > debugLogMaxBody) {
      return `${payload.slice(0, debugLogMaxBody)}…(truncated)`;
    }
    return payload;
  }
  if (typeof payload === "object") {
    try {
      const json = JSON.stringify(payload);
      if (json.length > debugLogMaxBody) {
        return `${json.slice(0, debugLogMaxBody)}…(truncated)`;
      }
      return json;
    } catch {
      return "[Unserializable object]";
    }
  }
  return String(payload);
};

const logDebug = (...args) => {
  if (!debugApiWsLog) return;
  console.log(...args);
};

const attachWebSocketDebug = (socket, req, label) => {
  if (!debugApiWsLog) return;
  const connectionId = createDebugId();
  const url = req?.url || "";
  console.log("[debug] ws connected", { id: connectionId, label, url });

  socket.on("message", (data) => {
    console.log("[debug] ws recv", {
      id: connectionId,
      label,
      data: formatDebugPayload(data),
    });
  });

  const originalSend = socket.send.bind(socket);
  socket.send = (data, ...args) => {
    console.log("[debug] ws send", {
      id: connectionId,
      label,
      data: formatDebugPayload(data),
    });
    return originalSend(data, ...args);
  };

  socket.on("close", (code, reason) => {
    console.log("[debug] ws closed", {
      id: connectionId,
      label,
      code,
      reason: formatDebugPayload(reason),
    });
  });
};

app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      !body.error_type
    ) {
      const message = String(body.error || body.message || "");
      const normalized = message.toLowerCase();
      let errorType = `HTTP_${res.statusCode}`;
      if (res.statusCode === 401) {
        if (normalized.includes("missing workspace token")) {
          errorType = "WORKSPACE_TOKEN_MISSING";
        } else if (normalized.includes("invalid workspace token")) {
          errorType = "WORKSPACE_TOKEN_INVALID";
        } else {
          errorType = "UNAUTHORIZED";
        }
      } else if (res.statusCode === 403) {
        if (normalized.includes("invalid workspace credentials")) {
          errorType = "WORKSPACE_CREDENTIALS_INVALID";
        } else if (normalized.includes("provider not enabled")) {
          errorType = "PROVIDER_NOT_ENABLED";
        } else {
          errorType = "FORBIDDEN";
        }
      } else if (res.statusCode === 404) {
        if (normalized.includes("session not found")) {
          errorType = "SESSION_NOT_FOUND";
        } else if (normalized.includes("worktree not found")) {
          errorType = "WORKTREE_NOT_FOUND";
        } else {
          errorType = "NOT_FOUND";
        }
      } else if (res.statusCode === 400) {
        if (normalized.includes("invalid workspaceid")) {
          errorType = "WORKSPACE_ID_INVALID";
        } else if (normalized.includes("repourl is required")) {
          errorType = "REPO_URL_REQUIRED";
        } else if (normalized.includes("invalid provider")) {
          errorType = "PROVIDER_INVALID";
        } else if (normalized.includes("invalid session")) {
          errorType = "SESSION_INVALID";
        } else if (normalized.includes("branch is required")) {
          errorType = "BRANCH_REQUIRED";
        } else {
          errorType = "BAD_REQUEST";
        }
      } else if (res.statusCode >= 500) {
        errorType = "INTERNAL_ERROR";
      }
      body = { ...body, error_type: errorType };
    }
    return originalJson(body);
  };
  next();
});
app.use((req, res, next) => {
  if (!debugApiWsLog || !req.path.startsWith("/api")) {
    next();
    return;
  }
  const requestId = createDebugId();
  const startedAt = Date.now();

  console.log("[debug] api request", {
    id: requestId,
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    body: formatDebugPayload(req.body),
  });

  let responseBody;
  const originalSend = res.send.bind(res);
  res.send = (body) => {
    responseBody = body;
    return originalSend(body);
  };

  res.on("finish", () => {
    const durationMs = Date.now() - startedAt;
    const formattedBody =
      responseBody === undefined && res.statusCode !== 204
        ? "<streamed or empty>"
        : formatDebugPayload(responseBody);
    console.log("[debug] api response", {
      id: requestId,
      status: res.statusCode,
      durationMs,
      body: formattedBody,
    });
  });

  next();
});

const isPublicApiRequest = (req) => {
  if (req.method === "POST" && req.path === "/workspaces") {
    return true;
  }
  if (req.method === "POST" && req.path === "/workspaces/login") {
    return true;
  }
  if (req.method === "POST" && req.path === "/workspaces/refresh") {
    return true;
  }
  if (req.method === "POST" && req.path === "/sessions/handoff/consume") {
    return true;
  }
  if (req.method === "GET" && req.path === "/health") {
    return true;
  }
  return false;
};

app.use("/api", (req, res, next) => {
  if (req.method === "OPTIONS" || isPublicApiRequest(req)) {
    next();
    return;
  }
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const token = bearerToken || queryToken;
  if (!token) {
    res.status(401).json({ error: "Missing workspace token." });
    return;
  }
  try {
    req.workspaceId = verifyWorkspaceToken(token);
  } catch (error) {
    res.status(401).json({ error: "Invalid workspace token." });
    return;
  }
  next();
});

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

const classifySessionCreationError = (error) => {
  const rawMessage = (error?.message || "").trim();
  const message = rawMessage.toLowerCase();
  if (
    message.includes("authentication failed") ||
    message.includes("invalid username or password") ||
    message.includes("http basic: access denied") ||
    message.includes("could not read username") ||
    message.includes("fatal: authentication")
  ) {
    return {
      status: 403,
      error: `Echec d'authentification Git.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("permission denied (publickey)") || message.includes("publickey")) {
    return {
      status: 403,
      error: `Echec d'authentification SSH (cle).${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("repository not found") || message.includes("not found")) {
    return {
      status: 404,
      error: `Depot Git introuvable.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("could not resolve host") || message.includes("name or service not known")) {
    return {
      status: 400,
      error: `Hote Git introuvable.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("connection timed out") || message.includes("operation timed out")) {
    return {
      status: 504,
      error: `Connexion au depot Git expiree.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  return {
    status: 500,
    error: rawMessage || "Failed to create session.",
  };
};

const runRootCommand = (args, options = {}) => {
  if (isMonoUser) {
    throw new Error("Root helpers are not available in mono_user mode.");
  }
  return runCommand(sudoPath, ["-n", rootHelperPath, ...args], options);
};

const runRootCommandOutput = (args, options = {}) => {
  if (isMonoUser) {
    throw new Error("Root helpers are not available in mono_user mode.");
  }
  return runCommandOutput(sudoPath, ["-n", rootHelperPath, ...args], options);
};

const runSessionCommand = (session, command, args, options = {}) =>
  runAsCommand(session.workspaceId, command, args, options);

const runSessionCommandOutput = (session, command, args, options = {}) =>
  runAsCommandOutput(session.workspaceId, command, args, options);

const runSessionCommandOutputWithStatus = (session, command, args, options = {}) =>
  runAsCommandOutputWithStatus(session.workspaceId, command, args, options);

const parseCommandArgs = (input = "") => {
  if (!input) {
    return [];
  }
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((item) =>
    item.startsWith("\"") && item.endsWith("\"")
      ? item.slice(1, -1)
      : item.startsWith("'") && item.endsWith("'")
        ? item.slice(1, -1)
        : item
  );
};

const loadJwtKey = () => {
  if (process.env.JWT_KEY) {
    return process.env.JWT_KEY;
  }
  if (fs.existsSync(jwtKeyPath)) {
    return fs.readFileSync(jwtKeyPath, "utf8").trim();
  }
  fs.mkdirSync(path.dirname(jwtKeyPath), { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(jwtKeyPath, key, { mode: 0o600 });
  return key;
};

const jwtKey = loadJwtKey();

const generateId = (prefix) => `${prefix}${crypto.randomBytes(12).toString("hex")}`;

const generateSessionName = () => dockerNames.getRandomName();

const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const generateRefreshToken = () => crypto.randomBytes(32).toString("hex");

const issueWorkspaceTokens = async (workspaceId) => {
  const workspaceToken = createWorkspaceToken(workspaceId);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = Date.now() + refreshTokenTtlMs;
  await storage.saveWorkspaceRefreshToken(
    workspaceId,
    tokenHash,
    expiresAt,
    refreshTokenTtlMs
  );
  return {
    workspaceToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
    refreshExpiresIn: refreshTokenTtlSeconds,
  };
};

const createHandoffToken = (session) => {
  const now = Date.now();
  const token = generateId("h");
  const record = {
    token,
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    createdAt: now,
    expiresAt: now + handoffTokenTtlMs,
    usedAt: null,
  };
  handoffTokens.set(token, record);
  return record;
};

const cleanupHandoffTokens = () => {
  if (handoffTokens.size === 0) return;
  const now = Date.now();
  for (const [token, record] of handoffTokens.entries()) {
    if (record.usedAt || (record.expiresAt && record.expiresAt <= now)) {
      handoffTokens.delete(token);
    }
  }
};
const workspaceIdPattern = isMonoUser ? /^default$/ : /^w[0-9a-f]{24}$/;
const sessionIdPattern = /^s[0-9a-f]{24}$/;

const getWorkspacePaths = (workspaceId) => {
  const home = isMonoUser ? os.homedir() : path.join(workspaceHomeBase, workspaceId);
  const root = path.join(home, workspaceRootName);
  const metadataDir = path.join(root, workspaceMetadataDirName);
  const sessionsDir = path.join(root, workspaceSessionsDirName);
  return {
    homeDir: home,
    rootDir: root,
    metadataDir,
    sessionsDir,
    secretPath: path.join(metadataDir, "workspace.secret"),
    configPath: path.join(metadataDir, "workspace.json"),
    auditPath: path.join(metadataDir, "audit.log"),
  };
};

const getWorkspaceSshPaths = (workspaceHome) => {
  const sshDir = path.join(workspaceHome, ".ssh");
  return {
    sshDir,
    knownHostsPath: path.join(sshDir, "known_hosts"),
  };
};

const getWorkspaceAuthPaths = (workspaceHome) => ({
  codexDir: path.join(workspaceHome, ".codex"),
  codexAuthPath: path.join(workspaceHome, ".codex", "auth.json"),
  claudeAuthPath: path.join(workspaceHome, ".claude.json"),
  claudeDir: path.join(workspaceHome, ".claude"),
  claudeCredentialsPath: path.join(workspaceHome, ".claude", ".credentials.json"),
});

const ensureWorkspaceDir = async (workspaceId, dirPath, mode = 0o700) => {
  await runAsCommand(workspaceId, "/bin/mkdir", ["-p", dirPath]);
  await runAsCommand(workspaceId, "/bin/chmod", [mode.toString(8), dirPath]);
};

const writeWorkspaceFile = async (workspaceId, filePath, content, mode = 0o600) => {
  await runAsCommand(workspaceId, "/usr/bin/tee", [filePath], { input: content });
  await runAsCommand(workspaceId, "/bin/chmod", [mode.toString(8), filePath]);
};

const appendWorkspaceFile = async (workspaceId, filePath, content, mode = 0o600) => {
  await runAsCommand(workspaceId, "/usr/bin/tee", ["-a", filePath], { input: content });
  await runAsCommand(workspaceId, "/bin/chmod", [mode.toString(8), filePath]);
};

const workspaceUserExists = async (workspaceId) => {
  if (isMonoUser) {
    return workspaceId === "default";
  }
  try {
    await runCommandOutput("id", ["-u", workspaceId]);
    return true;
  } catch {
    return false;
  }
};

const listWorkspaceEntries = async (workspaceId, dirPath) => {
  let output;
  try {
    output = await runAsCommandOutput(
      workspaceId,
      "/usr/bin/find",
      [dirPath, "-maxdepth", "1", "-mindepth", "1", "-printf", "%y\t%f\0"],
      { binary: true }
    );
    const parsed = output
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [type, name] = line.split("\t");
        return { type, name };
      })
      .filter((entry) => entry.type && entry.name);
    if (parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    logDebug("[debug] listWorkspaceEntries failed", {
      workspaceId,
      dirPath,
      error: error?.message || error,
    });
  }

  try {
    const fallbackOutput = await runAsCommandOutput(workspaceId, "/usr/bin/find", [
      dirPath,
      "-maxdepth",
      "1",
      "-mindepth",
      "1",
      "-printf",
      "%y\t%f\n",
    ]);
    const parsed = fallbackOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [type, name] = line.split("\t");
        return { type, name };
      })
      .filter((entry) => entry.type && entry.name);
    if (parsed.length > 0) {
      return parsed;
    }
    if (output) {
      logDebug("[debug] listWorkspaceEntries empty parse", {
        workspaceId,
        dirPath,
        sample: output.toString("utf8").slice(0, 200),
      });
    }
  } catch (error) {
    logDebug("[debug] listWorkspaceEntries fallback failed", {
      workspaceId,
      dirPath,
      error: error?.message || error,
    });
  }
  return [];
};

const getWorkspaceStat = async (workspaceId, targetPath) => {
  const output = await runAsCommandOutput(workspaceId, "/usr/bin/stat", [
    "-c",
    "%f\t%s\t%a",
    targetPath,
  ]);
  const [modeHex, sizeRaw, modeRaw] = output.trim().split("\t");
  const modeValue = Number.parseInt(modeHex, 16);
  const typeBits = Number.isFinite(modeValue) ? modeValue & 0o170000 : null;
  let type = "";
  if (typeBits === 0o100000) {
    type = "regular";
  } else if (typeBits === 0o040000) {
    type = "directory";
  } else if (typeBits === 0o120000) {
    type = "symlink";
  } else if (Number.isFinite(typeBits)) {
    type = "other";
  }
  return {
    type,
    size: Number.parseInt(sizeRaw, 10),
    mode: modeRaw,
  };
};

const workspacePathExists = async (workspaceId, targetPath) => {
  try {
    await runAsCommandOutput(workspaceId, "/usr/bin/stat", ["-c", "%F", targetPath]);
    return true;
  } catch {
    return false;
  }
};

const readWorkspaceFileBuffer = async (workspaceId, filePath, maxBytes) => {
  const stat = await getWorkspaceStat(workspaceId, filePath);
  if (!stat.type || !stat.type.startsWith("regular")) {
    console.warn("readWorkspaceFileBuffer: non-regular path", {
      workspaceId,
      filePath,
      type: stat.type || null,
      size: stat.size,
      mode: stat.mode,
    });
    throw new Error("Path is not a file.");
  }
  if (Number.isFinite(maxBytes) && stat.size > maxBytes) {
    const buffer = await runAsCommandOutput(
      workspaceId,
      "/usr/bin/head",
      ["-c", String(maxBytes), filePath],
      { binary: true }
    );
    return { buffer, truncated: true };
  }
  const buffer = await runAsCommandOutput(workspaceId, "/bin/cat", [filePath], { binary: true });
  return { buffer, truncated: false };
};

const writeWorkspaceFilePreserveMode = async (workspaceId, filePath, content) => {
  const stat = await getWorkspaceStat(workspaceId, filePath);
  if (!stat.type || !stat.type.startsWith("regular")) {
    throw new Error("Path is not a file.");
  }
  await runAsCommand(workspaceId, "/usr/bin/tee", [filePath], { input: content });
  if (stat.mode) {
    await runAsCommand(workspaceId, "/bin/chmod", [stat.mode, filePath]);
  }
};

const getWorkspaceUserIds = async (workspaceId) => {
  const cached = await storage.getWorkspaceUserIds(workspaceId);
  if (cached) {
    return cached;
  }
  if (isMonoUser) {
    const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
    const gid = typeof process.getgid === "function" ? process.getgid() : os.userInfo().gid;
    const ids = { uid, gid };
    await storage.saveWorkspaceUserIds(workspaceId, ids);
    return ids;
  }
  let uid = null;
  let gid = null;
  try {
    const [uidRaw, gidRaw] = await Promise.all([
      runCommandOutput("id", ["-u", workspaceId]),
      runCommandOutput("id", ["-g", workspaceId]),
    ]);
    uid = Number(uidRaw.trim());
    gid = Number(gidRaw.trim());
  } catch {
    const recovered = await recoverWorkspaceIds(workspaceId);
    uid = recovered.uid;
    gid = recovered.gid;
  }
  const ids = { uid, gid };
  await storage.saveWorkspaceUserIds(workspaceId, ids);
  return ids;
};

const ensureWorkspaceUserExists = async (workspaceId) => {
  if (isMonoUser) {
    return;
  }
  const ids = await getWorkspaceUserIds(workspaceId);
  try {
    await runCommandOutput("id", ["-u", workspaceId]);
    return;
  } catch {
    // continue
  }
  try {
    await runRootCommand(["create-workspace", "--workspace-id", workspaceId]);
  } catch (error) {
    const homeDir = getWorkspacePaths(workspaceId).homeDir;
    await ensureWorkspaceUser(workspaceId, homeDir, ids);
  }
  try {
    const [uidRaw, gidRaw] = await Promise.all([
      runCommandOutput("id", ["-u", workspaceId]),
      runCommandOutput("id", ["-g", workspaceId]),
    ]);
    await storage.saveWorkspaceUserIds(workspaceId, {
      uid: Number(uidRaw.trim()),
      gid: Number(gidRaw.trim()),
    });
  } catch {
    // ignore cache refresh failures
  }
  await appendAuditLog(workspaceId, "workspace_user_recreated", {
    uid: ids.uid,
    gid: ids.gid,
  });
};

const buildWorkspaceEnv = (workspaceId) => {
  const home = isMonoUser ? os.homedir() : path.join(workspaceHomeBase, workspaceId);
  const user = isMonoUser ? os.userInfo().username : workspaceId;
  return {
    ...process.env,
    HOME: home,
    USER: user,
    LOGNAME: user,
  };
};

const appendAuditLog = async (workspaceId, event, details = {}) => {
  try {
    const paths = getWorkspacePaths(workspaceId);
    const entry = JSON.stringify({
      ts: Date.now(),
      event,
      workspaceId,
      ...details,
    });
    await appendWorkspaceFile(workspaceId, paths.auditPath, `${entry}\n`, 0o600);
  } catch {
    // Avoid failing requests on audit errors.
  }
};

const touchSession = async (session) => {
  if (!session) return;
  const updated = { ...session, lastActivityAt: Date.now() };
  await storage.saveSession(session.sessionId, updated);
  return updated;
};

const allowedAuthTypes = new Set(["api_key", "auth_json_b64", "setup_token"]);
const allowedProviders = new Set(["codex", "claude"]);
const providerAuthTypes = {
  codex: new Set(["api_key", "auth_json_b64"]),
  claude: new Set(["api_key", "setup_token"]),
};

const validateProvidersConfig = (providers) => {
  if (!providers || typeof providers !== "object") {
    return "providers is required.";
  }
  for (const [provider, config] of Object.entries(providers)) {
    if (!allowedProviders.has(provider)) {
      return `Unknown provider ${provider}.`;
    }
    if (!config || typeof config !== "object") {
      return `Invalid provider config for ${provider}.`;
    }
    if (typeof config.enabled !== "boolean") {
      return `Provider ${provider} must include enabled boolean.`;
    }
    if (config.enabled && !config.auth) {
      return `Provider ${provider} auth is required when enabled.`;
    }
    if (config.auth != null) {
      if (typeof config.auth !== "object") {
        return `Provider ${provider} auth must be an object.`;
      }
      const { type, value } = config.auth;
      if (!allowedAuthTypes.has(type)) {
        return `Provider ${provider} auth type is invalid.`;
      }
      const providerTypes = providerAuthTypes[provider];
      if (providerTypes && !providerTypes.has(type)) {
        return `Provider ${provider} auth type ${type} is not supported.`;
      }
      if (typeof value !== "string" || !value.trim()) {
        return `Provider ${provider} auth value is required.`;
      }
    }
  }
  return null;
};

const listEnabledProviders = (providers) =>
  Object.entries(providers || {})
    .filter(([, config]) => config?.enabled)
    .map(([name]) => name);

const pickDefaultProvider = (providers) => {
  if (!providers || providers.length === 0) {
    return null;
  }
  if (providers.includes("codex")) {
    return "codex";
  }
  return providers[0];
};

const ensureWorkspaceUser = async (workspaceId, homeDirPath, ids = null) => {
  if (isMonoUser) {
    return;
  }
  try {
    await runCommandOutput("id", ["-u", workspaceId]);
    return;
  } catch {
    // continue
  }
  if (ids?.gid) {
    try {
      await runCommandOutput("getent", ["group", String(ids.gid)]);
    } catch {
      await runCommand("groupadd", ["-g", String(ids.gid), workspaceId]);
    }
  }
  const userArgs = ["-m", "-d", homeDirPath, "-s", "/bin/bash"];
  if (ids?.uid) {
    userArgs.push("-u", String(ids.uid));
  }
  if (ids?.gid) {
    userArgs.push("-g", String(ids.gid));
  }
  userArgs.push(workspaceId);
  await runCommand("useradd", userArgs);
};

const ensureWorkspaceIdsRecorded = async (workspaceId, ids, config = null) => {
  const existing = config || (await readWorkspaceConfig(workspaceId).catch(() => null));
  if (!existing) {
    return;
  }
  if (Number.isFinite(existing.uid) && Number.isFinite(existing.gid)) {
    return;
  }
  await writeWorkspaceConfig(workspaceId, existing.providers, ids, existing);
};

const scanWorkspaceIds = async () => {
  if (isMonoUser) {
    return;
  }
  if (workspaceIdsScanned) {
    return;
  }
  workspaceIdsScanned = true;
  let entries = [];
  try {
    entries = await fs.promises.readdir(workspaceHomeBase, { withFileTypes: true });
  } catch {
    return;
  }
  const workspaceDirs = entries
    .filter((entry) => entry.isDirectory() && workspaceIdPattern.test(entry.name))
    .map((entry) => entry.name);
  for (const workspaceId of workspaceDirs) {
    try {
      const config = await readWorkspaceConfig(workspaceId);
      if (Number.isFinite(config?.uid)) {
        workspaceIdsUsed.add(Number(config.uid));
      }
      if (Number.isFinite(config?.gid)) {
        workspaceIdsUsed.add(Number(config.gid));
      }
      if (Number.isFinite(config?.uid) && Number.isFinite(config?.gid)) {
        continue;
      }
    } catch {
      // ignore missing config
    }
    try {
      const homePath = path.join(workspaceHomeBase, workspaceId);
      const output = await runAsCommandOutput(workspaceId, "/usr/bin/stat", [
        "-c",
        "%u\t%g",
        homePath,
      ]);
      const [uidRaw, gidRaw] = output.trim().split("\t");
      const uid = Number(uidRaw);
      const gid = Number(gidRaw);
      if (Number.isFinite(uid)) {
        workspaceIdsUsed.add(uid);
      }
      if (Number.isFinite(gid)) {
        workspaceIdsUsed.add(gid);
      }
    } catch {
      // ignore missing home dir
    }
  }
};

const allocateWorkspaceIds = async () => {
  await scanWorkspaceIds();
  const min = Math.max(1, workspaceUidMin);
  const max = Math.max(min, workspaceUidMax);
  const attempts = 1000;
  for (let i = 0; i < attempts; i += 1) {
    const candidate = crypto.randomInt(min, max + 1);
    if (workspaceIdsUsed.has(candidate)) {
      continue;
    }
    try {
      await runCommandOutput("getent", ["passwd", String(candidate)]);
      continue;
    } catch {
      // free uid
    }
    workspaceIdsUsed.add(candidate);
    return { uid: candidate, gid: candidate };
  }
  throw new Error("Unable to allocate a workspace uid/gid.");
};

const recoverWorkspaceIds = async (workspaceId) => {
  if (isMonoUser) {
    const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
    const gid = typeof process.getgid === "function" ? process.getgid() : os.userInfo().gid;
    return { uid, gid };
  }
  const homeDir = path.join(workspaceHomeBase, workspaceId);
  let config = null;
  try {
    config = await readWorkspaceConfig(workspaceId);
  } catch {
    config = null;
  }
  let uid = Number.isFinite(config?.uid) ? Number(config.uid) : null;
  let gid = Number.isFinite(config?.gid) ? Number(config.gid) : null;
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
    try {
      const output = await runAsCommandOutput(workspaceId, "/usr/bin/stat", [
        "-c",
        "%u\t%g",
        homeDir,
      ]);
      const [uidRaw, gidRaw] = output.trim().split("\t");
      if (!Number.isFinite(uid)) {
        uid = Number(uidRaw);
      }
      if (!Number.isFinite(gid)) {
        gid = Number(gidRaw);
      }
    } catch {
      // ignore
    }
  }
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
    throw new Error("Workspace user ids unavailable.");
  }
  const ids = { uid, gid };
  await ensureWorkspaceUser(workspaceId, homeDir, ids);
  await ensureWorkspaceIdsRecorded(workspaceId, ids, config);
  await appendAuditLog(workspaceId, "workspace_user_rehydrated", {
    uid: ids.uid,
    gid: ids.gid,
  });
  return ids;
};

const ensureWorkspaceDirs = async (workspaceId) => {
  const paths = getWorkspacePaths(workspaceId);
  await runAsCommand(workspaceId, "/bin/mkdir", ["-p", paths.metadataDir]);
  await runAsCommand(workspaceId, "/bin/chmod", ["700", paths.metadataDir]);
  await runAsCommand(workspaceId, "/bin/mkdir", ["-p", paths.sessionsDir]);
  await runAsCommand(workspaceId, "/bin/chmod", ["700", paths.sessionsDir]);
  return paths;
};

const decodeBase64 = (value) => {
  if (!value) {
    return "";
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch (error) {
    throw new Error("Invalid base64 payload.");
  }
};

const writeWorkspaceProviderAuth = async (workspaceId, providers) => {
  const workspaceHome = getWorkspacePaths(workspaceId).homeDir;
  const authPaths = getWorkspaceAuthPaths(workspaceHome);

  const codexConfig = providers?.codex;
  if (codexConfig?.enabled && codexConfig.auth) {
    await ensureWorkspaceDir(workspaceId, authPaths.codexDir, 0o700);
    if (codexConfig.auth.type === "api_key") {
      const payload = JSON.stringify({ OPENAI_API_KEY: codexConfig.auth.value }, null, 2);
      await writeWorkspaceFile(workspaceId, authPaths.codexAuthPath, payload, 0o600);
    } else if (codexConfig.auth.type === "auth_json_b64") {
      const decoded = decodeBase64(codexConfig.auth.value);
      await writeWorkspaceFile(workspaceId, authPaths.codexAuthPath, decoded, 0o600);
    }
  }

  const claudeConfig = providers?.claude;
  if (claudeConfig?.enabled && claudeConfig.auth) {
    if (claudeConfig.auth.type === "api_key") {
      const payload = JSON.stringify({ primaryApiKey: claudeConfig.auth.value }, null, 2);
      await writeWorkspaceFile(workspaceId, authPaths.claudeAuthPath, payload, 0o600);
    } else if (claudeConfig.auth.type === "setup_token") {
      await ensureWorkspaceDir(workspaceId, authPaths.claudeDir, 0o700);
      const payload = JSON.stringify(
        {
          claudeAiOauth: {
            accessToken: claudeConfig.auth.value,
            refreshToken: "dummy",
            expiresAt: 1969350365482,
            scopes: [
              "user:inference",
              "user:mcp_servers",
              "user:profile",
              "user:sessions:claude_code",
            ],
            subscriptionType: "pro",
            rateLimitTier: "default_claude_ai",
          },
        },
        null,
        2
      );
      await writeWorkspaceFile(workspaceId, authPaths.claudeCredentialsPath, payload, 0o600);
    }
  }
};

const writeWorkspaceConfig = async (workspaceId, providers, ids, existingConfig = null) => {
  const paths = getWorkspacePaths(workspaceId);
  const existing = existingConfig || null;
  const payload = {
    workspaceId,
    providers,
    uid: Number.isFinite(existing?.uid) ? existing.uid : ids?.uid,
    gid: Number.isFinite(existing?.gid) ? existing.gid : ids?.gid,
    updatedAt: Date.now(),
  };
  await writeWorkspaceFile(workspaceId, paths.configPath, JSON.stringify(payload, null, 2), 0o600);
  return payload;
};

const readWorkspaceConfig = async (workspaceId) => {
  const paths = getWorkspacePaths(workspaceId);
  const raw = await runAsCommandOutput(workspaceId, "/bin/cat", [paths.configPath]);
  return JSON.parse(raw);
};

const readWorkspaceSecret = async (workspaceId) => {
  const paths = getWorkspacePaths(workspaceId);
  return runAsCommandOutput(workspaceId, "/bin/cat", [paths.secretPath]).then((value) => value.trim());
};

const ensureDefaultMonoWorkspace = async () => {
  if (!isMonoUser) {
    return;
  }
  const workspaceId = "default";
  const paths = getWorkspacePaths(workspaceId);
  await ensureWorkspaceDirs(workspaceId);
  try {
    await readWorkspaceSecret(workspaceId);
  } catch {
    await writeWorkspaceFile(workspaceId, paths.secretPath, "default", 0o600);
  }
  const ids = await getWorkspaceUserIds(workspaceId);
  const existing = await readWorkspaceConfig(workspaceId).catch(() => null);
  if (!existing) {
    const providers = {
      codex: { enabled: true, auth: null },
      claude: { enabled: true, auth: null },
    };
    await writeWorkspaceConfig(workspaceId, providers, ids);
    await appendAuditLog(workspaceId, "workspace_created");
  }
};

await ensureDefaultMonoWorkspace();

const createWorkspace = async (providers) => {
  const validationError = validateProvidersConfig(providers);
  if (validationError) {
    throw new Error(validationError);
  }
  if (isMonoUser) {
    const workspaceId = "default";
    const paths = getWorkspacePaths(workspaceId);
    await ensureWorkspaceDirs(workspaceId);
    let secret = "";
    try {
      secret = await readWorkspaceSecret(workspaceId);
    } catch {
      secret = crypto.randomBytes(32).toString("hex");
      await writeWorkspaceFile(workspaceId, paths.secretPath, secret, 0o600);
    }
    const ids = await getWorkspaceUserIds(workspaceId);
    await writeWorkspaceProviderAuth(workspaceId, providers);
    await writeWorkspaceConfig(workspaceId, providers, ids);
    await appendAuditLog(workspaceId, "workspace_created");
    return { workspaceId, workspaceSecret: secret };
  }
  while (true) {
    const workspaceId = generateId("w");
    if (!workspaceIdPattern.test(workspaceId)) {
      continue;
    }
    const paths = getWorkspacePaths(workspaceId);
    if (await workspaceUserExists(workspaceId)) {
      continue;
    }
    await runRootCommand(["create-workspace", "--workspace-id", workspaceId]);
    const ids = await getWorkspaceUserIds(workspaceId);
    const secret = crypto.randomBytes(32).toString("hex");
    await writeWorkspaceFile(workspaceId, paths.secretPath, secret, 0o600);
    await writeWorkspaceProviderAuth(workspaceId, providers);
    await writeWorkspaceConfig(workspaceId, providers, ids);
    await appendAuditLog(workspaceId, "workspace_created");
    return { workspaceId, workspaceSecret: secret };
  }
};

const updateWorkspace = async (workspaceId, providers) => {
  const validationError = validateProvidersConfig(providers);
  if (validationError) {
    throw new Error(validationError);
  }
  const ids = await getWorkspaceUserIds(workspaceId);
  const existing = await readWorkspaceConfig(workspaceId).catch(() => null);
  await writeWorkspaceProviderAuth(workspaceId, providers);
  const payload = await writeWorkspaceConfig(workspaceId, providers, ids, existing);
  await appendAuditLog(workspaceId, "workspace_updated");
  return payload;
};

const createWorkspaceToken = (workspaceId) =>
  jwt.sign({}, jwtKey, {
    algorithm: "HS256",
    expiresIn: `${accessTokenTtlSeconds}s`,
    subject: workspaceId,
    issuer: jwtIssuer,
    audience: jwtAudience,
    jwtid:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : crypto.randomBytes(8).toString("hex"),
  });

const verifyWorkspaceToken = (token) => {
  const payload = jwt.verify(token, jwtKey, {
    issuer: jwtIssuer,
    audience: jwtAudience,
  });
  const workspaceId = payload?.sub;
  if (typeof workspaceId !== "string") {
    throw new Error("Invalid token subject.");
  }
  return workspaceId;
};

const stopClient = async (client) => {
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

const cleanupSession = async (sessionId, reason) => {
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

const runSessionGc = async () => {
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

const normalizeRemoteBranches = (output, remote) =>
  output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((ref) => !ref.endsWith("/HEAD"))
    .map((ref) =>
      ref.startsWith(`${remote}/`) ? ref.slice(remote.length + 1) : ref
    );

const getCurrentBranch = async (session) => {
  const output = await runSessionCommandOutput(
    session,
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: session.repoDir }
  );
  const trimmed = output.trim();
  return trimmed === "HEAD" ? "" : trimmed;
};

const getLastCommit = async (session, cwd) => {
  const output = await runSessionCommandOutput(
    session,
    "git",
    ["log", "-1", "--format=%H|%s"],
    { cwd }
  );
  const [sha, message] = output.trim().split("|");
  return { sha: sha || "", message: message || "" };
};

const getBranchInfo = async (session, remote = "origin") => {
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

const resolveDefaultDenyGitCredentialsAccess = (session) =>
  typeof session?.defaultDenyGitCredentialsAccess === "boolean"
    ? session.defaultDenyGitCredentialsAccess
    : true;

const createSession = async (
  workspaceId,
  repoUrl,
  auth,
  defaultInternetAccess,
  defaultDenyGitCredentialsAccess,
  name
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
      const env = {};
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
      if (DEFAULT_GIT_AUTHOR_NAME && DEFAULT_GIT_AUTHOR_EMAIL) {
        await runAsCommand(
          workspaceId,
          "git",
          ["-C", repoDir, "config", "user.name", DEFAULT_GIT_AUTHOR_NAME],
          { env }
        );
        await runAsCommand(
          workspaceId,
          "git",
          ["-C", repoDir, "config", "user.email", DEFAULT_GIT_AUTHOR_EMAIL],
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
      // Initialize session for storage
      const session = {
        sessionId,
        workspaceId,
        dir,
        attachmentsDir,
        repoDir,
        repoUrl,
        name: resolvedName,
        activeProvider: defaultProvider,
        providers: enabledProviders,
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

      // Create and start the initial provider client
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

const getSession = async (sessionId, workspaceId = null) => {
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

const getSessionFromRequest = async (req) => {
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

const sanitizeFilename = (originalName) =>
  path.basename(originalName || "attachment");

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
const MAX_TREE_ENTRIES = 3000;
const MAX_TREE_DEPTH = 8;
const MAX_FILE_BYTES = 200 * 1024;
const MAX_WRITE_BYTES = 500 * 1024;

const resolveWorktreeRoot = async (session, worktreeId) => {
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

const buildDirectoryTree = async (workspaceId, rootPath, options = {}) => {
  const maxDepth = Number.isFinite(Number(options.maxDepth))
    ? Math.min(Number(options.maxDepth), MAX_TREE_DEPTH)
    : MAX_TREE_DEPTH;
  const maxEntries = Number.isFinite(Number(options.maxEntries))
    ? Math.min(Number(options.maxEntries), MAX_TREE_ENTRIES)
    : MAX_TREE_ENTRIES;
  let count = 0;
  let truncated = false;

  const walk = async (absPath, relPath, depth) => {
    if (count >= maxEntries) {
      truncated = true;
      return [];
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

    const nodes = [];
    for (const entry of visible) {
      if (count >= maxEntries) {
        truncated = true;
        break;
      }
      const entryPath = relPath ? `${relPath}/${entry.name}` : entry.name;
      const absEntryPath = path.join(absPath, entry.name);
      if (entry.type === "d") {
        count += 1;
        const node = {
          name: entry.name,
          path: entryPath,
          type: "dir",
          children: [],
        };
        if (depth < maxDepth) {
          node.children = await walk(absEntryPath, entryPath, depth + 1);
        }
        nodes.push(node);
      } else {
        count += 1;
        nodes.push({
          name: entry.name,
          path: entryPath,
          type: "file",
        });
      }
    }
    return nodes;
  };

  const tree = await walk(rootPath, "", 0);
  return { tree, total: count, truncated };
};

const appendMainMessage = async (session, message) => {
  if (!session) {
    return;
  }
  await appendWorktreeMessage(session, "main", message);
};

const getMessagesSince = (messages, lastSeenMessageId) => {
  if (!Array.isArray(messages)) {
    return [];
  }
  if (!lastSeenMessageId) {
    return messages;
  }
  const index = messages.findIndex((message) => message?.id === lastSeenMessageId);
  if (index === -1) {
    return messages;
  }
  return messages.slice(index + 1);
};

const appendRpcLog = async (sessionId, entry) => {
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

const broadcastRepoDiff = async (sessionId) => {
  const session = await getSession(sessionId);
  if (!session) {
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
  }
};

const getRepoDiff = async (session) => {
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

const ensureUniqueFilename = async (workspaceId, dir, filename, reserved) => {
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

const uploadTempDir = path.join(os.tmpdir(), "vibe80_uploads");
fs.mkdirSync(uploadTempDir, { recursive: true, mode: 0o700 });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const sessionId = req.query.session;
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
      const sessionId = req.query.session;
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

const getProviderLabel = (session) =>
  session?.activeProvider === "claude" ? "Claude CLI" : "Codex app-server";

function broadcastToSession(sessionId, payload) {
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

function attachClientEvents(sessionId, client, provider) {
  // Track authentication errors from Codex stderr logs
  let lastAuthError = null;

  client.on("ready", ({ threadId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (threadId && session) {
        const updated = { ...session, threadId, lastActivityAt: Date.now() };
        await storage.saveSession(sessionId, updated);
      }
      if (session?.activeProvider === provider) {
        broadcastToSession(sessionId, { type: "ready", threadId, provider });
      }
    })();
  });

  client.on("log", (message) => {
    if (!message) return;
    console.log(`[codex:${sessionId}] ${message}`);
    if (message.includes("401 Unauthorized") || message.includes("Unauthorized")) {
      lastAuthError = "Erreur d'authentification Codex: vérifiez votre fichier auth.json";
      void (async () => {
        const session = await getSession(sessionId);
        if (session?.activeProvider === provider) {
          broadcastToSession(sessionId, {
            type: "error",
            message: lastAuthError,
            details: message,
          });
        }
      })();
    }
  });

  client.on("exit", ({ code, signal }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (session?.activeProvider === provider) {
        const errorMessage = lastAuthError || "Codex app-server stopped.";
        broadcastToSession(sessionId, { type: "error", message: errorMessage });
      }
    })();
    console.error("Codex app-server stopped.", { code, signal, sessionId });
  });

  client.on("notification", (message) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session || session.activeProvider !== provider) {
        return;
      }

      switch (message.method) {
      case "thread/started": {
        const threadId = message?.params?.thread?.id;
        if (threadId) {
          const updated = { ...session, threadId, lastActivityAt: Date.now() };
          await storage.saveSession(sessionId, updated);
          await updateWorktreeThreadId(session, "main", threadId);
        }
        break;
      }
      case "codex/event/agent_reasoning": {
        const text = message?.params?.msg?.text || "";
        if (text) {
          broadcastToSession(sessionId, {
            type: "agent_reasoning",
            text,
            provider,
          });
        }
        break;
      }
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
            await appendMainMessage(session, {
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
            await appendMainMessage(session, {
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
            error: turn.error || null,
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
    })();
  });

  client.on("rpc_out", (payload) => {
    void (async () => {
      if (!debugApiWsLog) {
        return;
      }
      const entry = {
        direction: "stdin",
        timestamp: Date.now(),
        payload,
        provider,
      };
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });

  client.on("rpc_in", (payload) => {
    void (async () => {
      if (!debugApiWsLog) {
        return;
      }
      const entry = {
        direction: "stdout",
        timestamp: Date.now(),
        payload,
        provider,
      };
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });
}

// Broadcast diff for a specific worktree
const broadcastWorktreeDiff = async (sessionId, worktreeId) => {
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

// Attach events to a Codex client for a worktree
function attachClientEventsForWorktree(sessionId, worktree) {
  const client = worktree.client;
  const worktreeId = worktree.id;
  const provider = worktree.provider;

  client.on("ready", ({ threadId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (threadId) {
        await updateWorktreeThreadId(session, worktreeId, threadId);
      }
      await updateWorktreeStatus(session, worktreeId, "ready");
      broadcastToSession(sessionId, {
        type: "worktree_ready",
        worktreeId,
        threadId,
        provider,
      });
    })();
  });

  // Track authentication errors from Codex stderr logs for worktree
  let lastAuthError = null;

  client.on("log", (message) => {
    if (message) {
      console.log(`[codex:${sessionId}:wt-${worktreeId}] ${message}`);
      // Detect authentication errors
      if (message.includes("401 Unauthorized") || message.includes("Unauthorized")) {
        lastAuthError = "Erreur d'authentification Codex: vérifiez votre fichier auth.json";
      }
    }
  });

  client.on("exit", ({ code, signal }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      await updateWorktreeStatus(session, worktreeId, "error");
      broadcastToSession(sessionId, {
        type: "worktree_status",
        worktreeId,
        status: "error",
        error: lastAuthError || "Codex app-server stopped.",
      });
    })();
    console.error("Worktree Codex app-server stopped.", { code, signal, sessionId, worktreeId });
  });

  client.on("notification", (message) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      switch (message.method) {
      case "thread/started": {
        const threadId = message?.params?.thread?.id;
        if (threadId) {
          await updateWorktreeThreadId(session, worktreeId, threadId);
        }
        break;
      }
      case "codex/event/agent_reasoning": {
        const text = message?.params?.msg?.text || "";
        if (text) {
          broadcastToSession(sessionId, {
            type: "agent_reasoning",
            worktreeId,
            text,
            provider,
          });
        }
        break;
      }
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
          await appendWorktreeMessage(session, worktreeId, {
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
          await appendWorktreeMessage(session, worktreeId, {
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
        await updateWorktreeStatus(session, worktreeId, "ready");
        broadcastToSession(sessionId, {
          type: "turn_completed",
          worktreeId,
          threadId,
          turnId: turn.id,
          status: turn.status,
          error: turn.error || null,
          provider,
        });
        break;
      }
      case "turn/started": {
        const { turn, threadId } = message.params;
        await updateWorktreeStatus(session, worktreeId, "processing");
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
    })();
  });

  client.on("rpc_out", (payload) => {
    void (async () => {
      if (!debugApiWsLog) {
        return;
      }
      const entry = {
        direction: "stdin",
        timestamp: Date.now(),
        payload,
        provider,
        worktreeId,
      };
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });

  client.on("rpc_in", (payload) => {
    void (async () => {
      if (!debugApiWsLog) {
        return;
      }
      const entry = {
        direction: "stdout",
        timestamp: Date.now(),
        payload,
        provider,
        worktreeId,
      };
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });
}

// Attach events to a Claude client for a worktree
function attachClaudeEventsForWorktree(sessionId, worktree) {
  const client = worktree.client;
  const worktreeId = worktree.id;
  const provider = worktree.provider;

  client.on("ready", ({ threadId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      await updateWorktreeStatus(session, worktreeId, "ready");
      broadcastToSession(sessionId, {
        type: "worktree_ready",
        worktreeId,
        threadId,
        provider,
      });
    })();
  });

  client.on("log", (message) => {
    if (message) {
      console.log(`[claude:${sessionId}:wt-${worktreeId}] ${message}`);
    }
  });

  client.on("stdout_json", ({ message }) => {
    void (async () => {
      if (!debugApiWsLog) {
        return;
      }
      const entry = {
        direction: "stdout",
        timestamp: Date.now(),
        payload: message,
        provider,
        worktreeId,
      };
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });

  client.on("assistant_message", ({ id, text, turnId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      await appendWorktreeMessage(session, worktreeId, {
        id,
        role: "assistant",
        text,
        provider,
      });
      broadcastToSession(sessionId, {
        type: "assistant_message",
        worktreeId,
        text,
        itemId: id,
        turnId,
        provider,
      });
      void broadcastWorktreeDiff(sessionId, worktreeId);
    })();
  });

  client.on("command_execution_completed", (payload) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      await appendWorktreeMessage(session, worktreeId, {
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
    })();
  });

  client.on("turn_completed", ({ turnId, status }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      await updateWorktreeStatus(session, worktreeId, "ready");
      broadcastToSession(sessionId, {
        type: "turn_completed",
        worktreeId,
        turnId,
        status: status || "success",
        error: null,
        provider,
      });
    })();
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

const ensureClaudeWorktreeClients = async (session) => {
  const runtime = getSessionRuntime(session.sessionId);
  if (!runtime) {
    return;
  }
  const worktrees = await listStoredWorktrees(session);
  const claudeWorktrees = worktrees.filter((wt) => wt?.provider === "claude");
  if (!claudeWorktrees.length) {
    return;
  }
  await Promise.all(
    claudeWorktrees.map(async (worktree) => {
      let client = runtime.worktreeClients.get(worktree.id);
      if (client?.ready) {
        return;
      }
      if (!client) {
        client = createWorktreeClient(
          worktree,
          session.attachmentsDir,
          session.repoDir,
          worktree.internetAccess,
          worktree.threadId,
          session.gitDir || path.join(session.dir, "git")
        );
        runtime.worktreeClients.set(worktree.id, client);
      }
      worktree.client = client;
      if (!client.listenerCount("ready")) {
        attachClaudeEventsForWorktree(session.sessionId, worktree);
      }
      if (!client.ready) {
        try {
          await client.start();
        } catch (error) {
          console.error("Failed to start Claude worktree client:", error);
          void updateWorktreeStatus(session, worktree.id, "error");
          broadcastToSession(session.sessionId, {
            type: "worktree_status",
            worktreeId: worktree.id,
            status: "error",
            error: error?.message || "Claude CLI failed to start.",
          });
        }
      }
    })
  );
};

const ensureCodexWorktreeClients = async (session) => {
  const runtime = getSessionRuntime(session.sessionId);
  if (!runtime) {
    return;
  }
  const worktrees = await listStoredWorktrees(session);
  const codexWorktrees = worktrees.filter((wt) => wt?.provider === "codex");
  if (!codexWorktrees.length) {
    return;
  }
  await Promise.all(
    codexWorktrees.map(async (worktree) => {
      let client = runtime.worktreeClients.get(worktree.id);
      const procExited = client?.proc && client.proc.exitCode != null;
      if (procExited) {
        runtime.worktreeClients.delete(worktree.id);
        client = null;
      }
      if (!client) {
        client = createWorktreeClient(
          worktree,
          session.attachmentsDir,
          session.repoDir,
          worktree.internetAccess,
          worktree.threadId,
          session.gitDir || path.join(session.dir, "git")
        );
        runtime.worktreeClients.set(worktree.id, client);
      }
      worktree.client = client;
      if (!client.listenerCount("ready")) {
        attachClientEventsForWorktree(session.sessionId, worktree);
      }
      if (!client.ready && !client.proc) {
        try {
          await client.start();
        } catch (error) {
          console.error("Failed to start Codex worktree client:", error);
          void updateWorktreeStatus(session, worktree.id, "error");
          broadcastToSession(session.sessionId, {
            type: "worktree_status",
            worktreeId: worktree.id,
            status: "error",
            error: error?.message || "Codex app-server failed to start.",
          });
        }
      }
    })
  );
};

function attachClaudeEvents(sessionId, client, provider) {
  client.on("ready", ({ threadId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (session?.activeProvider === provider) {
        broadcastToSession(sessionId, { type: "ready", threadId, provider });
      }
    })();
  });

  client.on("log", (message) => {
    if (message) {
      console.log(`[claude:${sessionId}] ${message}`);
    }
  });

  client.on("stdout_json", ({ message }) => {
    void (async () => {
      if (!debugApiWsLog) {
        return;
      }
      const entry = {
        direction: "stdout",
        timestamp: Date.now(),
        payload: message,
        provider,
      };
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });

  client.on("assistant_message", ({ id, text, turnId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (session?.activeProvider !== provider) return;

      await appendMainMessage(session, { id, role: "assistant", text, provider });
      broadcastToSession(sessionId, {
        type: "assistant_message",
        text,
        itemId: id,
        turnId,
        provider,
      });
      void broadcastRepoDiff(sessionId);
    })();
  });

  client.on("command_execution_completed", (payload) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (session?.activeProvider !== provider) return;

      await appendMainMessage(session, {
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
    })();
  });

  client.on("turn_completed", ({ turnId, status }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (session?.activeProvider !== provider) return;

      broadcastToSession(sessionId, {
        type: "turn_completed",
        turnId,
        status: status || "success",
        error: null,
        provider,
      });
    })();
  });

  client.on("turn_error", ({ turnId, message }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (session?.activeProvider !== provider) return;

      broadcastToSession(sessionId, {
        type: "turn_error",
        turnId,
        message: message || "Claude CLI error.",
        provider,
      });
    })();
  });
}

wss.on("connection", (socket, req) => {
  void (async () => {
    attachWebSocketDebug(socket, req, "chat");
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    if (!token) {
      socket.send(JSON.stringify({ type: "error", message: "Missing workspace token." }));
      socket.close();
      return;
    }
    let workspaceId = null;
    try {
      workspaceId = verifyWorkspaceToken(token);
    } catch (error) {
      socket.send(JSON.stringify({ type: "error", message: "Invalid workspace token." }));
      socket.close();
      return;
    }
    const sessionId = url.searchParams.get("session");
    const session = await getSession(sessionId, workspaceId);
    if (!session) {
      socket.send(
        JSON.stringify({ type: "error", message: "Unknown session." })
      );
      socket.close();
      return;
    }
    await ensureWorkspaceUserExists(session.workspaceId);
    const runtime = getSessionRuntime(sessionId);
    if (!runtime) {
      socket.send(JSON.stringify({ type: "error", message: "Unknown session." }));
      socket.close();
      return;
    }
    runtime.sockets.add(socket);

    await ensureClaudeWorktreeClients(session);
    await ensureCodexWorktreeClients(session);

    if (session.activeProvider === "codex") {
      const existingClient = getActiveClient(session);
      const procExited = existingClient?.proc && existingClient.proc.exitCode != null;
      if (procExited && runtime.clients?.codex) {
        delete runtime.clients.codex;
      }
      const client = await getOrCreateClient(session, "codex");
      if (!client.listenerCount("ready")) {
        attachClientEvents(sessionId, client, "codex");
      }
      if (!client.ready && !client.proc) {
        client.start().catch((error) => {
          console.error("Failed to restart Codex app-server:", error);
          broadcastToSession(sessionId, {
            type: "error",
            message: "Codex app-server failed to start.",
          });
        });
      }
    }

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
      const session = await getSession(sessionId, workspaceId);
      if (!session) {
        socket.send(
          JSON.stringify({ type: "error", message: "Unknown session." })
        );
        return;
      }
      await touchSession(session);
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

    if (payload.type === "action_request") {
      const requestType = typeof payload.request === "string" ? payload.request : "";
      const arg = typeof payload.arg === "string" ? payload.arg.trim() : "";
      const worktreeId = payload.worktreeId || "main";
      if (!requestType || !arg) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Invalid action request.",
          })
        );
        return;
      }
      if (requestType !== "run" && requestType !== "git") {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Unsupported action request.",
          })
        );
        return;
      }
      if (requestType === "run" && !allowRunSlashCommand) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Run command disabled.",
          })
        );
        return;
      }
      if (requestType === "git" && !allowGitSlashCommand) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Git command disabled.",
          })
        );
        return;
      }
      const worktree =
        worktreeId !== "main" ? await getWorktree(session, worktreeId) : null;
      if (worktreeId !== "main" && !worktree) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Worktree not found.",
            worktreeId,
          })
        );
        return;
      }
      const targetWorktreeId = worktreeId !== "main" ? worktreeId : "main";
      const broadcastWorktreeId = targetWorktreeId === "main" ? undefined : targetWorktreeId;
      const messageId = createMessageId();
      const displayText = `/${requestType} ${arg}`.trim();
      if (targetWorktreeId === "main") {
        await appendMainMessage(session, {
          id: messageId,
          role: "user",
          type: "action_request",
          text: displayText,
          action: { request: requestType, arg },
        });
      } else {
        await appendWorktreeMessage(session, targetWorktreeId, {
          id: messageId,
          role: "user",
          type: "action_request",
          text: displayText,
          action: { request: requestType, arg },
        });
      }
      broadcastToSession(sessionId, {
        type: "action_request",
        worktreeId: broadcastWorktreeId,
        id: messageId,
        request: requestType,
        arg,
        text: displayText,
      });

      const denyGitCreds = typeof worktree?.denyGitCredentialsAccess === "boolean"
        ? worktree.denyGitCredentialsAccess
        : resolveDefaultDenyGitCredentialsAccess(session);
      const allowGitCreds = !denyGitCreds;
      const gitDir = session.gitDir || path.join(session.dir, "git");
      const sshDir = getWorkspaceSshPaths(getWorkspacePaths(session.workspaceId).homeDir).sshDir;
      const cwd = worktree?.path || session.repoDir;
      const repoDir = session.repoDir;
      let output = "";
      let status = "success";
      try {
        if (requestType === "run") {
          const wrapped = `set +e; ${arg} 2>&1; echo \"__VIBE80_EXIT_CODE:$?\"`;
          output = await runSessionCommandOutput(
            session,
            "/bin/bash",
            ["-lc", wrapped],
            {
              cwd,
              sandbox: true,
              workspaceId: session.workspaceId,
              repoDir: cwd,
              internetAccess: session.defaultInternetAccess,
              netMode: "none",
              extraAllowRw: [
                ...(allowGitCreds ? [gitDir, sshDir] : []),
                ...(repoDir ? [repoDir] : []),
              ],
            }
          );
          const marker = "__VIBE80_EXIT_CODE:";
          if (output.includes(marker)) {
            const parts = output.split(marker);
            const body = parts.slice(0, -1).join(marker);
            const exitCode = Number(parts[parts.length - 1].trim());
            output = body.trimEnd();
            if (Number.isFinite(exitCode) && exitCode !== 0) {
              status = "error";
            }
          }
        } else {
          const gitArgs = parseCommandArgs(arg);
          const result = await runSessionCommandOutputWithStatus(
            session,
            "git",
            gitArgs,
            {
              cwd,
              sandbox: true,
              workspaceId: session.workspaceId,
              repoDir: cwd,
              netMode: "tcp:22,53,443",
              extraAllowRo: [gitDir],
              extraAllowRw: [
                ...(allowGitCreds ? [gitDir, sshDir] : []),
                ...(repoDir ? [repoDir] : []),
              ],
            }
          );
          output = result.output;
          if (typeof result.code === "number" && result.code !== 0) {
            status = "error";
          }
        }
      } catch (error) {
        status = "error";
        output = error?.message || "Command failed.";
      }
      const resultId = createMessageId();
      const resultText = `\`\`\`\n${output}\n\`\`\``;
      if (targetWorktreeId === "main") {
        await appendMainMessage(session, {
          id: resultId,
          role: "assistant",
          type: "action_result",
          text: resultText,
          action: { request: requestType, arg, status, output },
        });
      } else {
        await appendWorktreeMessage(session, targetWorktreeId, {
          id: resultId,
          role: "assistant",
          type: "action_result",
          text: resultText,
          action: { request: requestType, arg, status, output },
        });
      }
      broadcastToSession(sessionId, {
        type: "action_result",
        worktreeId: broadcastWorktreeId,
        id: resultId,
        request: requestType,
        arg,
        status,
        output,
        text: resultText,
      });
      return;
    }

    if (payload.type === "backlog_view_request") {
      const worktreeId = payload.worktreeId || "main";
      const worktree =
        worktreeId !== "main" ? await getWorktree(session, worktreeId) : null;
      if (worktreeId !== "main" && !worktree) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Worktree not found.",
            worktreeId,
          })
        );
        return;
      }
      const targetWorktreeId = worktreeId !== "main" ? worktreeId : "main";
      const items = Array.isArray(session.backlog) ? session.backlog : [];
      const messageId = createMessageId();
      socket.send(
        JSON.stringify({
        type: "backlog_view",
        worktreeId: targetWorktreeId === "main" ? undefined : targetWorktreeId,
        id: messageId,
        items,
        page: 0,
        })
      );
      return;
    }

    // ============== Worktree WebSocket Handlers ==============

    // Send message to a specific worktree
    if (payload.type === "worktree_message") {
      const worktreeId = payload.worktreeId;
      const worktree = await getWorktree(session, worktreeId);

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
        await appendWorktreeMessage(session, worktreeId, {
          id: createMessageId(),
          role: "user",
          text: payload.displayText || payload.text,
          attachments: Array.isArray(payload.attachments)
            ? payload.attachments
            : [],
          provider: worktree.provider,
        });
        await updateWorktreeStatus(session, worktreeId, "processing");
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

    // Interrupt a turn in a specific worktree
    if (payload.type === "worktree_turn_interrupt") {
      const worktreeId = payload.worktreeId;
      const worktree = await getWorktree(session, worktreeId);

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
      const worktree = await getWorktree(session, worktreeId);

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

      const messages = getMessagesSince(
        worktree?.messages || [],
        payload.lastSeenMessageId || null
      );
      const status =
        worktreeId === "main"
          ? getActiveClient(session)?.ready
            ? "ready"
            : "starting"
          : worktree.status;

      socket.send(
        JSON.stringify({
          type: "worktree_messages_sync",
          worktreeId,
          messages,
          status,
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
        await appendMainMessage(session, {
          id: createMessageId(),
          role: "user",
          text: payload.displayText || payload.text,
          attachments: Array.isArray(payload.attachments)
            ? payload.attachments
            : [],
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
        const mainWorktree = await getWorktree(session, "main");
        const messages = Array.isArray(mainWorktree?.messages)
          ? mainWorktree.messages
          : [];
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
        session.activeProvider = newProvider;
        await storage.saveSession(sessionId, {
          ...session,
          activeProvider: newProvider,
          lastActivityAt: Date.now(),
        });

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
        const mainWorktree = await getWorktree(session, "main");
        const messages = Array.isArray(mainWorktree?.messages)
          ? mainWorktree.messages
          : [];
        broadcastToSession(sessionId, {
          type: "provider_switched",
          provider: newProvider,
          models,
          messages,
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
      runtime.sockets.delete(socket);
    });
  })();
});

if (terminalWss) {
  terminalWss.on("connection", (socket, req) => {
  void (async () => {
    attachWebSocketDebug(socket, req, "terminal");
    let workspaceId = null;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      if (!token) {
        socket.close();
        return;
      }
      workspaceId = verifyWorkspaceToken(token);
    } catch {
      socket.close();
      return;
    }
    req.workspaceId = workspaceId;
    const session = await getSessionFromRequest(req);
    if (!session) {
      socket.close();
      return;
    }
    await touchSession(session);
    let worktree = null;
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const worktreeId = url.searchParams.get("worktreeId");
      if (worktreeId && worktreeId !== "main") {
        worktree = await getWorktree(session, worktreeId);
      }
    } catch {
      // Ignore invalid URL parsing; fall back to main repo.
    }
    const shell = "/bin/bash";
    let term = null;
    let closed = false;

  const startTerminal = (cols = 80, rows = 24) => {
    if (term) {
      return;
    }
    const env = { ...process.env };
    const cwd = worktree?.path || session.repoDir;
    const denyGitCreds = typeof worktree?.denyGitCredentialsAccess === "boolean"
      ? worktree.denyGitCredentialsAccess
      : resolveDefaultDenyGitCredentialsAccess(session);
    const allowGitCreds = !denyGitCreds;
    const gitDir = session.gitDir || path.join(session.dir, "git");
    const sshDir = getWorkspaceSshPaths(getWorkspacePaths(session.workspaceId).homeDir).sshDir;
    if (isMonoUser) {
      term = pty.spawn(shell, [], {
        name: "xterm-256color",
        cols,
        rows,
        env: {
          ...env,
          TERM: "xterm-256color",
        },
        cwd,
      });
    } else {
      const termArgs = [
        "-n",
        runAsHelperPath,
        "--workspace-id",
        session.workspaceId,
        "--cwd",
        cwd,
        "--env",
        "TERM=xterm-256color",
        ...buildSandboxArgs({
          cwd,
          repoDir: cwd,
          workspaceId: session.workspaceId,
          internetAccess: session.defaultInternetAccess,
          netMode: "none",
          extraAllowRw: allowGitCreds ? [gitDir, sshDir] : [],
        }),
        "--",
        shell,
      ];
      term = pty.spawn(sudoPath, termArgs, {
        name: "xterm-256color",
        cols,
        rows,
        env,
      });
    }

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
  })();
  });
}

app.post("/api/workspaces", async (req, res) => {
  try {
    const providers = req.body?.providers;
    const result = await createWorkspace(providers);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to create workspace." });
  }
});

app.post("/api/workspaces/login", async (req, res) => {
  const workspaceId = req.body?.workspaceId;
  const workspaceSecret = req.body?.workspaceSecret;
  if (!workspaceId || !workspaceSecret) {
    res.status(400).json({ error: "workspaceId and workspaceSecret are required." });
    return;
  }
  if (!workspaceIdPattern.test(workspaceId)) {
    res.status(400).json({ error: "Invalid workspaceId." });
    return;
  }
  try {
    const storedSecret = await readWorkspaceSecret(workspaceId);
    if (storedSecret !== workspaceSecret) {
      await appendAuditLog(workspaceId, "workspace_login_failed");
      res.status(403).json({ error: "Invalid workspace credentials." });
      return;
    }
    await getWorkspaceUserIds(workspaceId);
    const tokens = await issueWorkspaceTokens(workspaceId);
    await appendAuditLog(workspaceId, "workspace_login_success");
    res.json(tokens);
  } catch (error) {
    await appendAuditLog(workspaceId, "workspace_login_failed");
    res.status(403).json({ error: "Invalid workspace credentials." });
  }
});

app.post("/api/workspaces/refresh", async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken || typeof refreshToken !== "string") {
    res.status(400).json({ error: "refreshToken is required." });
    return;
  }
  try {
    const tokenHash = hashRefreshToken(refreshToken);
    const record = await storage.getWorkspaceRefreshToken(tokenHash);
    if (!record?.workspaceId) {
      res.status(401).json({ error: "Invalid refresh token." });
      return;
    }
    if (record.expiresAt && record.expiresAt <= Date.now()) {
      await storage.deleteWorkspaceRefreshToken(tokenHash);
      res.status(401).json({ error: "Refresh token expired." });
      return;
    }
    await storage.deleteWorkspaceRefreshToken(tokenHash);
    const tokens = await issueWorkspaceTokens(record.workspaceId);
    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: "Failed to refresh workspace token." });
  }
});

app.patch("/api/workspaces/:workspaceId", async (req, res) => {
  const workspaceId = req.params.workspaceId;
  if (!workspaceIdPattern.test(workspaceId)) {
    res.status(400).json({ error: "Invalid workspaceId." });
    return;
  }
  if (req.workspaceId && req.workspaceId !== workspaceId) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }
  try {
    const providers = req.body?.providers;
    const payload = await updateWorkspace(workspaceId, providers);
    res.json({ workspaceId, providers: payload.providers });
  } catch (error) {
    res.status(400).json({ error: error.message || "Failed to update workspace." });
  }
});

app.delete("/api/workspaces/:workspaceId", async (req, res) => {
  const workspaceId = req.params.workspaceId;
  if (!workspaceIdPattern.test(workspaceId)) {
    res.status(400).json({ error: "Invalid workspaceId." });
    return;
  }
  if (req.workspaceId && req.workspaceId !== workspaceId) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }
  res.status(501).json({ error: "Workspace deletion policy not implemented yet." });
});

app.get("/api/health", async (req, res) => {
  const session = await getSession(req.query.session, req.workspaceId);
  if (!session) {
    res.json({ ok: true, ready: false, threadId: null, deploymentMode });
    return;
  }
  await touchSession(session);
  const activeClient = getActiveClient(session);
  res.json({
    ok: true,
    ready: activeClient?.ready || false,
    threadId: activeClient?.threadId || null,
    provider: session.activeProvider || "codex",
    deploymentMode,
  });
});

app.get("/api/sessions", (req, res) => {
  const workspaceId = req.workspaceId;
  storage
    .listSessions(workspaceId)
    .then((sessions) => {
      const payload = sessions.map((session) => ({
        sessionId: session.sessionId,
        repoUrl: session.repoUrl || "",
        name: session.name || "",
        createdAt: session.createdAt || null,
        lastActivityAt: session.lastActivityAt || null,
        activeProvider: session.activeProvider || null,
      }));
      payload.sort((a, b) => {
        const aTime = a.lastActivityAt || a.createdAt || 0;
        const bTime = b.lastActivityAt || b.createdAt || 0;
        return bTime - aTime;
      });
      res.json({ sessions: payload });
    })
    .catch((error) => {
      res.status(500).json({ error: error?.message || "Failed to list sessions." });
    });
});

app.post("/api/sessions/handoff", async (req, res) => {
  const sessionId = req.body?.sessionId;
  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "Session ID required.", error_type: "SESSION_ID_REQUIRED" });
    return;
  }
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found.", error_type: "SESSION_NOT_FOUND" });
    return;
  }
  const record = createHandoffToken(session);
  res.json({ handoffToken: record.token, expiresAt: record.expiresAt });
});

app.post("/api/sessions/handoff/consume", async (req, res) => {
  const handoffToken = req.body?.handoffToken;
  if (!handoffToken || typeof handoffToken !== "string") {
    res.status(400).json({ error: "Handoff token required.", error_type: "HANDOFF_TOKEN_REQUIRED" });
    return;
  }
  const record = handoffTokens.get(handoffToken);
  if (!record) {
    res.status(404).json({ error: "Handoff token not found.", error_type: "HANDOFF_TOKEN_INVALID" });
    return;
  }
  if (record.usedAt) {
    res.status(409).json({ error: "Handoff token already used.", error_type: "HANDOFF_TOKEN_USED" });
    return;
  }
  if (record.expiresAt && record.expiresAt <= Date.now()) {
    handoffTokens.delete(handoffToken);
    res.status(410).json({ error: "Handoff token expired.", error_type: "HANDOFF_TOKEN_EXPIRED" });
    return;
  }
  const session = await getSession(record.sessionId, record.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found.", error_type: "SESSION_NOT_FOUND" });
    return;
  }
  record.usedAt = Date.now();
  const tokens = await issueWorkspaceTokens(record.workspaceId);
  res.json({
    workspaceId: record.workspaceId,
    workspaceToken: tokens.workspaceToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    refreshExpiresIn: tokens.refreshExpiresIn,
    sessionId: record.sessionId,
  });
});

app.get("/api/session/:sessionId", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  const repoDiff = await getRepoDiff(session);
  const activeProvider = session.activeProvider || "codex";
  res.json({
    sessionId: req.params.sessionId,
    workspaceId: session.workspaceId,
    path: session.dir,
    repoUrl: session.repoUrl,
    name: session.name || "",
    default_provider: activeProvider,
    providers: session.providers || [activeProvider],
    defaultInternetAccess:
      typeof session.defaultInternetAccess === "boolean"
        ? session.defaultInternetAccess
        : true,
    defaultDenyGitCredentialsAccess: resolveDefaultDenyGitCredentialsAccess(session),
    repoDiff,
    rpcLogsEnabled: debugApiWsLog,
    rpcLogs: debugApiWsLog ? session.rpcLogs || [] : [],
    terminalEnabled,
  });
});

app.delete("/api/session/:sessionId", async (req, res) => {
  const sessionId = req.params.sessionId;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  try {
    await cleanupSession(sessionId, "user_request");
    res.json({ ok: true, sessionId });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete session." });
  }
});

app.get("/api/session/:sessionId/last-commit", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  try {
    const [branch, commit] = await Promise.all([
      getCurrentBranch(session),
      getLastCommit(session, session.repoDir),
    ]);
    res.json({ branch, commit });
  } catch (error) {
    res.status(500).json({ error: "Failed to load last commit." });
  }
});

app.get("/api/session/:sessionId/rpc-logs", async (req, res) => {
  if (!debugApiWsLog) {
    res.status(403).json({ error: "Forbidden." });
    return;
  }
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  res.json({ rpcLogs: session.rpcLogs || [] });
});

const readGitConfigValue = async (session, args) => {
  try {
    const output = await runSessionCommandOutput(session, "git", args);
    return output.trim();
  } catch (error) {
    return "";
  }
};

app.get("/api/session/:sessionId/git-identity", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  try {
    const [globalName, globalEmail, repoName, repoEmail] = await Promise.all([
      readGitConfigValue(session, ["config", "--global", "--get", "user.name"]),
      readGitConfigValue(session, ["config", "--global", "--get", "user.email"]),
      readGitConfigValue(session, [
        "-C",
        session.repoDir,
        "config",
        "--get",
        "user.name",
      ]),
      readGitConfigValue(session, [
        "-C",
        session.repoDir,
        "config",
        "--get",
        "user.email",
      ]),
    ]);
    const effectiveName = repoName || globalName;
    const effectiveEmail = repoEmail || globalEmail;
    res.json({
      global: { name: globalName || "", email: globalEmail || "" },
      repo: { name: repoName || "", email: repoEmail || "" },
      effective: { name: effectiveName || "", email: effectiveEmail || "" },
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to read git identity." });
  }
});

app.post("/api/session/:sessionId/git-identity", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
  if (!name || !email) {
    res.status(400).json({ error: "name and email are required." });
    return;
  }
  try {
    await runSessionCommand(session, "git", [
      "-C",
      session.repoDir,
      "config",
      "user.name",
      name,
    ]);
    await runSessionCommand(session, "git", [
      "-C",
      session.repoDir,
      "config",
      "user.email",
      email,
    ]);
    res.json({ ok: true, repo: { name, email } });
  } catch (error) {
    res.status(500).json({ error: "Failed to update git identity." });
  }
});

app.get("/api/session/:sessionId/diff", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  const repoDiff = await getRepoDiff(session);
  res.json(repoDiff);
});

app.post("/api/session/:sessionId/clear", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  const worktreeId = req.body?.worktreeId;
  if (worktreeId) {
    const worktree = await getWorktree(session, worktreeId);
    if (!worktree) {
      res.status(404).json({ error: "Worktree not found." });
      return;
    }
    await clearWorktreeMessages(session, worktreeId);
    res.json({ ok: true, worktreeId });
    return;
  }
  await clearWorktreeMessages(session, "main");
  res.json({ ok: true, worktreeId: "main" });
});

app.post("/api/session/:sessionId/backlog", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text) {
    res.status(400).json({ error: "text is required." });
    return;
  }
  await touchSession(session);
  const item = {
    id: createMessageId(),
    text,
    createdAt: Date.now(),
    done: false,
  };
  const backlog = Array.isArray(session.backlog) ? session.backlog : [];
  const updated = {
    ...session,
    backlog: [item, ...backlog],
    lastActivityAt: Date.now(),
  };
  await storage.saveSession(session.sessionId, updated);
  res.json({ ok: true, item });
});

app.get("/api/session/:sessionId/backlog", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  const backlog = Array.isArray(session.backlog) ? session.backlog : [];
  res.json({ items: backlog });
});

app.patch("/api/session/:sessionId/backlog", async (req, res) => {
  const session = await getSession(req.params.sessionId, req.workspaceId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  const itemId = typeof req.body?.id === "string" ? req.body.id.trim() : "";
  if (!itemId) {
    res.status(400).json({ error: "id is required." });
    return;
  }
  if (typeof req.body?.done !== "boolean") {
    res.status(400).json({ error: "done is required." });
    return;
  }
  await touchSession(session);
  const backlog = Array.isArray(session.backlog) ? session.backlog : [];
  const index = backlog.findIndex((item) => item?.id === itemId);
  if (index === -1) {
    res.status(404).json({ error: "Backlog item not found." });
    return;
  }
  const updatedItem = {
    ...backlog[index],
    done: req.body.done,
    doneAt: req.body.done ? Date.now() : null,
  };
  const updatedBacklog = [...backlog];
  updatedBacklog[index] = updatedItem;
  const updatedSession = {
    ...session,
    backlog: updatedBacklog,
    lastActivityAt: Date.now(),
  };
  await storage.saveSession(session.sessionId, updatedSession);
  res.json({ ok: true, item: updatedItem });
});

app.post("/api/session", async (req, res) => {
  const repoUrl = req.body?.repoUrl;
  if (!repoUrl) {
    res.status(400).json({ error: "repoUrl is required." });
    return;
  }
  try {
    await ensureWorkspaceUserExists(req.workspaceId);
    const auth = req.body?.auth || null;
    const defaultInternetAccess = req.body?.defaultInternetAccess;
    const defaultDenyGitCredentialsAccess =
      typeof req.body?.defaultDenyGitCredentialsAccess === "boolean"
        ? req.body.defaultDenyGitCredentialsAccess
        : undefined;
    const name = req.body?.name;
    const session = await createSession(
      req.workspaceId,
      repoUrl,
      auth,
      defaultInternetAccess,
      defaultDenyGitCredentialsAccess,
      name
    );
    res.json({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      path: session.dir,
      repoUrl,
      name: session.name || "",
      default_provider: session.activeProvider || "codex",
      providers: session.providers || [],
      defaultInternetAccess:
        typeof session.defaultInternetAccess === "boolean"
          ? session.defaultInternetAccess
          : true,
      defaultDenyGitCredentialsAccess: resolveDefaultDenyGitCredentialsAccess(session),
      messages: [],
      rpcLogsEnabled: debugApiWsLog,
      terminalEnabled,
    });
  } catch (error) {
    console.error("Failed to create session for repo:", {
      repoUrl,
      error: error?.message || error,
    });
    const classified = classifySessionCreationError(error);
    res.status(classified.status).json({ error: classified.error });
  }
});

app.get("/api/branches", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
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

app.get("/api/models", async (req, res) => {
  const session = await getSession(req.query?.session, req.workspaceId);
  const provider = req.query?.provider;
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  await touchSession(session);
  if (!isValidProvider(provider)) {
    res.status(400).json({ error: "Invalid provider. Must be 'codex' or 'claude'." });
    return;
  }
  if (
    Array.isArray(session.providers) &&
    session.providers.length &&
    !session.providers.includes(provider)
  ) {
    res.status(403).json({ error: "Provider not enabled for this session." });
    return;
  }

  try {
    const client = await getOrCreateClient(session, provider);
    if (!client.ready) {
      await client.start();
    }
    let cursor = null;
    const models = [];
    do {
      const result = await client.listModels(cursor, 200);
      if (Array.isArray(result?.data)) {
        models.push(...result.data);
      }
      cursor = result?.nextCursor ?? null;
    } while (cursor);
    res.json({ models, provider });
  } catch (error) {
    res.status(500).json({ error: error.message || "Failed to list models." });
  }
});

app.post("/api/branches/switch", async (req, res) => {
  const sessionId = req.body?.session;
  const target = req.body?.branch;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "Branch is required." });
    return;
  }
  const branchName = target.replace(/^origin\//, "").trim();
  try {
    const dirty = await runSessionCommandOutput(session, "git", ["status", "--porcelain"], {
      cwd: session.repoDir,
    });
    if (dirty.trim()) {
      res.status(409).json({
        error: "Modifications locales detectees. Stashez ou committez avant.",
      });
      return;
    }

    try {
      await runSessionCommand(session, "git", ["check-ref-format", "--branch", branchName], {
        cwd: session.repoDir,
      });
    } catch (error) {
      res.status(400).json({ error: "Nom de branche invalide." });
      return;
    }
    await runSessionCommand(session, "git", ["fetch", "--prune"], {
      cwd: session.repoDir,
    });

    let switched = false;
    try {
      await runSessionCommand(session, "git", ["show-ref", "--verify", `refs/heads/${branchName}`], {
        cwd: session.repoDir,
      });
      await runSessionCommand(session, "git", ["switch", branchName], {
        cwd: session.repoDir,
      });
      switched = true;
    } catch (error) {
      // ignore and try remote
    }

    if (!switched) {
      try {
        await runSessionCommand(
          session,
          "git",
          ["show-ref", "--verify", `refs/remotes/origin/${branchName}`],
          { cwd: session.repoDir }
        );
      } catch (error) {
        res.status(404).json({ error: "Branche introuvable." });
        return;
      }
      await runSessionCommand(session, "git", ["switch", "--track", `origin/${branchName}`], {
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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  try {
    const worktrees = await listWorktrees(session);
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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

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
    const internetAccess =
      typeof req.body?.internetAccess === "boolean"
        ? req.body.internetAccess
        : typeof session.defaultInternetAccess === "boolean"
          ? session.defaultInternetAccess
          : true;
    const denyGitCredentialsAccess =
      typeof req.body?.denyGitCredentialsAccess === "boolean"
        ? req.body.denyGitCredentialsAccess
        : resolveDefaultDenyGitCredentialsAccess(session);
    const worktree = await createWorktree(session, {
      provider,
      name: req.body?.name || null,
      parentWorktreeId: req.body?.parentWorktreeId || null,
      startingBranch: req.body?.startingBranch || null,
      internetAccess,
      denyGitCredentialsAccess,
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
        void updateWorktreeStatus(session, worktree.id, "error");
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
      internetAccess: Boolean(worktree.internetAccess),
      denyGitCredentialsAccess:
        typeof worktree.denyGitCredentialsAccess === "boolean"
          ? worktree.denyGitCredentialsAccess
          : true,
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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

  const worktree = await getWorktree(session, req.params.worktreeId);
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
      model: worktree.model || null,
      reasoningEffort: worktree.reasoningEffort || null,
      internetAccess: Boolean(worktree.internetAccess),
      denyGitCredentialsAccess:
        typeof worktree.denyGitCredentialsAccess === "boolean"
          ? worktree.denyGitCredentialsAccess
          : true,
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

app.get("/api/worktree/:worktreeId/tree", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  const { rootPath } = await resolveWorktreeRoot(session, req.params.worktreeId);
  if (!rootPath) {
    res.status(404).json({ error: "Worktree not found." });
    return;
  }
  try {
    const payload = await buildDirectoryTree(session.workspaceId, rootPath, {
      maxDepth: req.query?.depth,
      maxEntries: req.query?.limit,
    });
    res.json(payload);
  } catch (error) {
    console.error("Failed to read worktree tree:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to read worktree tree." });
  }
});

app.get("/api/worktree/:worktreeId/file", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  const { rootPath } = await resolveWorktreeRoot(session, req.params.worktreeId);
  if (!rootPath) {
    res.status(404).json({ error: "Worktree not found." });
    return;
  }
  const requestedPath = req.query?.path;
  if (!requestedPath || typeof requestedPath !== "string") {
    res.status(400).json({ error: "Path is required." });
    return;
  }
  const absPath = path.resolve(rootPath, requestedPath);
  const relative = path.relative(rootPath, absPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    res.status(400).json({ error: "Invalid path." });
    return;
  }
  try {
    const { buffer, truncated } = await readWorkspaceFileBuffer(
      session.workspaceId,
      absPath,
      MAX_FILE_BYTES
    );
    const binary = buffer.includes(0);
    const content = binary ? "" : buffer.toString("utf8");
    res.json({ path: requestedPath, content, truncated, binary });
  } catch (error) {
    console.error("Failed to read file:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      path: requestedPath,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to read file." });
  }
});

app.post("/api/worktree/:worktreeId/file", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  const { rootPath } = await resolveWorktreeRoot(session, req.params.worktreeId);
  if (!rootPath) {
    res.status(404).json({ error: "Worktree not found." });
    return;
  }
  const requestedPath = req.body?.path;
  const content = req.body?.content;
  if (!requestedPath || typeof requestedPath !== "string") {
    res.status(400).json({ error: "Path is required." });
    return;
  }
  if (typeof content !== "string") {
    res.status(400).json({ error: "Content must be a string." });
    return;
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_WRITE_BYTES) {
    res.status(400).json({ error: "File too large to write." });
    return;
  }
  const absPath = path.resolve(rootPath, requestedPath);
  const relative = path.relative(rootPath, absPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    res.status(400).json({ error: "Invalid path." });
    return;
  }
  try {
    await writeWorkspaceFilePreserveMode(session.workspaceId, absPath, content);
    res.json({ ok: true, path: requestedPath });
  } catch (error) {
    console.error("Failed to write file:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      path: requestedPath,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to write file." });
  }
});

app.get("/api/worktree/:worktreeId/status", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  const { rootPath } = await resolveWorktreeRoot(session, req.params.worktreeId);
  if (!rootPath) {
    res.status(404).json({ error: "Worktree not found." });
    return;
  }
  try {
    const output = await runSessionCommandOutput(session, "git", ["status", "--porcelain"], {
      cwd: rootPath,
    });
    const entries = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .map((line) => {
        const isUntracked = line.startsWith("??");
        let rawPath = line.slice(3);
        if (rawPath.includes(" -> ")) {
          rawPath = rawPath.split(" -> ").pop();
        }
        if (rawPath.startsWith("\"") && rawPath.endsWith("\"")) {
          rawPath = rawPath
            .slice(1, -1)
            .replace(/\\"/g, "\"")
            .replace(/\\\\/g, "\\");
        }
        return {
          path: rawPath,
          type: isUntracked ? "untracked" : "modified",
        };
      });
    res.json({ entries });
  } catch (error) {
    console.error("Failed to read worktree status:", {
      sessionId,
      worktreeId: req.params.worktreeId,
      error: error?.message || error,
    });
    res.status(500).json({ error: "Failed to read worktree status." });
  }
});

app.delete("/api/worktree/:worktreeId", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

  const worktree = await getWorktree(session, req.params.worktreeId);
  if (!worktree) {
    res.status(404).json({ error: "Worktree not found." });
    return;
  }

  if (req.body?.name) {
    await renameWorktree(session, req.params.worktreeId, req.body.name);
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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

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
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);

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

app.get("/api/attachments/file", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  const rawPath = req.query.path;
  const rawName = req.query.name;
  if (!rawPath && !rawName) {
    res.status(400).json({ error: "Attachment path is required." });
    return;
  }
  const candidatePath = rawPath
    ? path.resolve(rawPath)
    : path.resolve(session.attachmentsDir, sanitizeFilename(rawName));
  const relative = path.relative(session.attachmentsDir, candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.status(400).json({ error: "Invalid attachment path." });
    return;
  }
  try {
    const data = await runAsCommandOutput(session.workspaceId, "/bin/cat", [candidatePath], {
      binary: true,
    });
    if (rawName) {
      res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(rawName)}"`);
    }
    res.send(data);
  } catch (error) {
    res.status(404).json({ error: "Attachment not found." });
  }
});

app.get("/api/attachments", async (req, res) => {
  const sessionId = req.query.session;
  const session = await getSession(sessionId, req.workspaceId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  await touchSession(session);
  try {
    const output = await runAsCommandOutput(
      session.workspaceId,
      "/usr/bin/find",
      [session.attachmentsDir, "-maxdepth", "1", "-mindepth", "1", "-type", "f", "-printf", "%f\t%s\0"],
      { binary: true }
    );
    const files = output
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [name, sizeRaw] = line.split("\t");
        return {
          name,
          path: path.join(session.attachmentsDir, name),
          size: Number.parseInt(sizeRaw, 10),
        };
      });
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
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);
    const uploaded = [];
    for (const file of req.files || []) {
      const targetPath = path.join(session.attachmentsDir, file.filename);
      const inputStream = fs.createReadStream(file.path);
      await runAsCommand(session.workspaceId, "/usr/bin/tee", [targetPath], {
        input: inputStream,
      });
      await fs.promises.rm(file.path, { force: true });
      uploaded.push({
        name: file.filename,
        path: targetPath,
        size: file.size,
      });
    }
    res.json({ files: uploaded });
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

setInterval(() => {
  runSessionGc().catch((error) => {
    console.error("Session GC failed:", error?.message || error);
  });
}, sessionGcIntervalMs);
setInterval(() => {
  cleanupHandoffTokens();
}, 30 * 1000);
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (url.pathname === "/terminal") {
    if (!terminalEnabled || !terminalWss) {
      socket.destroy();
      return;
    }
    terminalWss.handleUpgrade(req, socket, head, (ws) => {
      terminalWss.emit("connection", ws, req);
    });
    return;
  }
  socket.destroy();
});
