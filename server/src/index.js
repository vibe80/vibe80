import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import * as pty from "node-pty";
import storage from "./storage/index.js";
import { getSessionRuntime } from "./runtimeStore.js";
import {
  buildSandboxArgs,
  runAsCommand,
} from "./runAs.js";
import {
  getOrCreateClient,
  getActiveClient,
  isValidProvider,
  createWorktreeClient,
} from "./clientFactory.js";
import {
  listStoredWorktrees,
  getWorktree,
  updateWorktreeStatus,
  appendWorktreeMessage,
} from "./worktreeManager.js";
import {
  attachCodexEvents,
  attachClaudeEvents as attachClaudeEventsImpl,
} from "./clientEvents.js";
import { createMessageId, getSessionTmpDir } from "./helpers.js";
import { verifyWorkspaceToken } from "./middleware/auth.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorTypesMiddleware } from "./middleware/errorTypes.js";
import { attachWebSocketDebug, debugMiddleware, debugApiWsLog } from "./middleware/debug.js";
import { cleanupHandoffTokens } from "./services/auth.js";
import {
  ensureDefaultMonoWorkspace,
  isMonoUser,
  getWorkspacePaths,
  getWorkspaceSshPaths,
  ensureWorkspaceUserExists,
} from "./services/workspace.js";
import {
  getSession,
  touchSession,
  getSessionFromRequest,
  createSession,
  cleanupSession,
  runSessionGc,
  broadcastToSession,
  broadcastRepoDiff,
  broadcastWorktreeDiff,
  appendMainMessage,
  getMessagesSince,
  appendRpcLog,
  getProviderLabel,
  resolveDefaultDenyGitCredentialsAccess,
  sessionGcIntervalMs,
  updateWorktreeThreadId,
} from "./services/session.js";
import healthRoutes from "./routes/health.js";
import workspaceRoutes from "./routes/workspaces.js";
import sessionRoutes from "./routes/sessions.js";
import gitRoutes from "./routes/git.js";
import worktreeRoutes from "./routes/worktrees.js";
import fileRoutes from "./routes/files.js";

// ---------------------------------------------------------------------------
// App + server setup
// ---------------------------------------------------------------------------

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

const deploymentMode = process.env.DEPLOYMENT_MODE;
if (!deploymentMode) {
  console.error("DEPLOYMENT_MODE is required (mono_user or multi_user).");
  process.exit(1);
}
if (deploymentMode !== "mono_user" && deploymentMode !== "multi_user") {
  console.error(`Invalid DEPLOYMENT_MODE: ${deploymentMode}. Use mono_user or multi_user.`);
  process.exit(1);
}

const runAsHelperPath = process.env.VIBE80_RUN_AS_HELPER || "/usr/local/bin/vibe80-run-as";
const sudoPath = process.env.VIBE80_SUDO_PATH || "sudo";

await storage.init();
await ensureDefaultMonoWorkspace();

// ---------------------------------------------------------------------------
// Middleware pipeline
// ---------------------------------------------------------------------------

app.use(express.json({ limit: "10mb" }));
app.use(errorTypesMiddleware);
app.use(debugMiddleware);
app.use("/api", authMiddleware);

// ---------------------------------------------------------------------------
// Route mounting
// ---------------------------------------------------------------------------

const routeDeps = {
  getOrCreateClient,
  getActiveClient,
  attachClientEvents,
  attachClaudeEvents,
  attachClientEventsForWorktree,
  attachClaudeEventsForWorktree,
  deploymentMode,
  debugApiWsLog,
};

app.use("/api", healthRoutes({
  getSession,
  touchSession,
  getActiveClient,
  deploymentMode,
  debugApiWsLog,
}));
app.use("/api", workspaceRoutes());
app.use("/api", sessionRoutes(routeDeps));
app.use("/api", gitRoutes(routeDeps));
app.use("/api", worktreeRoutes(routeDeps));
app.use("/api", fileRoutes());

// Attachment error handler
app.use((err, req, res, next) => {
  if (req.path.startsWith("/api/attachments")) {
    res.status(400).json({ error: err.message || "Attachment error." });
    return;
  }
  next(err);
});

// ---------------------------------------------------------------------------
// Event attachment helpers (delegates to clientEvents.js)
// ---------------------------------------------------------------------------

function unifiedAppendMessage(session, worktreeId, message) {
  return appendWorktreeMessage(session, worktreeId || "main", message);
}

function unifiedBroadcastDiff(sessionId, worktreeId) {
  if (!worktreeId || worktreeId === "main") {
    return broadcastRepoDiff(sessionId);
  }
  return broadcastWorktreeDiff(sessionId, worktreeId);
}

function buildEventDeps() {
  return {
    getSession,
    broadcastToSession,
    appendMessage: unifiedAppendMessage,
    broadcastDiff: unifiedBroadcastDiff,
    updateWorktreeStatus,
    updateWorktreeThreadId,
    appendRpcLog,
    getProviderLabel,
    storage,
    debugApiWsLog,
  };
}

function attachClientEvents(sessionId, client, provider) {
  attachCodexEvents(
    { sessionId, worktreeId: null, provider, client },
    buildEventDeps()
  );
}

function attachClientEventsForWorktree(sessionId, worktree) {
  attachCodexEvents(
    {
      sessionId,
      worktreeId: worktree.id,
      provider: worktree.provider,
      client: worktree.client,
    },
    buildEventDeps()
  );
}

function attachClaudeEvents(sessionId, client, provider) {
  attachClaudeEventsImpl(
    { sessionId, worktreeId: null, provider, client },
    buildEventDeps()
  );
}

