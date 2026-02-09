import { Router } from "express";
import storage from "../storage/index.js";
import { hashRefreshToken } from "../helpers.js";
import { issueWorkspaceTokens } from "../services/auth.js";
import {
  workspaceIdPattern,
  createWorkspace,
  updateWorkspace,
  readWorkspaceConfig,
  readWorkspaceSecret,
  getWorkspaceUserIds,
  sanitizeProvidersForResponse,
  mergeProvidersForUpdate,
  appendAuditLog,
} from "../services/workspace.js";
import { getExistingSessionRuntime } from "../runtimeStore.js";

const isObject = (value) =>
  value != null && typeof value === "object" && !Array.isArray(value);

const stableStringify = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (!isObject(value)) {
    return JSON.stringify(value);
  }
  const keys = Object.keys(value).sort();
  const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
  return `{${entries.join(",")}}`;
};

const providersConfigChanged = (beforeConfig, afterConfig) =>
  stableStringify(beforeConfig ?? null) !== stableStringify(afterConfig ?? null);

const restartCodexClientsForWorkspace = async (workspaceId) => {
  const sessions = await storage.listSessions(workspaceId);
  for (const session of sessions) {
    if (!session?.sessionId) {
      continue;
    }
    const runtime = getExistingSessionRuntime(session.sessionId);
    if (!runtime) {
      continue;
    }
    const codexClient = runtime?.clients?.codex;
    if (codexClient) {
      if (codexClient.getStatus?.() === "idle") {
        await codexClient.restart?.();
      } else {
        codexClient.requestRestart?.();
      }
    }
    if (runtime?.worktreeClients instanceof Map) {
      for (const client of runtime.worktreeClients.values()) {
        if (!client || client?.constructor?.name !== "CodexAppServerClient") {
          continue;
        }
        if (client.getStatus?.() === "idle") {
          await client.restart?.();
        } else {
          client.requestRestart?.();
        }
      }
    }
  }
};

export default function workspaceRoutes() {
  const router = Router();

  router.post("/workspaces", async (req, res) => {
    try {
      const providers = req.body?.providers;
      const result = await createWorkspace(providers);
      res.status(201).location(`/api/workspaces/${result.workspaceId}`).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to create workspace." });
    }
  });

  router.post("/workspaces/login", async (req, res) => {
    const workspaceId = req.body?.workspaceId;
    const workspaceSecret = req.body?.workspaceSecret;
    if (!workspaceId || !workspaceSecret) {
      res.status(401).json({ error: "Invalid workspace credentials." });
      return;
    }
    if (!workspaceIdPattern.test(workspaceId)) {
      res.status(401).json({ error: "Invalid workspace credentials." });
      return;
    }
    try {
      const storedSecret = await readWorkspaceSecret(workspaceId);
      if (storedSecret !== workspaceSecret) {
        await appendAuditLog(workspaceId, "workspace_login_failed");
        res.status(401).json({ error: "Invalid workspace credentials." });
        return;
      }
      await getWorkspaceUserIds(workspaceId);
      const tokens = await issueWorkspaceTokens(workspaceId);
      await appendAuditLog(workspaceId, "workspace_login_success");
      res.json(tokens);
    } catch (error) {
      await appendAuditLog(workspaceId, "workspace_login_failed");
      res.status(401).json({ error: "Invalid workspace credentials." });
    }
  });

  router.post("/workspaces/refresh", async (req, res) => {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken || typeof refreshToken !== "string") {
      res.status(400).json({ error: "refreshToken is required." });
      return;
    }
    try {
      const tokenHash = hashRefreshToken(refreshToken);
      const record = await storage.getWorkspaceRefreshToken(tokenHash);
      if (!record?.workspaceId) {
        res.status(401).json({ error: "Invalid refresh token." });
        return;
      }
      if (record.expiresAt && record.expiresAt <= Date.now()) {
        await storage.deleteWorkspaceRefreshToken(tokenHash);
        res.status(401).json({ error: "Refresh token expired." });
        return;
      }
      await storage.deleteWorkspaceRefreshToken(tokenHash);
      const tokens = await issueWorkspaceTokens(record.workspaceId);
      res.json(tokens);
    } catch (error) {
      res.status(500).json({ error: "Failed to refresh workspace token." });
    }
  });

  router.get("/workspaces/:workspaceId", async (req, res) => {
    const workspaceId = req.params.workspaceId;
    if (!workspaceIdPattern.test(workspaceId)) {
      res.status(400).json({ error: "Invalid workspaceId." });
      return;
    }
    if (req.workspaceId && req.workspaceId !== workspaceId) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
    try {
      const config = await readWorkspaceConfig(workspaceId);
      res.json({ workspaceId, providers: sanitizeProvidersForResponse(config?.providers) });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to load workspace." });
    }
  });

  router.patch("/workspaces/:workspaceId", async (req, res) => {
    const workspaceId = req.params.workspaceId;
    if (!workspaceIdPattern.test(workspaceId)) {
      res.status(400).json({ error: "Invalid workspaceId." });
      return;
    }
    if (req.workspaceId && req.workspaceId !== workspaceId) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
    try {
      const existing = await readWorkspaceConfig(workspaceId).catch(() => null);
      const mergedProviders = mergeProvidersForUpdate(
        existing?.providers || {},
        req.body?.providers || {}
      );
      const codexChanged = providersConfigChanged(
        existing?.providers?.codex,
        mergedProviders?.codex
      );
      const payload = await updateWorkspace(workspaceId, mergedProviders);
      if (codexChanged) {
        await restartCodexClientsForWorkspace(workspaceId);
      }
      res.json({ workspaceId, providers: sanitizeProvidersForResponse(payload.providers) });
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to update workspace." });
    }
  });

  router.delete("/workspaces/:workspaceId", async (req, res) => {
    const workspaceId = req.params.workspaceId;
    if (!workspaceIdPattern.test(workspaceId)) {
      res.status(400).json({ error: "Invalid workspaceId." });
      return;
    }
    if (req.workspaceId && req.workspaceId !== workspaceId) {
      res.status(403).json({ error: "Forbidden." });
      return;
    }
    res.status(501).json({ error: "Workspace deletion policy not implemented yet." });
  });

  return router;
}
