import { Router } from "express";
import storage from "../storage/index.js";
import {
  consumeMonoAuthToken,
  issueWorkspaceTokens,
  rotateWorkspaceRefreshToken,
} from "../services/auth.js";
import {
  workspaceIdPattern,
  createWorkspace,
  updateWorkspace,
  readWorkspaceConfig,
  verifyWorkspaceSecret,
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

const sessionUsesProvider = (session, provider) => {
  if (!session || !provider) {
    return false;
  }
  if (Array.isArray(session.providers) && session.providers.length) {
    return session.providers.includes(provider);
  }
  if (typeof session.activeProvider === "string") {
    return session.activeProvider === provider;
  }
  return false;
};

const providerHasActiveSessions = async (workspaceId, provider) => {
  const sessions = await storage.listSessions(workspaceId);
  return sessions.some((session) => sessionUsesProvider(session, provider));
};

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
  const deploymentMode = process.env.DEPLOYMENT_MODE;

  router.post("/workspaces", async (req, res) => {
    if (deploymentMode === "mono_user") {
      res.status(403).json({
        error: "Workspace creation is forbidden in mono_user mode.",
        error_type: "WORKSPACE_CREATE_FORBIDDEN",
      });
      return;
    }
    try {
      const providers = req.body?.providers;
      const result = await createWorkspace(providers);
      res.status(201).location(`/api/workspaces/${result.workspaceId}`).json(result);
    } catch (error) {
      res.status(400).json({ error: error.message || "Failed to create workspace." });
    }
  });

  router.post("/workspaces/login", async (req, res) => {
    const grantType = typeof req.body?.grantType === "string"
      ? req.body.grantType.trim()
      : "";
    if (grantType === "mono_auth_token") {
      if (deploymentMode !== "mono_user") {
        res.status(403).json({
          error: "Mono auth token grant is only available in mono_user mode.",
          error_type: "MONO_AUTH_FORBIDDEN",
        });
        return;
      }
      const monoAuthToken = typeof req.body?.monoAuthToken === "string"
        ? req.body.monoAuthToken.trim()
        : "";
      if (!monoAuthToken) {
        res.status(400).json({
          error: "monoAuthToken is required.",
          error_type: "MONO_AUTH_TOKEN_REQUIRED",
        });
        return;
      }
      const consumed = consumeMonoAuthToken(monoAuthToken);
      if (!consumed.ok || !consumed.workspaceId) {
        res.status(401).json({
          error: "Invalid mono auth token.",
          error_type: consumed.code || "MONO_AUTH_TOKEN_INVALID",
        });
        return;
      }
      try {
        await getWorkspaceUserIds(consumed.workspaceId);
        const tokens = await issueWorkspaceTokens(consumed.workspaceId);
        await appendAuditLog(consumed.workspaceId, "workspace_login_success", {
          grantType: "mono_auth_token",
        });
        res.json(tokens);
      } catch {
        await appendAuditLog(consumed.workspaceId, "workspace_login_failed", {
          grantType: "mono_auth_token",
        });
        res.status(401).json({
          error: "Invalid mono auth token.",
          error_type: "MONO_AUTH_TOKEN_INVALID",
        });
      }
      return;
    }

    if (deploymentMode === "mono_user") {
      res.status(403).json({
        error: "Workspace credentials login is forbidden in mono_user mode.",
        error_type: "WORKSPACE_LOGIN_FORBIDDEN",
      });
      return;
    }

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
      const matches = await verifyWorkspaceSecret(workspaceId, workspaceSecret);
      if (!matches) {
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
      const rotated = await rotateWorkspaceRefreshToken(refreshToken);
      if (!rotated?.ok) {
        res.status(rotated?.status || 401).json(
          rotated?.payload || { error: "Invalid refresh token.", code: "invalid_refresh_token" }
        );
        return;
      }
      res.json(rotated.payload);
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
      const providersToDisable = Object.entries(mergedProviders)
        .filter(([provider, config]) => {
          if (!config || typeof config !== "object") {
            return false;
          }
          const wasEnabled = Boolean(existing?.providers?.[provider]?.enabled);
          return wasEnabled && config.enabled === false;
        })
        .map(([provider]) => provider);
      if (providersToDisable.length) {
        for (const provider of providersToDisable) {
          if (await providerHasActiveSessions(workspaceId, provider)) {
            res.status(403).json({
              error: "Provider cannot be disabled: active sessions use it.",
            });
            return;
          }
        }
      }
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
    res.status(405).json({ error: "Workspace deletion is currently disabled." });
  });

  return router;
}