function attachClaudeEventsForWorktree(sessionId, worktree) {
  attachClaudeEventsImpl(
    {
      sessionId,
      worktreeId: worktree.id,
      provider: worktree.provider,
      client: worktree.client,
    },
    buildEventDeps()
  );
}

// ---------------------------------------------------------------------------
// Ensure worktree clients on reconnect
// ---------------------------------------------------------------------------

const ensureClaudeWorktreeClients = async (session) => {
  const runtime = getSessionRuntime(session.sessionId);
  if (!runtime) return;
  const worktrees = await listStoredWorktrees(session);
  const claudeWorktrees = worktrees.filter((wt) => wt?.provider === "claude");
  if (!claudeWorktrees.length) return;
  await Promise.all(
    claudeWorktrees.map(async (worktree) => {
      let client = runtime.worktreeClients.get(worktree.id);
      if (client?.ready) return;
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
  if (!runtime) return;
  const worktrees = await listStoredWorktrees(session);
  const codexWorktrees = worktrees.filter((wt) => wt?.provider === "codex");
  if (!codexWorktrees.length) return;
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

// ---------------------------------------------------------------------------
// Chat WebSocket
// ---------------------------------------------------------------------------

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
      socket.send(JSON.stringify({ type: "error", message: "Unknown session." }));
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
        socket.send(JSON.stringify({ type: "error", message: "Unknown session." }));
        return;
      }
      await touchSession(session);
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON message." }));
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
          socket.send(JSON.stringify({ type: "error", message: "Invalid action request." }));
          return;
        }
        if (requestType !== "run" && requestType !== "git") {
          socket.send(JSON.stringify({ type: "error", message: "Unsupported action request." }));
          return;
        }
        if (requestType === "run" && !allowRunSlashCommand) {
          socket.send(JSON.stringify({ type: "error", message: "Run command disabled." }));
          return;
        }
        if (requestType === "git" && !allowGitSlashCommand) {
          socket.send(JSON.stringify({ type: "error", message: "Git command disabled." }));
          return;
        }
        const worktree =
          worktreeId !== "main" ? await getWorktree(session, worktreeId) : null;
        if (worktreeId !== "main" && !worktree) {
          socket.send(JSON.stringify({ type: "error", message: "Worktree not found." }));
          return;
        }
        const client = worktree
          ? runtime.worktreeClients.get(worktreeId) || getActiveClient(session)
          : getActiveClient(session);
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
          const result = await client.sendActionRequest(requestType, arg);
          socket.send(
            JSON.stringify({
              type: "action_started",
              requestType,
              turnId: result?.turn?.id || null,
            })
          );
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: error.message || "Failed to execute action.",
            })
          );
        }
        return;
      }

      // ============== Worktree WebSocket Handlers ==============

      if (payload.type === "worktree_send_message") {
        const worktreeId = payload.worktreeId;
        if (!worktreeId) {
          socket.send(JSON.stringify({ type: "error", message: "worktreeId is required." }));
          return;
        }
        const worktree = await getWorktree(session, worktreeId);
        if (!worktree) {
          socket.send(JSON.stringify({ type: "error", message: "Worktree not found." }));
          return;
        }
        const client = runtime.worktreeClients.get(worktreeId);
        if (!client?.ready) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: `${worktree.provider === "claude" ? "Claude CLI" : "Codex app-server"} not ready for worktree.`,
            })
          );
          return;
        }
        try {
          const result = await client.sendTurn(payload.text);
          await appendWorktreeMessage(session, worktreeId, {
            id: createMessageId(),
            role: "user",
            text: payload.displayText || payload.text,
            attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
            provider: worktree.provider,
          });
          socket.send(
            JSON.stringify({
              type: "worktree_turn_started",
              worktreeId,
              turnId: result.turn.id,
              threadId: client.threadId,
              provider: worktree.provider,
            })
          );
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: error.message || "Failed to send worktree message.",
            })
          );
        }
        return;
      }

      if (payload.type === "worktree_messages_sync") {
        const worktreeId = payload.worktreeId;
        if (!worktreeId) {
          socket.send(JSON.stringify({ type: "error", message: "worktreeId is required." }));
          return;
        }
        const worktree = await getWorktree(session, worktreeId);
        if (!worktree) {
          socket.send(JSON.stringify({ type: "error", message: "Worktree not found." }));
          return;
        }
        const messages = getMessagesSince(worktree.messages, payload.lastSeenMessageId);
        const status = worktree.status || "idle";

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
          const newClient = await getOrCreateClient(session, newProvider);
          if (!newClient.listenerCount("ready")) {
            if (newProvider === "claude") {
              attachClaudeEvents(sessionId, newClient, newProvider);
            } else {
              attachClientEvents(sessionId, newClient, newProvider);
            }
          }
          if (!newClient.ready) {
            await newClient.start();
          }
          session.activeProvider = newProvider;
          await storage.saveSession(sessionId, {
            ...session,
            activeProvider: newProvider,
            lastActivityAt: Date.now(),
          });

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

// ---------------------------------------------------------------------------
// Terminal WebSocket
// ---------------------------------------------------------------------------

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
    const env = {
      ...process.env,
      TMPDIR: getSessionTmpDir(session.dir),
    };
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
        "--env",
        `TMPDIR=${getSessionTmpDir(session.dir)}`,
        ...buildSandboxArgs({
          cwd,
          repoDir: cwd,
          workspaceId: session.workspaceId,
          tmpDir: getSessionTmpDir(session.dir),
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

// ---------------------------------------------------------------------------
// Static files + SPA fallback
// ---------------------------------------------------------------------------

const distPath = path.resolve(__dirname, "../../client/dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// ---------------------------------------------------------------------------
// Server start + timers
// ---------------------------------------------------------------------------

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
