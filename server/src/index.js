import express from "express";
import http from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { WebSocketServer } from "ws";
import * as pty from "node-pty";
import rateLimit from "express-rate-limit";
import storage from "./storage/index.js";
import {
  getSessionRuntime,
  listSessionRuntimeEntries,
} from "./runtimeStore.js";
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
  getMainWorktreeStorageId,
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
  getWorktreeMessages,
  appendRpcLog,
  getProviderLabel,
  resolveDefaultDenyGitCredentialsAccess,
  sessionGcIntervalMs,
  updateWorktreeThreadId,
  runSessionCommandOutputWithStatus,
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
const trustProxySetting = process.env.TRUST_PROXY;
if (trustProxySetting !== undefined) {
  const normalized = trustProxySetting.trim().toLowerCase();
  if (normalized === "true") {
    app.set("trust proxy", true);
  } else if (normalized === "false") {
    app.set("trust proxy", false);
  } else {
    const numeric = Number(trustProxySetting);
    if (!Number.isNaN(numeric)) {
      app.set("trust proxy", numeric);
    } else {
      app.set("trust proxy", trustProxySetting);
    }
  }
}
const terminalEnabled = !/^(0|false|no|off)$/i.test(
  process.env.TERMINAL_ENABLED || ""
);
const allowRunSlashCommand = !/^(0|false|no|off)$/i.test(
  process.env.ALLOW_RUN_SLASH_COMMAND || ""
);
const allowGitSlashCommand = !/^(0|false|no|off)$/i.test(
  process.env.ALLOW_GIT_SLASH_COMMAND || ""
);
const codexIdleTtlSeconds = Number.parseInt(
  process.env.CODEX_IDLE_TTL_SECONDS || "300",
  10
);
const codexIdleGcIntervalSeconds = Number.parseInt(
  process.env.CODEX_IDLE_GC_INTERVAL_SECONDS || "60",
  10
);
const worktreeStatusIntervalMs = 10 * 1000;
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

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const createLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(express.json({ limit: "10mb" }));
app.use(errorTypesMiddleware);
app.use(debugMiddleware);
app.use("/api", apiLimiter);
app.post("/api/workspaces/login", authLimiter);
app.post("/api/workspaces/refresh", authLimiter);
app.post("/api/workspaces", createLimiter);
app.post("/api/sessions", createLimiter);
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
    const sessionId = url.searchParams.get("session");
    if (!sessionId) {
      socket.send(JSON.stringify({ type: "error", message: "Missing session id." }));
      socket.close();
      return;
    }

    let workspaceId = null;
    let runtime = null;
    let authenticated = false;
    let authTimeout = null;

    const clearAuthTimeout = () => {
      if (authTimeout) {
        clearTimeout(authTimeout);
        authTimeout = null;
      }
    };

    const handleChatMessage = async (data) => {
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
        try {
          const requestMessageId = createMessageId();
          const resultMessageId = createMessageId();
          const actionText = `/${requestType} ${arg}`.trim();
          const actionMessage = {
            id: requestMessageId,
            role: "user",
            type: "action_request",
            text: actionText,
            action: {
              request: requestType,
              arg,
            },
          };
          await appendWorktreeMessage(session, worktreeId, actionMessage);
          const requestPayload = {
            type: "action_request",
            id: requestMessageId,
            request: requestType,
            arg,
            text: actionText,
            worktreeId,
          };
          broadcastToSession(session.sessionId, requestPayload);

          const cwd = worktree?.path || session.repoDir;
          const denyGitCreds = typeof worktree?.denyGitCredentialsAccess === "boolean"
            ? worktree.denyGitCredentialsAccess
            : resolveDefaultDenyGitCredentialsAccess(session);
          const allowGitCreds = requestType === "git" ? true : !denyGitCreds;
          const gitDir = session.gitDir || path.join(session.dir, "git");
          const sshDir = getWorkspaceSshPaths(getWorkspacePaths(session.workspaceId).homeDir).sshDir;
          const extraAllowRw = [
            session.repoDir,
            worktree?.path,
            ...(allowGitCreds ? [gitDir, sshDir] : []),
          ].filter(Boolean);
          const { output, code } = await runSessionCommandOutputWithStatus(
            session,
            "/bin/bash",
            ["-lc", requestType === "run" ? arg: "git " + arg],
            {
              cwd,
              sandbox: true,
              repoDir: cwd,
              workspaceId: session.workspaceId,
              tmpDir: getSessionTmpDir(session.dir),
              attachmentsDir: session.attachmentsDir,
              netMode: requestType === "git" ? "tcp:22,53,443" : "none",
              extraAllowRw,
            }
          );
          const trimmedOutput = (output || "").trim();
          const resultText = `\`\`\`\n${trimmedOutput}${trimmedOutput ? "\n" : ""}\`\`\``;
          const status = code === 0 ? "success" : "error";
          const resultMessage = {
            id: resultMessageId,
            role: "assistant",
            type: "action_result",
            text: resultText,
            action: {
              request: requestType,
              arg,
              status,
              output: output || "",
              requestMessageId,
            },
          };
          await appendWorktreeMessage(session, worktreeId, resultMessage);
          const resultPayload = {
            type: "action_result",
            id: resultMessageId,
            request: requestType,
            arg,
            status,
            output: output || "",
            text: resultText,
            requestMessageId,
            worktreeId,
          };
          broadcastToSession(session.sessionId, resultPayload);
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

      if (payload.type === "wake_up") {
        const worktreeId = payload.worktreeId || "main";
        if (worktreeId === "main") {
          if (session.activeProvider !== "codex") {
            return;
          }
          try {
            let client = await getOrCreateClient(session, "codex");
            if (!client.listenerCount("ready")) {
              attachClientEvents(sessionId, client, "codex");
            }
            const procExited = client?.proc && client.proc.exitCode != null;
            if (procExited && runtime?.clients?.codex) {
              delete runtime.clients.codex;
              client = await getOrCreateClient(session, "codex");
              if (!client.listenerCount("ready")) {
                attachClientEvents(sessionId, client, "codex");
              }
            }
            if (!client.ready && !client.proc) {
              await client.start();
            }
            if (typeof client.markActive === "function") {
              client.markActive();
            }
          } catch (error) {
            socket.send(
              JSON.stringify({
                type: "error",
                message: error.message || "Failed to wake Codex client.",
              })
            );
          }
          return;
        }

        const worktree = await getWorktree(session, worktreeId);
        if (!worktree) {
          socket.send(JSON.stringify({ type: "error", message: "Worktree not found." }));
          return;
        }
        if (worktree.provider !== "codex") {
          return;
        }
        try {
          let client = runtime?.worktreeClients?.get(worktreeId) || null;
          const procExited = client?.proc && client.proc.exitCode != null;
          if (procExited && runtime?.worktreeClients) {
            runtime.worktreeClients.delete(worktreeId);
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
            runtime?.worktreeClients?.set(worktreeId, client);
          }
          worktree.client = client;
          if (!client.listenerCount("ready")) {
            attachClientEventsForWorktree(sessionId, worktree);
          }
          if (!client.ready && !client.proc) {
            await client.start();
          }
          if (typeof client.markActive === "function") {
            client.markActive();
          }
        } catch (error) {
          socket.send(
            JSON.stringify({
              type: "error",
              message: error.message || "Failed to wake Codex worktree.",
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
        if (worktree.status === "stopped") {
          socket.send(
            JSON.stringify({
              type: "error",
              message: "Worktree is stopped. Wake it up before sending a message.",
            })
          );
          return;
        }
        const isMainWorktree = worktreeId === "main";
        const client = isMainWorktree
          ? getActiveClient(session)
          : runtime.worktreeClients.get(worktreeId);
        if (!client?.ready) {
          const label = isMainWorktree
            ? getProviderLabel(session)
            : (worktree.provider === "claude" ? "Claude CLI" : "Codex app-server");
          socket.send(
            JSON.stringify({
              type: "error",
              message: `${label} not ready for worktree.`,
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
          const turnPayload = {
            type: "turn_started",
            turnId: result.turn.id,
            threadId: client.threadId,
            provider: worktree.provider,
            status: "processing",
            worktreeId,
          };
          socket.send(JSON.stringify(turnPayload));
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
        const requestedLimit = Number.parseInt(payload?.limit, 10);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
          ? requestedLimit
          : 50;
        const messages = await getWorktreeMessages(session, worktreeId, {
          limit,
          beforeMessageId: payload.lastSeenMessageId || null,
        });
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

      if (payload.type === "turn_interrupt") {
        const worktreeId = payload.worktreeId;
        const client = worktreeId
          ? runtime?.worktreeClients?.get(worktreeId)
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
          socket.send(
            JSON.stringify({
              type: "provider_switched",
              provider: newProvider,
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

          broadcastToSession(sessionId, {
            type: "provider_switched",
            provider: newProvider,
            models,
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
    };

    socket.on("close", () => {
      if (runtime) {
        runtime.sockets.delete(socket);
      }
      clearAuthTimeout();
    });

    authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.send(JSON.stringify({ type: "error", message: "Auth timeout." }));
        socket.close();
      }
    }, 5000);

    socket.on("message", async function handleAuth(data) {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid JSON message." }));
        return;
      }
      if (payload?.type !== "auth") {
        socket.send(JSON.stringify({ type: "error", message: "Auth required." }));
        return;
      }
      if (authenticated) {
        return;
      }
      const token = typeof payload?.token === "string" ? payload.token : "";
      if (!token) {
        socket.send(JSON.stringify({ type: "error", message: "Missing workspace token." }));
        socket.close();
        return;
      }
      try {
        workspaceId = verifyWorkspaceToken(token);
      } catch (error) {
        socket.send(JSON.stringify({ type: "error", message: "Invalid workspace token." }));
        socket.close();
        return;
      }
      const session = await getSession(sessionId, workspaceId);
      if (!session) {
        socket.send(JSON.stringify({ type: "error", message: "Unknown session." }));
        socket.close();
        return;
      }
      await ensureWorkspaceUserExists(session.workspaceId);
      runtime = getSessionRuntime(sessionId);
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

      authenticated = true;
      clearAuthTimeout();
      socket.off("message", handleAuth);
      socket.on("message", handleChatMessage);

      socket.send(JSON.stringify({ type: "auth_ok" }));

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
    const shell = "/bin/bash";
    let term = null;
    let closed = false;
    let authenticated = false;
    let workspaceId = null;
    let session = null;
    let worktree = null;
    let authTimeout = null;

    const clearAuthTimeout = () => {
      if (authTimeout) {
        clearTimeout(authTimeout);
        authTimeout = null;
      }
    };

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

    const handleTerminalMessage = async (raw) => {
      let message = null;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!message?.type) {
        return;
      }
      if (!authenticated) {
        if (message.type !== "auth") {
          socket.send(JSON.stringify({ type: "error", message: "Auth required." }));
          return;
        }
        const token = typeof message?.token === "string" ? message.token : "";
        if (!token) {
          socket.send(JSON.stringify({ type: "error", message: "Missing workspace token." }));
          socket.close();
          return;
        }
        try {
          workspaceId = verifyWorkspaceToken(token);
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "Invalid workspace token." }));
          socket.close();
          return;
        }
        req.workspaceId = workspaceId;
        session = await getSessionFromRequest(req);
        if (!session) {
          socket.send(JSON.stringify({ type: "error", message: "Unknown session." }));
          socket.close();
          return;
        }
        await touchSession(session);
        try {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const worktreeId = url.searchParams.get("worktreeId");
          if (worktreeId && worktreeId !== "main") {
            worktree = await getWorktree(session, worktreeId);
          }
        } catch {
          // Ignore invalid URL parsing; fall back to main repo.
        }
        authenticated = true;
        clearAuthTimeout();
        socket.send(JSON.stringify({ type: "auth_ok" }));
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
    };

    authTimeout = setTimeout(() => {
      if (!authenticated) {
        socket.send(JSON.stringify({ type: "error", message: "Auth timeout." }));
        socket.close();
      }
    }, 5000);

    socket.on("message", handleTerminalMessage);

    socket.on("close", () => {
      closed = true;
      clearAuthTimeout();
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
if (Number.isFinite(codexIdleGcIntervalSeconds) && codexIdleGcIntervalSeconds > 0) {
  setInterval(() => {
    if (!Number.isFinite(codexIdleTtlSeconds) || codexIdleTtlSeconds <= 0) {
      return;
    }
    const ttlMs = codexIdleTtlSeconds * 1000;
    const now = Date.now();
    for (const [sessionId, runtime] of listSessionRuntimeEntries()) {
      const candidates = [];
      if (runtime?.clients?.codex) {
        candidates.push(["main", runtime.clients.codex]);
      }
      if (runtime?.worktreeClients instanceof Map) {
        runtime.worktreeClients.forEach((client, worktreeId) => {
          candidates.push([worktreeId, client]);
        });
      }
      candidates.forEach(([worktreeId, client]) => {
        if (!client || client?.constructor?.name !== "CodexAppServerClient") {
          return;
        }
        if (typeof client.getStatus !== "function") {
          return;
        }
        if (client.getStatus() !== "idle") {
          return;
        }
        const lastIdleAt = client.lastIdleAt;
        if (!Number.isFinite(lastIdleAt)) {
          return;
        }
        if (now - lastIdleAt < ttlMs) {
          return;
        }
        client.stop({ force: false, reason: "gc_idle" }).catch(() => null);
        if (worktreeId === "main") {
          return;
        }
        void (async () => {
          const session = await getSession(sessionId);
          if (!session) {
            return;
          }
          await updateWorktreeStatus(session, worktreeId, "stopped");
          broadcastToSession(sessionId, {
            type: "worktree_status",
            worktreeId,
            status: "stopped",
            error: null,
          });
        })();
      });
    }
  }, codexIdleGcIntervalSeconds * 1000);
}

setInterval(() => {
  void (async () => {
    for (const [sessionId, runtime] of listSessionRuntimeEntries()) {
      if (!runtime?.sockets || runtime.sockets.size === 0) {
        continue;
      }
      const session = await getSession(sessionId);
      if (!session) {
        continue;
      }
      const mainStorageId = getMainWorktreeStorageId(session.sessionId);
      let worktrees = await listStoredWorktrees(session);
      if (!worktrees.some((wt) => wt?.id === mainStorageId)) {
        const mainWorktree = await getWorktree(session, "main");
        if (mainWorktree) {
          worktrees = [...worktrees, mainWorktree];
        }
      }
      worktrees.forEach((worktree) => {
        const worktreeId =
          worktree?.id === mainStorageId ? "main" : worktree?.id;
        if (!worktreeId) {
          return;
        }
        let status = worktree?.status;
        if (worktree?.provider === "codex") {
          const runtimeClient = worktreeId === "main"
            ? runtime?.clients?.codex
            : runtime?.worktreeClients?.get?.(worktreeId);
          if (runtimeClient?.getStatus) {
            const runtimeStatus = runtimeClient.getStatus();
            if (runtimeStatus === "busy") {
              status = "processing";
            } else if (
              runtimeStatus === "starting" ||
              runtimeStatus === "restarting"
            ) {
              status = "processing";
            } else if (runtimeStatus === "stopping") {
              status = "stopped";
            } else if (runtimeStatus === "idle") {
              status = "ready";
            }
          }
        }
        if (!status) {
          return;
        }
        broadcastToSession(sessionId, {
          type: "worktree_status",
          worktreeId,
          status,
          error: worktree?.error || null,
        });
      });
    }
  })().catch((error) => {
    console.error("Worktree status heartbeat failed:", error?.message || error);
  });
}, worktreeStatusIntervalMs);

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
    return;
  }
  if (url.pathname === "/terminal" || url.pathname === "/api/terminal/ws") {
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
