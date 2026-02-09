import { Router } from "express";
import {
  getSession,
  touchSession,
  runSessionCommand,
  runSessionCommandOutput,
  getBranchInfo,
  broadcastRepoDiff,
  getRepoDiff,
  isValidProvider,
  modelCache,
  modelCacheTtlMs,
} from "../services/session.js";

export default function gitRoutes(deps) {
  const { getOrCreateClient } = deps;

  const router = Router();

  const readGitConfigValue = async (session, args) => {
    try {
      const output = await runSessionCommandOutput(session, "git", args);
      return output.trim();
    } catch (error) {
      return "";
    }
  };

  router.get("/sessions/:sessionId/git-identity", async (req, res) => {
    const session = await getSession(req.params.sessionId, req.workspaceId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    await touchSession(session);
    try {
      const [globalName, globalEmail, repoName, repoEmail] = await Promise.all([
        readGitConfigValue(session, ["config", "--global", "--get", "user.name"]),
        readGitConfigValue(session, ["config", "--global", "--get", "user.email"]),
        readGitConfigValue(session, [
          "-C",
          session.repoDir,
          "config",
          "--get",
          "user.name",
        ]),
        readGitConfigValue(session, [
          "-C",
          session.repoDir,
          "config",
          "--get",
          "user.email",
        ]),
      ]);
      const effectiveName = repoName || globalName;
      const effectiveEmail = repoEmail || globalEmail;
      res.json({
        global: { name: globalName || "", email: globalEmail || "" },
        repo: { name: repoName || "", email: repoEmail || "" },
        effective: { name: effectiveName || "", email: effectiveEmail || "" },
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to read git identity." });
    }
  });

  router.post("/sessions/:sessionId/git-identity", async (req, res) => {
    const session = await getSession(req.params.sessionId, req.workspaceId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    await touchSession(session);
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!name || !email) {
      res.status(400).json({ error: "name and email are required." });
      return;
    }
    try {
      await runSessionCommand(session, "git", [
        "-C",
        session.repoDir,
        "config",
        "user.name",
        name,
      ]);
      await runSessionCommand(session, "git", [
        "-C",
        session.repoDir,
        "config",
        "user.email",
        email,
      ]);
      res.json({ ok: true, repo: { name, email } });
    } catch (error) {
      res.status(500).json({ error: "Failed to update git identity." });
    }
  });

  router.get("/sessions/:sessionId/diff", async (req, res) => {
    const session = await getSession(req.params.sessionId, req.workspaceId);
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    await touchSession(session);
    const repoDiff = await getRepoDiff(session);
    res.json(repoDiff);
  });

  router.get("/branches", async (req, res) => {
    const sessionId = req.query.session;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);
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

  router.post("/branches/switch", async (req, res) => {
    const sessionId = req.body?.session;
    const target = req.body?.branch;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);
    if (!target || typeof target !== "string") {
      res.status(400).json({ error: "Branch is required." });
      return;
    }
    const branchName = target.replace(/^origin\//, "").trim();
    try {
      const dirty = await runSessionCommandOutput(session, "git", ["status", "--porcelain"], {
        cwd: session.repoDir,
      });
      if (dirty.trim()) {
        res.status(409).json({
          error: "Modifications locales detectees. Stashez ou committez avant.",
        });
        return;
      }

      try {
        await runSessionCommand(session, "git", ["check-ref-format", "--branch", branchName], {
          cwd: session.repoDir,
        });
      } catch (error) {
        res.status(400).json({ error: "Nom de branche invalide." });
        return;
      }
      await runSessionCommand(session, "git", ["fetch", "--prune"], {
        cwd: session.repoDir,
      });

      let switched = false;
      try {
        await runSessionCommand(session, "git", ["show-ref", "--verify", `refs/heads/${branchName}`], {
          cwd: session.repoDir,
        });
        await runSessionCommand(session, "git", ["switch", branchName], {
          cwd: session.repoDir,
        });
        switched = true;
      } catch (error) {
        // ignore and try remote
      }

      if (!switched) {
        try {
          await runSessionCommand(
            session,
            "git",
            ["show-ref", "--verify", `refs/remotes/origin/${branchName}`],
            { cwd: session.repoDir }
          );
        } catch (error) {
          res.status(404).json({ error: "Branche introuvable." });
          return;
        }
        await runSessionCommand(session, "git", ["switch", "--track", `origin/${branchName}`], {
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

  router.get("/models", async (req, res) => {
    const session = await getSession(req.query?.session, req.workspaceId);
    const provider = req.query?.provider;
    if (!session) {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    await touchSession(session);
    if (!isValidProvider(provider)) {
      res.status(400).json({ error: "Invalid provider. Must be 'codex' or 'claude'." });
      return;
    }
    if (
      Array.isArray(session.providers) &&
      session.providers.length &&
      !session.providers.includes(provider)
    ) {
      res.status(403).json({ error: "Provider not enabled for this session." });
      return;
    }

    try {
      const cached = modelCache.get(provider);
      if (cached && cached.expiresAt > Date.now()) {
        res.json({ models: cached.models, provider });
        return;
      }
      const client = await getOrCreateClient(session, provider);
      if (!client.ready) {
        await client.start();
      }
      let cursor = null;
      const models = [];
      do {
        const result = await client.listModels(cursor, 200);
        if (Array.isArray(result?.data)) {
          models.push(...result.data);
        }
        cursor = result?.nextCursor ?? null;
      } while (cursor);
      modelCache.set(provider, {
        models,
        expiresAt: Date.now() + modelCacheTtlMs,
      });
      res.json({ models, provider });
    } catch (error) {
      res.status(500).json({ error: error.message || "Failed to list models." });
    }
  });

  return router;
}
