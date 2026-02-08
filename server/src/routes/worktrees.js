import path from "path";
import { Router } from "express";
import {
  getSession,
  touchSession,
  runSessionCommandOutput,
  resolveWorktreeRoot,
  buildDirectoryTree,
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
import { getSessionTmpDir } from "../helpers.js";
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
} from "../worktreeManager.js";

export default function worktreeRoutes(deps) {
  const {
    getOrCreateClient,
    attachClientEventsForWorktree,
    attachClaudeEventsForWorktree,
  } = deps;

  const router = Router();

  router.get("/worktrees", async (req, res) => {
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

  router.post("/worktree", async (req, res) => {
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

      if (worktree.client) {
        if (provider === "claude") {
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

  router.get("/worktree/:worktreeId", async (req, res) => {
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
      const limitValue = Number.parseInt(req.query?.limit, 10);
      const limit =
        Number.isFinite(limitValue) && limitValue > 0 ? limitValue : 50;
      const messages = await getWorktreeMessages(session, worktree.id, {
        limit,
        beforeMessageId: null,
      });
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
        messages,
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

  router.get("/worktree/:worktreeId/tree", async (req, res) => {
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

  router.get("/worktree/:worktreeId/file", async (req, res) => {
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

  router.post("/worktree/:worktreeId/file", async (req, res) => {
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

  router.get("/worktree/:worktreeId/status", async (req, res) => {
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

  router.delete("/worktree/:worktreeId", async (req, res) => {
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

  router.patch("/worktree/:worktreeId", async (req, res) => {
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

  router.get("/worktree/:worktreeId/diff", async (req, res) => {
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

  router.get("/worktree/:worktreeId/commits", async (req, res) => {
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

  router.post("/worktree/:worktreeId/merge", async (req, res) => {
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

  router.post("/worktree/:worktreeId/abort-merge", async (req, res) => {
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

  router.post("/worktree/:worktreeId/cherry-pick", async (req, res) => {
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

  return router;
}
