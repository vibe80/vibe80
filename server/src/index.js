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

const createSession = async (repoUrl, auth) => {
  while (true) {
    const sessionId = crypto.randomBytes(12).toString("hex");
    const dir = path.join(os.tmpdir(), sessionId);
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
      const client = new CodexAppServerClient({ cwd: repoDir });
      sessions.set(sessionId, {
        dir,
        attachmentsDir,
        repoDir,
        repoUrl,
        client,
        sockets: new Set(),
        messages: [],
        rpcLogs: [],
      });
      attachClientEvents(sessionId, client);
      client.start().catch((error) => {
        console.error("Failed to start Codex app-server:", error);
        broadcastToSession(sessionId, {
          type: "error",
          message: "Codex app-server failed to start.",
        });
      });
      return { sessionId, dir };
    } catch (error) {
      console.error("Session creation failed:", {
        repoUrl,
        sessionDir: dir,
        error: error?.message || error,
      });
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
  session.messages.push(message);
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

function attachClientEvents(sessionId, client) {
  client.on("ready", ({ threadId }) => {
    broadcastToSession(sessionId, { type: "ready", threadId });
  });

  client.on("log", (message) => {
    if (message) {
      console.log(`[codex:${sessionId}] ${message}`);
    }
  });

  client.on("exit", ({ code, signal }) => {
    broadcastToSession(sessionId, {
      type: "error",
      message: "Codex app-server stopped.",
    });
    console.error("Codex app-server stopped.", { code, signal, sessionId });
  });

  client.on("notification", (message) => {
    switch (message.method) {
      case "item/agentMessage/delta": {
        const { delta, itemId, turnId } = message.params;
        broadcastToSession(sessionId, { type: "assistant_delta", delta, itemId, turnId });
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
          });
          broadcastToSession(sessionId, {
            type: "assistant_message",
            text: item.text,
            itemId: item.id,
            turnId,
          });
          void broadcastRepoDiff(sessionId);
        }
        if (item?.type === "commandExecution") {
          broadcastToSession(sessionId, {
            type: "command_execution_completed",
            item,
            itemId: item.id,
            turnId,
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
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
  });

  client.on("rpc_in", (payload) => {
    const entry = {
      direction: "stdout",
      timestamp: Date.now(),
      payload,
    };
    appendRpcLog(sessionId, entry);
    broadcastToSession(sessionId, { type: "rpc_log", entry });
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

  if (session.client.ready && session.client.threadId) {
    socket.send(
      JSON.stringify({ type: "ready", threadId: session.client.threadId })
    );
  } else {
    socket.send(JSON.stringify({ type: "status", message: "Starting Codex..." }));
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

    if (payload.type === "user_message") {
      if (!session.client.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Codex app-server not ready yet.",
          })
        );
        return;
      }

      try {
        const result = await session.client.sendTurn(payload.text);
        appendSessionMessage(sessionId, {
          id: createMessageId(),
          role: "user",
          text: payload.displayText || payload.text,
        });
        socket.send(
          JSON.stringify({
            type: "turn_started",
            turnId: result.turn.id,
            threadId: session.client.threadId,
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
      if (!session.client.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Codex app-server not ready yet.",
          })
        );
        return;
      }
      try {
        await session.client.interruptTurn(payload.turnId);
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
      if (!session.client.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Codex app-server not ready yet.",
          })
        );
        return;
      }
      try {
        let cursor = null;
        const models = [];
        do {
          const result = await session.client.listModels(cursor, 200);
          if (Array.isArray(result?.data)) {
            models.push(...result.data);
          }
          cursor = result?.nextCursor ?? null;
        } while (cursor);
        socket.send(JSON.stringify({ type: "model_list", models }));
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
      if (!session.client.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Codex app-server not ready yet.",
          })
        );
        return;
      }
      try {
        await session.client.setDefaultModel(
          payload.model || null,
          payload.reasoningEffort ?? null
        );
        socket.send(
          JSON.stringify({
            type: "model_set",
            model: payload.model || null,
            reasoningEffort: payload.reasoningEffort ?? null,
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
      if (!session.client.ready) {
        socket.send(
          JSON.stringify({
            type: "account_login_error",
            message: "Codex app-server not ready yet.",
          })
        );
        return;
      }
      try {
        const result = await session.client.startAccountLogin(payload.params);
        socket.send(
          JSON.stringify({
            type: "account_login_started",
            result,
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
  res.json({
    ok: true,
    ready: session.client.ready,
    threadId: session.client.threadId,
  });
});

app.get("/api/session/:sessionId", async (req, res) => {
  const session = getSession(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found." });
    return;
  }
  const repoDiff = await getRepoDiff(session);
  res.json({
    sessionId: req.params.sessionId,
    path: session.dir,
    repoUrl: session.repoUrl,
    messages: session.messages,
    repoDiff,
    rpcLogs: session.rpcLogs || [],
  });
});

app.post("/api/session", async (req, res) => {
  const repoUrl = req.body?.repoUrl;
  if (!repoUrl) {
    res.status(400).json({ error: "repoUrl is required." });
    return;
  }
  try {
    const auth = req.body?.auth || null;
    const session = await createSession(repoUrl, auth);
    res.json({
      sessionId: session.sessionId,
      path: session.dir,
      repoUrl,
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
