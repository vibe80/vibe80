import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
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

const port = process.env.PORT || 5179;
server.listen(port, async () => {
  console.log(`Server listening on http://localhost:${port}`);
  try {
    await client.start();
  } catch (error) {
    console.error("Failed to start Codex app-server:", error);
  }
});
