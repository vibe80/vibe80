import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import multer from "multer";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import { CodexAppServerClient } from "./codexClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const cwd = process.cwd();
const client = new CodexAppServerClient({ cwd });
const sockets = new Set();
const attachmentSessions = new Map();

const ensureUniqueSessionDir = async () => {
  while (true) {
    const sessionId = crypto.randomBytes(12).toString("hex");
    const dir = path.join(os.tmpdir(), sessionId);
    try {
      await fs.promises.mkdir(dir, { recursive: false });
      attachmentSessions.set(sessionId, dir);
      return { sessionId, dir };
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
    }
  }
};

const resolveSessionDir = (sessionId) => {
  if (!sessionId) {
    return null;
  }
  return attachmentSessions.get(sessionId) || null;
};

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
      const dir = resolveSessionDir(sessionId);
      if (!dir) {
        cb(new Error("Invalid session."));
        return;
      }
      cb(null, dir);
    },
    filename: async (req, file, cb) => {
      const sessionId = req.query.session;
      const dir = resolveSessionDir(sessionId);
      if (!dir) {
        cb(new Error("Invalid session."));
        return;
      }
      try {
        const safeName = sanitizeFilename(file.originalname);
        const uniqueName = await ensureUniqueFilename(dir, safeName);
        cb(null, uniqueName);
      } catch (error) {
        cb(error);
      }
    },
  }),
  limits: { files: 20, fileSize: 50 * 1024 * 1024 },
});

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(message);
    }
  }
}

client.on("ready", ({ threadId }) => {
  broadcast({ type: "ready", threadId });
});

client.on("log", (message) => {
  if (message) {
    console.log(`[codex] ${message}`);
  }
});

client.on("exit", ({ code, signal }) => {
  broadcast({ type: "error", message: "Codex app-server stopped." });
  console.error("Codex app-server stopped.", { code, signal });
});

client.on("notification", (message) => {
  switch (message.method) {
    case "item/agentMessage/delta": {
      const { delta, itemId, turnId } = message.params;
      broadcast({ type: "assistant_delta", delta, itemId, turnId });
      break;
    }
    case "item/completed": {
      const { item, turnId } = message.params;
      if (item?.type === "agentMessage") {
        broadcast({
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
      broadcast({
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
      broadcast({
        type: "turn_started",
        threadId,
        turnId: turn.id,
        status: turn.status,
      });
      break;
    }
    case "item/started": {
      const { item, turnId, threadId } = message.params;
      broadcast({
        type: "item_started",
        threadId,
        turnId,
        item,
      });
      break;
    }
    case "error": {
      const { error, threadId, turnId, willRetry } = message.params;
      broadcast({
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

wss.on("connection", (socket) => {
  sockets.add(socket);

  if (client.ready && client.threadId) {
    socket.send(JSON.stringify({ type: "ready", threadId: client.threadId }));
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
      if (!client.ready) {
        socket.send(
          JSON.stringify({
            type: "error",
            message: "Codex app-server not ready yet.",
          })
        );
        return;
      }

      try {
        const result = await client.sendTurn(payload.text);
        socket.send(
          JSON.stringify({
            type: "turn_started",
            turnId: result.turn.id,
            threadId: client.threadId,
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
    sockets.delete(socket);
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
  res.json({ ok: true, ready: client.ready, threadId: client.threadId });
});

app.post("/api/attachments/session", async (req, res) => {
  try {
    const session = await ensureUniqueSessionDir();
    res.json({ sessionId: session.sessionId, path: session.dir });
  } catch (error) {
    res.status(500).json({ error: "Failed to create attachment session." });
  }
});

app.get("/api/attachments", async (req, res) => {
  const sessionId = req.query.session;
  const dir = resolveSessionDir(sessionId);
  if (!dir) {
    res.status(400).json({ error: "Invalid session." });
    return;
  }
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(dir, entry.name);
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
    const dir = resolveSessionDir(sessionId);
    if (!dir) {
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
  try {
    await client.start();
  } catch (error) {
    console.error("Failed to start Codex app-server:", error);
  }
});
