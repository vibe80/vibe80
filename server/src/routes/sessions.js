import { Router } from "express";
import os from "os";
import storage from "../storage/index.js";
import {
  createMessageId,
  classifySessionCreationError,
  toIsoDateTime,
} from "../helpers.js";
import { debugApiWsLog } from "../middleware/debug.js";
import {
  handoffTokens,
  createHandoffToken,
  issueWorkspaceTokens,
} from "../services/auth.js";
import {
  ensureWorkspaceUserExists,
  readWorkspaceConfig,
  listEnabledProviders,
} from "../services/workspace.js";
import {
  getSession,
  touchSession,
  createSession,
  cleanupSession,
  getRepoDiff,
  getCurrentBranch,
  getLastCommit,
  resolveDefaultDenyGitCredentialsAccess,
  broadcastToSession,
} from "../services/session.js";
import {
  getWorktree,
  clearWorktreeMessages,
} from "../worktreeManager.js";

const instanceHostname = process.env.HOSTNAME || os.hostname();

export default function sessionRoutes(deps) {
  const {
    getOrCreateClient,
    attachClientEvents,
    attachClaudeEvents,
    getActiveClient,
    deploymentMode,
    terminalEnabled,
  } = deps;

  const router = Router();
  const resolveEnabledProviders = async (workspaceId) => {
    try {
      const workspaceConfig = await readWorkspaceConfig(workspaceId);
      return listEnabledProviders(workspaceConfig?.providers || {});
    } catch {
      return [];
    }
  };

  router.get("/sessions", (req, res) => {
    const workspaceId = req.workspaceId;
    storage
      .listSessions(workspaceId)
      .then(async (sessions) => {
        const enabledProviders = await resolveEnabledProviders(workspaceId);
        const payload = sessions.map((session) => ({
          sessionId: session.sessionId,
          repoUrl: session.repoUrl || "",
          name: session.name || "",
          createdAt: toIsoDateTime(session.createdAt),
          lastActivityAt: toIsoDateTime(session.lastActivityAt),
          activeProvider: session.activeProvider || null,
          providers: enabledProviders,
        }));
        payload.sort((a, b) => {
          const aTime = Date.parse(a.lastActivityAt || a.createdAt || "") || 0;
          const bTime = Date.parse(b.lastActivityAt || b.createdAt || "") || 0;
          return bTime - aTime;
        });
        res.json({ sessions: payload });
      })
      .catch((error) => {
        res.status(500).json({ error: error?.message || "Failed to list sessions." });
      });
  });

  router.post("/sessions/handoff", async (req, res) => {
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
    res.json({
      handoffToken: record.token,
      expiresAt: toIsoDateTime(record.expiresAt),
    });
  });

  router.post("/sessions/handoff/consume", async (req, res) => {
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

  router.get("/sessions/:sessionId", async (req, res) => {
    const session = await getSession(req.params.sessionId, req.workspaceId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    await touchSession(session);
    const repoDiff = await getRepoDiff(session);
    const activeProvider = session.activeProvider || "codex";
    const enabledProviders = await resolveEnabledProviders(session.workspaceId);
    res.json({
      sessionId: req.params.sessionId,
      workspaceId: session.workspaceId,
      path: session.dir,
      repoUrl: session.repoUrl,
      name: session.name || "",
      defaultProvider: activeProvider,
      providers: enabledProviders,
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

  router.delete("/sessions/:sessionId", async (req, res) => {
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

  router.get("/sessions/:sessionId/health", async (req, res) => {
    const session = await getSession(req.params.sessionId, req.workspaceId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
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
      instance: instanceHostname,
    });
  });

  router.get("/sessions/:sessionId/last-commit", async (req, res) => {
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

  router.get("/sessions/:sessionId/rpc-logs", async (req, res) => {
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

  router.post("/sessions/:sessionId/clear", async (req, res) => {
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

  router.post("/sessions/:sessionId/backlog-items", async (req, res) => {
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
    res.json({
      ok: true,
      item: {
        ...item,
        createdAt: toIsoDateTime(item.createdAt),
      },
    });
  });

  router.get("/sessions/:sessionId/backlog-items", async (req, res) => {
    const session = await getSession(req.params.sessionId, req.workspaceId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    await touchSession(session);
    const backlog = Array.isArray(session.backlog) ? session.backlog : [];
    const serializedItems = backlog.map((item) => ({
      ...item,
      createdAt: toIsoDateTime(item?.createdAt),
      doneAt: toIsoDateTime(item?.doneAt),
    }));
    res.json({ items: serializedItems });
  });

  router.patch("/sessions/:sessionId/backlog-items/:itemId", async (req, res) => {
    const session = await getSession(req.params.sessionId, req.workspaceId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    const itemId =
      typeof req.params.itemId === "string" ? req.params.itemId.trim() : "";
    if (!itemId) {
      res.status(400).json({ error: "itemId is required." });
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
    res.json({
      ok: true,
      item: {
        ...updatedItem,
        createdAt: toIsoDateTime(updatedItem.createdAt),
        doneAt: toIsoDateTime(updatedItem.doneAt),
      },
    });
  });

  router.post("/sessions", async (req, res) => {
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
        name,
        { getOrCreateClient, attachClientEvents, attachClaudeEvents, broadcastToSession }
      );
      const enabledProviders = await resolveEnabledProviders(req.workspaceId);
      const defaultProvider = session.activeProvider
        || (enabledProviders.includes("codex") ? "codex" : enabledProviders[0] || "codex");
      res.status(201).location(`/api/sessions/${session.sessionId}`).json({
        sessionId: session.sessionId,
        workspaceId: session.workspaceId || req.workspaceId,
        path: session.dir,
        repoUrl,
        name: session.name || "",
        defaultProvider,
        providers: enabledProviders,
        defaultInternetAccess:
          typeof session.defaultInternetAccess === "boolean"
            ? session.defaultInternetAccess
            : true,
        defaultDenyGitCredentialsAccess: resolveDefaultDenyGitCredentialsAccess(session),
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

  return router;
}
