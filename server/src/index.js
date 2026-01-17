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
import { CodexAppServerClient } from "./codexClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

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

const createSession = async (repoUrl) => {
  while (true) {
    const sessionId = crypto.randomBytes(12).toString("hex");
    const dir = path.join(os.tmpdir(), sessionId);
    try {
      await fs.promises.mkdir(dir, { recursive: false });
      const repoDir = path.join(dir, "repository");
      await runCommand("git", ["clone", repoUrl, repoDir]);
      const client = new CodexAppServerClient({ cwd: repoDir });
      sessions.set(sessionId, {
        dir,
        repoDir,
        repoUrl,
        client,
        sockets: new Set(),
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
      await fs.promises.rm(dir, { recursive: true, force: true });
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
};

const getSession = (sessionId) =>
  sessionId ? sessions.get(sessionId) || null : null;

const sanitizeFilename = (originalName) =>
  path.basename(originalName || "attachment");

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
          broadcastToSession(sessionId, {
            type: "assistant_message",
            text: item.text,
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
  });

  socket.on("close", () => {
    session.sockets.delete(socket);
  });
});

const distPath = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

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

app.post("/api/session", async (req, res) => {
  const repoUrl = req.body?.repoUrl;
  if (!repoUrl) {
    res.status(400).json({ error: "repoUrl is required." });
    return;
  }
  try {
    const session = await createSession(repoUrl);
    res.json({ sessionId: session.sessionId, path: session.dir });
  } catch (error) {
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

const port = process.env.PORT || 5179;
server.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`);
});
