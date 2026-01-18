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
const wss = new WebSocketServer({ server, path: "/ws" });
const terminalWss = new WebSocketServer({ server, path: "/terminal" });

const cwd = process.cwd();
const sessions = new Map();

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

const ensureKnownHost = async (repoUrl) => {
  const host = resolveRepoHost(repoUrl);
  if (!host) {
    return;
  }
  await runCommand("sh", [
    "-c",
    `mkdir -p /home/app/.ssh && ssh-keyscan -H ${host} >> /home/app/.ssh/known_hosts 2>/dev/null || true`,
  ]);
};

const createSession = async (repoUrl) => {
  while (true) {
    const sessionId = crypto.randomBytes(12).toString("hex");
    const dir = path.join(os.tmpdir(), sessionId);
    try {
      await fs.promises.mkdir(dir, { recursive: false });
      const repoDir = path.join(dir, "repository");
      await ensureKnownHost(repoUrl);
      await runCommand("git", ["clone", repoUrl, repoDir]);
      const client = new CodexAppServerClient({ cwd: repoDir });
      sessions.set(sessionId, {
        dir,
        repoDir,
        repoUrl,
        client,
        sockets: new Set(),
        messages: [],
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

const ensureUniqueFilename = async (dir, filename) => {
  const extension = path.extname(filename);
  const base = path.basename(filename, extension);
  let candidate = filename;
  let counter = 1;
  while (true) {
    try {
      await fs.promises.access(path.join(dir, candidate));
      candidate = `${base}-${counter}${extension}`;
      counter += 1;
    } catch (error) {
      if (error.code === "ENOENT") {
        return candidate;
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
      cb(null, session.dir);
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
        const uniqueName = await ensureUniqueFilename(session.dir, safeName);
        cb(null, uniqueName);
      } catch (error) {
        cb(error);
      }
    },
  }),
  limits: { files: 20, fileSize: 50 * 1024 * 1024 },
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
      default:
        break;
    }
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
  });
});

app.post("/api/session", async (req, res) => {
  const repoUrl = req.body?.repoUrl;
  if (!repoUrl) {
    res.status(400).json({ error: "repoUrl is required." });
    return;
  }
  try {
    const session = await createSession(repoUrl);
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

app.get("/api/attachments", async (req, res) => {
  const sessionId = req.query.session;
  const session = getSession(sessionId);
  if (!session) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  try {
    const entries = await fs.promises.readdir(session.dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(session.dir, entry.name);
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
