import path from "path";
import { Router } from "express";
import {
  createWorktreeClient,
} from "../clientFactory.js";
import {
  getSession,
  touchSession,
  runSessionCommand,
  runSessionCommandOutput,
  resolveWorktreeRoot,
  listDirectoryEntries,
  broadcastToSession,
  isValidProvider,
  resolveDefaultDenyGitCredentialsAccess,
  MAX_FILE_BYTES,
  MAX_WRITE_BYTES,
  readWorkspaceFileBuffer,
  writeWorkspaceFilePreserveMode,
  getWorktree,
  getWorktreeMessages,
  getWorktreeDiff,
} from "../services/session.js";
import { getSessionTmpDir, createMessageId, toIsoDateTime } from "../helpers.js";
import { getSessionRuntime } from "../runtimeStore.js";
import {
  listWorktrees,
  createWorktree,
  removeWorktree,
  renameWorktree,
  mergeWorktree,
  abortMerge,
  cherryPickCommit,
  getWorktreeCommits,
  updateWorktreeStatus,
  appendWorktreeMessage,
} from "../worktreeManager.js";

export default function worktreeRoutes(deps) {
  const {
    getActiveClient,
    getOrCreateClient,
    attachClientEvents,
    attachClaudeEvents,
    attachClientEventsForWorktree,
    attachClaudeEventsForWorktree,
  } = deps;

  const router = Router();
  const DEFAULT_WAKEUP_TIMEOUT_MS = 15000;
  const resolveRelativePath = (rootPath, requestedPath) => {
    if (!requestedPath || typeof requestedPath !== "string") {
      return null;
    }
    const absPath = path.resolve(rootPath, requestedPath);
    const relative = path.relative(rootPath, absPath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    return { absPath, relative };
  };

  const waitUntilClientReady = (client, timeoutMs) =>
    new Promise((resolve, reject) => {
      if (client?.ready) {
        resolve();
        return;
      }
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Wakeup timeout."));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        client?.off?.("ready", onReady);
        client?.off?.("exit", onExit);
      };
      const onReady = () => {
        cleanup();
        resolve();
      };
      const onExit = (payload) => {
        cleanup();
        reject(
          new Error(
            `Client exited before ready (code=${payload?.code ?? "unknown"}, signal=${payload?.signal ?? "unknown"}).`
          )
        );
      };
      client.on("ready", onReady);
      client.on("exit", onExit);
    });

  const ensureReadyWorktreeClient = async (session, worktree, timeoutMs = DEFAULT_WAKEUP_TIMEOUT_MS) => {
    const sessionId = session.sessionId;
    const runtime = getSessionRuntime(sessionId);
    const worktreeId = worktree?.id === `main-${sessionId}` ? "main" : worktree?.id;
    const isMain = worktreeId === "main";
    const provider = isMain ? session.activeProvider : worktree.provider;
    let client = null;

    if (isMain) {
      client = await getOrCreateClient(session, provider);
      const procExited = client?.proc && client.proc.exitCode != null;
      if (procExited && runtime?.clients?.[provider]) {
        delete runtime.clients[provider];
        client = await getOrCreateClient(session, provider);
      }
      if (!client.listenerCount("ready")) {
        if (provider === "claude") {
          attachClaudeEvents(sessionId, client);
        } else {
          attachClientEvents(sessionId, client, provider);
        }
      }
    } else {
      client = runtime?.worktreeClients?.get(worktreeId) || null;
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
        if (provider === "claude") {
          attachClaudeEventsForWorktree(sessionId, worktree);
        } else {
          attachClientEventsForWorktree(sessionId, worktree);
        }
      }
    }

    if (!client.ready && !client.proc) {
      await client.start();
    }
    if (!client.ready) {
      await waitUntilClientReady(client, timeoutMs);
    }
    if (typeof client.markActive === "function") {
      client.markActive();
    }
    return client;
  };

  router.get("/sessions/:sessionId/worktrees", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.post("/sessions/:sessionId/worktrees", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);

    const context = req.body?.context === "fork" ? "fork" : "new";
    const provider = req.body?.provider;
    const sourceWorktree = req.body?.sourceWorktree;

    if (context === "new") {
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
    } else {
      if (!sourceWorktree || typeof sourceWorktree !== "string") {
        res.status(400).json({ error: "sourceWorktree is required when context=fork." });
        return;
      }
      if (provider != null || req.body?.model != null || req.body?.reasoningEffort != null) {
        res.status(400).json({
          error: "provider, model and reasoningEffort must not be provided when context=fork.",
        });
        return;
      }
      const source = await getWorktree(session, sourceWorktree);
      if (!source) {
        res.status(404).json({ error: "Source worktree not found." });
        return;
      }
      const sourceThreadId =
        source.threadId || (sourceWorktree === "main" ? session.threadId || null : null);
      if (!sourceThreadId) {
        res.status(409).json({ error: "Source worktree has no threadId to fork from." });
        return;
      }
      if (
        Array.isArray(session.providers) &&
        session.providers.length &&
        !session.providers.includes(source.provider)
      ) {
        res.status(400).json({ error: "Source provider not enabled for this session." });
        return;
      }
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
        context,
        provider: context === "new" ? provider : null,
        sourceWorktree: context === "fork" ? sourceWorktree : null,
        name: req.body?.name || null,
        parentWorktreeId: req.body?.parentWorktreeId || null,
        startingBranch: req.body?.startingBranch || null,
        model: context === "new" ? req.body?.model || null : null,
        reasoningEffort: context === "new" ? req.body?.reasoningEffort || null : null,
        internetAccess,
        denyGitCredentialsAccess,
      });

      if (worktree.client) {
        if (worktree.provider === "claude") {
          attachClaudeEventsForWorktree(sessionId, worktree);
        } else {
          attachClientEventsForWorktree(sessionId, worktree);
        }
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

      res.status(201).location(
        `/api/sessions/${sessionId}/worktrees/${worktree.id}`
      ).json({
        worktreeId: worktree.id,
        name: worktree.name,
        branchName: worktree.branchName,
        provider: worktree.provider,
        context: worktree.context || "new",
        sourceWorktreeId: worktree.sourceWorktreeId || null,
        model: worktree.model || null,
        reasoningEffort: worktree.reasoningEffort || null,
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

  router.get("/sessions/:sessionId/worktrees/:worktreeId", async (req, res) => {
    const sessionId = req.params.sessionId;
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
        context: worktree.context || "new",
        sourceWorktreeId: worktree.sourceWorktreeId || null,
        model: worktree.model || null,
        reasoningEffort: worktree.reasoningEffort || null,
        internetAccess: Boolean(worktree.internetAccess),
        denyGitCredentialsAccess:
          typeof worktree.denyGitCredentialsAccess === "boolean"
            ? worktree.denyGitCredentialsAccess
            : true,
        status: worktree.status,
        color: worktree.color,
        createdAt: toIsoDateTime(worktree.createdAt),
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

  router.get("/sessions/:sessionId/worktrees/:worktreeId/messages", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);

    const worktreeId = req.params.worktreeId;
    const worktree = await getWorktree(session, worktreeId);
    if (!worktree) {
      res.status(404).json({ error: "Worktree not found." });
      return;
    }
    try {
      const limitValue = Number.parseInt(req.query?.limit, 10);
      const limit =
        Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 50;
      const beforeMessageId =
        typeof req.query?.beforeMessageId === "string"
          ? req.query.beforeMessageId
          : null;
      const messages = await getWorktreeMessages(session, worktreeId, {
        limit: limit + 1,
        beforeMessageId,
      });
      const hasMore = messages.length > limit;
      const trimmed = hasMore ? messages.slice(1) : messages;

      res.json({
        worktreeId,
        messages: trimmed,
        hasMore,
      });
    } catch (error) {
      console.error("Failed to get worktree messages:", {
        sessionId,
        worktreeId,
        error: error?.message || error,
      });
      res.status(500).json({ error: "Failed to get worktree messages." });
    }
  });

  router.post("/sessions/:sessionId/worktrees/:worktreeId/messages", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);

    const worktreeId = req.params.worktreeId;
    const worktree = await getWorktree(session, worktreeId);
    if (!worktree) {
      res.status(404).json({ error: "Worktree not found." });
      return;
    }
    if (worktree.status === "stopped") {
      res.status(409).json({
        error: "Worktree is stopped. Wake it up before sending a message.",
      });
      return;
    }

    const role = req.body?.role;
    if (role !== "user") {
      res.status(400).json({ error: "Only role=user is supported." });
      return;
    }

    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "Message text is required." });
      return;
    }

    const attachments = Array.isArray(req.body?.attachments)
      ? req.body.attachments
      : [];

    const isMainWorktree = worktreeId === "main";
    const runtime = getSessionRuntime(sessionId);
    const client = isMainWorktree
      ? getActiveClient(session)
      : runtime?.worktreeClients?.get(worktreeId);
    if (!client?.ready) {
      const label = isMainWorktree
        ? worktree.provider === "claude"
          ? "Claude CLI"
          : "Codex app-server"
        : (worktree.provider === "claude" ? "Claude CLI" : "Codex app-server");
      res.status(409).json({ error: `${label} not ready for worktree.` });
      return;
    }

    try {
      const result = await client.sendTurn(text);
      const messageId = createMessageId();
      await appendWorktreeMessage(session, worktreeId, {
        id: messageId,
        role: "user",
        text,
        attachments,
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
      broadcastToSession(sessionId, turnPayload);
      res.json({
        messageId,
        turnId: result.turn.id,
        threadId: client.threadId,
        provider: worktree.provider,
        worktreeId,
      });
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to send message." });
    }
  });

  const handleWorktreeWakeup = async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);

    const worktreeId = req.params.worktreeId;
    const worktree = await getWorktree(session, worktreeId);
    if (!worktree) {
      res.status(404).json({ error: "Worktree not found." });
      return;
    }

    const requestedTimeout = Number.parseInt(req.body?.timeoutMs, 10);
    const timeoutMs = Number.isFinite(requestedTimeout)
      ? Math.min(Math.max(requestedTimeout, 1000), 60000)
      : DEFAULT_WAKEUP_TIMEOUT_MS;

    try {
      const client = await ensureReadyWorktreeClient(session, worktree, timeoutMs);
      const effectiveWorktreeId = worktreeId || "main";
      const provider = effectiveWorktreeId === "main"
        ? session.activeProvider
        : worktree.provider;
      res.json({
        worktreeId: effectiveWorktreeId,
        provider,
        status: "ready",
        threadId: client?.threadId || null,
      });
    } catch (error) {
      const message = error?.message || "Failed to wake provider.";
      if (/timeout/i.test(message)) {
        res.status(504).json({ error: message });
        return;
      }
      if (/not ready/i.test(message) || /exited before ready/i.test(message)) {
        res.status(409).json({ error: message });
        return;
      }
      const providerLabel = (worktreeId === "main" ? session.activeProvider : worktree.provider) === "claude"
        ? "Claude CLI"
        : "Codex app-server";
      res.status(500).json({ error: `${providerLabel} wakeup failed: ${message}` });
    }
  };

  router.post("/sessions/:sessionId/worktrees/:worktreeId/wakeup", handleWorktreeWakeup);
  router.post("/sessions/:sessionId/worktrees/:worktreeId/wakup", handleWorktreeWakeup);

  router.get("/sessions/:sessionId/worktrees/:worktreeId/browse", async (req, res) => {
    const sessionId = req.params.sessionId;
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
      const payload = await listDirectoryEntries(
        session.workspaceId,
        rootPath,
        typeof req.query?.path === "string" ? req.query.path : ""
      );
      res.json(payload);
    } catch (error) {
      console.error("Failed to browse worktree:", {
        sessionId,
        worktreeId: req.params.worktreeId,
        error: error?.message || error,
      });
      res.status(500).json({ error: "Failed to browse worktree." });
    }
  });

  router.get("/sessions/:sessionId/worktrees/:worktreeId/file", async (req, res) => {
    const sessionId = req.params.sessionId;
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
    const resolved = resolveRelativePath(rootPath, requestedPath);
    if (!resolved) {
      res.status(400).json({ error: "Invalid path." });
      return;
    }
    const { absPath } = resolved;
    try {
      const { buffer, truncated } = await readWorkspaceFileBuffer(
        session.workspaceId,
        absPath,
        MAX_FILE_BYTES,
        { env: { TMPDIR: getSessionTmpDir(session.dir) } }
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

  router.post("/sessions/:sessionId/worktrees/:worktreeId/file", async (req, res) => {
    const sessionId = req.params.sessionId;
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
    const resolved = resolveRelativePath(rootPath, requestedPath);
    if (!resolved) {
      res.status(400).json({ error: "Invalid path." });
      return;
    }
    const { absPath } = resolved;
    try {
      let updated = false;
      try {
        await writeWorkspaceFilePreserveMode(session.workspaceId, absPath, content);
        updated = true;
      } catch {
        updated = false;
      }
      if (!updated) {
        await runSessionCommand(session, "/bin/mkdir", ["-p", path.dirname(absPath)], {
          cwd: rootPath,
        });
        await runSessionCommand(session, "/usr/bin/tee", [absPath], { input: content });
      }
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

  router.post("/sessions/:sessionId/worktrees/:worktreeId/folder", async (req, res) => {
    const sessionId = req.params.sessionId;
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
    if (!requestedPath || typeof requestedPath !== "string") {
      res.status(400).json({ error: "Path is required." });
      return;
    }
    const resolved = resolveRelativePath(rootPath, requestedPath);
    if (!resolved) {
      res.status(400).json({ error: "Invalid path." });
      return;
    }
    try {
      await runSessionCommand(session, "/bin/mkdir", ["-p", resolved.absPath], {
        cwd: rootPath,
      });
      res.json({ ok: true, path: requestedPath });
    } catch (error) {
      console.error("Failed to create folder:", {
        sessionId,
        worktreeId: req.params.worktreeId,
        path: requestedPath,
        error: error?.message || error,
      });
      res.status(500).json({ error: "Failed to create folder." });
    }
  });

  router.post("/sessions/:sessionId/worktrees/:worktreeId/file/rename", async (req, res) => {
    const sessionId = req.params.sessionId;
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
    const fromPath = req.body?.fromPath;
    const toPath = req.body?.toPath;
    if (!fromPath || typeof fromPath !== "string") {
      res.status(400).json({ error: "fromPath is required." });
      return;
    }
    if (!toPath || typeof toPath !== "string") {
      res.status(400).json({ error: "toPath is required." });
      return;
    }
    const fromResolved = resolveRelativePath(rootPath, fromPath);
    const toResolved = resolveRelativePath(rootPath, toPath);
    if (!fromResolved || !toResolved) {
      res.status(400).json({ error: "Invalid path." });
      return;
    }
    if (fromResolved.relative === toResolved.relative) {
      res.json({ ok: true, fromPath, toPath });
      return;
    }
    try {
      await runSessionCommand(
        session,
        "/bin/mkdir",
        ["-p", path.dirname(toResolved.absPath)],
        { cwd: rootPath }
      );
      await runSessionCommand(
        session,
        "/bin/mv",
        ["-f", fromResolved.absPath, toResolved.absPath],
        { cwd: rootPath }
      );
      res.json({ ok: true, fromPath, toPath });
    } catch (error) {
      console.error("Failed to rename path:", {
        sessionId,
        worktreeId: req.params.worktreeId,
        fromPath,
        toPath,
        error: error?.message || error,
      });
      res.status(500).json({ error: "Failed to rename path." });
    }
  });

  router.post("/sessions/:sessionId/worktrees/:worktreeId/file/delete", async (req, res) => {
    const sessionId = req.params.sessionId;
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
    if (!requestedPath || typeof requestedPath !== "string") {
      res.status(400).json({ error: "Path is required." });
      return;
    }
    const resolved = resolveRelativePath(rootPath, requestedPath);
    if (!resolved) {
      res.status(400).json({ error: "Invalid path." });
      return;
    }
    try {
      await runSessionCommand(
        session,
        "/bin/rm",
        ["-rf", resolved.absPath],
        { cwd: rootPath }
      );
      res.json({ ok: true, path: requestedPath });
    } catch (error) {
      console.error("Failed to delete path:", {
        sessionId,
        worktreeId: req.params.worktreeId,
        path: requestedPath,
        error: error?.message || error,
      });
      res.status(500).json({ error: "Failed to delete path." });
    }
  });

  router.get("/sessions/:sessionId/worktrees/:worktreeId/status", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.delete("/sessions/:sessionId/worktrees/:worktreeId", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.patch("/sessions/:sessionId/worktrees/:worktreeId", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.get("/sessions/:sessionId/worktrees/:worktreeId/diff", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.get("/sessions/:sessionId/worktrees/:worktreeId/commits", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.post("/sessions/:sessionId/worktrees/:worktreeId/merge", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.post("/sessions/:sessionId/worktrees/:worktreeId/abort-merge", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  router.post("/sessions/:sessionId/worktrees/:worktreeId/cherry-pick", async (req, res) => {
    const sessionId = req.params.sessionId;
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

  return router;
}
