#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const { Command } = require("commander");
const fs = require("fs");
const path = require("path");
const os = require("os");

const rootDir = path.resolve(__dirname, "..");
const homeDir = process.env.HOME || os.homedir();
const defaultEnv = {
  DEPLOYMENT_MODE: "mono_user",
  VIBE80_DATA_DIRECTORY: path.join(homeDir, ".vibe80"),
  STORAGE_BACKEND: "sqlite",
};
const monoAuthUrlFile = path.join(
  os.tmpdir(),
  `vibe80-mono-auth-${process.pid}-${Date.now()}.url`
);
const defaultBaseUrl = process.env.VIBE80_BASE_URL || "http://localhost:5179";

const resolveCliStatePath = () => {
  const dataDir = process.env.VIBE80_DATA_DIRECTORY || defaultEnv.VIBE80_DATA_DIRECTORY;
  return path.join(dataDir, "cli", "state.json");
};

const loadCliState = () => {
  const statePath = resolveCliStatePath();
  if (!fs.existsSync(statePath)) {
    return {
      version: 1,
      currentWorkspaceId: null,
      workspaces: {},
      currentSessionByWorkspace: {},
      sessionsByWorkspace: {},
      currentWorktreeBySession: {},
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return {
        version: 1,
        currentWorkspaceId: null,
        workspaces: {},
        currentSessionByWorkspace: {},
        sessionsByWorkspace: {},
        currentWorktreeBySession: {},
      };
    }
    return {
      version: 1,
      currentWorkspaceId:
        typeof parsed.currentWorkspaceId === "string" && parsed.currentWorkspaceId
          ? parsed.currentWorkspaceId
          : null,
      workspaces:
        parsed.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {},
      currentSessionByWorkspace:
        parsed.currentSessionByWorkspace && typeof parsed.currentSessionByWorkspace === "object"
          ? parsed.currentSessionByWorkspace
          : {},
      sessionsByWorkspace:
        parsed.sessionsByWorkspace && typeof parsed.sessionsByWorkspace === "object"
          ? parsed.sessionsByWorkspace
          : {},
      currentWorktreeBySession:
        parsed.currentWorktreeBySession && typeof parsed.currentWorktreeBySession === "object"
          ? parsed.currentWorktreeBySession
          : {},
    };
  } catch {
    return {
      version: 1,
      currentWorkspaceId: null,
      workspaces: {},
      currentSessionByWorkspace: {},
      sessionsByWorkspace: {},
      currentWorktreeBySession: {},
    };
  }
};

const saveCliState = (state) => {
  const statePath = resolveCliStatePath();
  fs.mkdirSync(path.dirname(statePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
};

const normalizeBaseUrl = (baseUrl) => String(baseUrl || defaultBaseUrl).replace(/\/+$/, "");

const toIsoStringOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const maskToken = (value) => {
  if (!value || typeof value !== "string") return "";
  if (value.length <= 12) return `${value.slice(0, 3)}...${value.slice(-3)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
};

const ensureWorkspaceEntry = (state, workspaceId) => {
  const id = String(workspaceId || "").trim();
  if (!id) {
    throw new Error("workspaceId is required.");
  }
  if (!state.workspaces[id] || typeof state.workspaces[id] !== "object") {
    state.workspaces[id] = { workspaceId: id, baseUrl: normalizeBaseUrl(defaultBaseUrl) };
  }
  if (!state.workspaces[id].workspaceId) {
    state.workspaces[id].workspaceId = id;
  }
  if (!state.workspaces[id].baseUrl) {
    state.workspaces[id].baseUrl = normalizeBaseUrl(defaultBaseUrl);
  }
  return state.workspaces[id];
};

const ensureSessionWorkspaceMap = (state, workspaceId) => {
  const id = String(workspaceId || "").trim();
  if (!id) {
    throw new Error("workspaceId is required.");
  }
  if (!state.sessionsByWorkspace || typeof state.sessionsByWorkspace !== "object") {
    state.sessionsByWorkspace = {};
  }
  if (
    !state.sessionsByWorkspace[id]
    || typeof state.sessionsByWorkspace[id] !== "object"
    || Array.isArray(state.sessionsByWorkspace[id])
  ) {
    state.sessionsByWorkspace[id] = {};
  }
  if (!state.currentSessionByWorkspace || typeof state.currentSessionByWorkspace !== "object") {
    state.currentSessionByWorkspace = {};
  }
  return state.sessionsByWorkspace[id];
};

const setCurrentSessionForWorkspace = (state, workspaceId, sessionId) => {
  ensureSessionWorkspaceMap(state, workspaceId);
  if (!sessionId) {
    delete state.currentSessionByWorkspace[workspaceId];
    return;
  }
  state.currentSessionByWorkspace[workspaceId] = sessionId;
};

const getCurrentSessionForWorkspace = (state, workspaceId) =>
  state.currentSessionByWorkspace?.[workspaceId] || null;

const upsertKnownSession = (state, workspaceId, session) => {
  const map = ensureSessionWorkspaceMap(state, workspaceId);
  const sessionId = String(session?.sessionId || "").trim();
  if (!sessionId) {
    return;
  }
  map[sessionId] = {
    sessionId,
    name: session.name || "",
    repoUrl: session.repoUrl || "",
    createdAt: session.createdAt || null,
    lastActivityAt: session.lastActivityAt || null,
    defaultProvider: session.defaultProvider || session.activeProvider || null,
    providers: Array.isArray(session.providers) ? session.providers : [],
  };
};

const getSessionKey = (workspaceId, sessionId) => `${workspaceId}/${sessionId}`;

const setCurrentWorktreeForSession = (state, workspaceId, sessionId, worktreeId) => {
  if (!state.currentWorktreeBySession || typeof state.currentWorktreeBySession !== "object") {
    state.currentWorktreeBySession = {};
  }
  const key = getSessionKey(workspaceId, sessionId);
  if (!worktreeId) {
    delete state.currentWorktreeBySession[key];
    return;
  }
  state.currentWorktreeBySession[key] = worktreeId;
};

const getCurrentWorktreeForSession = (state, workspaceId, sessionId) =>
  state.currentWorktreeBySession?.[getSessionKey(workspaceId, sessionId)] || null;

const parseListOption = (value, previous = []) => {
  const parts = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...previous, ...parts];
};

const parseRepeatOption = (value, previous = []) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return previous;
  }
  return [...previous, trimmed];
};

const parseProviderName = (value) => {
  const provider = String(value || "").trim().toLowerCase();
  if (provider !== "codex" && provider !== "claude") {
    throw new Error(`Unknown provider "${value}". Use codex or claude.`);
  }
  return provider;
};

const buildProvidersPatch = (options) => {
  const patch = {};
  for (const providerName of options.enable || []) {
    const provider = parseProviderName(providerName);
    patch[provider] = { ...(patch[provider] || {}), enabled: true };
  }
  for (const providerName of options.disable || []) {
    const provider = parseProviderName(providerName);
    patch[provider] = { ...(patch[provider] || {}), enabled: false };
  }

  if (options.codexAuthType || options.codexAuthValue) {
    patch.codex = {
      ...(patch.codex || {}),
      auth: {
        type: options.codexAuthType || "api_key",
        value: options.codexAuthValue || "",
      },
    };
  }
  if (options.claudeAuthType || options.claudeAuthValue) {
    patch.claude = {
      ...(patch.claude || {}),
      auth: {
        type: options.claudeAuthType || "api_key",
        value: options.claudeAuthValue || "",
      },
    };
  }
  return patch;
};

const apiRequest = async ({ baseUrl, pathname, method = "GET", body, workspaceToken }) => {
  const url = `${normalizeBaseUrl(baseUrl)}${pathname}`;
  const headers = {};
  if (workspaceToken) {
    headers.authorization = `Bearer ${workspaceToken}`;
  }
  if (body != null) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = { raw };
    }
  }
  if (!response.ok) {
    const message =
      payload?.error || payload?.message || payload?.code || `Request failed (${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    error.url = url;
    throw error;
  }
  return payload || {};
};

const isAccessTokenFresh = (entry, skewMs = 30 * 1000) => {
  const token = typeof entry?.workspaceToken === "string" ? entry.workspaceToken : "";
  if (!token) {
    return false;
  }
  const expiresAt = Date.parse(entry?.expiresAt || "");
  if (!Number.isFinite(expiresAt)) {
    return true;
  }
  return Date.now() + skewMs < expiresAt;
};

const refreshWorkspaceAccessToken = async ({
  state,
  workspaceId,
  entry,
  baseUrl,
}) => {
  if (!entry?.refreshToken) {
    throw new Error(`No refresh token saved for workspace "${workspaceId}". Run workspace login first.`);
  }
  const payload = await apiRequest({
    baseUrl,
    pathname: "/api/v1/workspaces/refresh",
    method: "POST",
    body: { refreshToken: entry.refreshToken },
  });
  upsertWorkspaceFromTokens(state, payload.workspaceId || workspaceId, baseUrl, payload, null);
  const updatedId = payload.workspaceId || workspaceId;
  const updatedEntry = ensureWorkspaceEntry(state, updatedId);
  saveCliState(state);
  return { workspaceId: updatedId, entry: updatedEntry };
};

const ensureWorkspaceAccessToken = async ({
  state,
  workspaceId,
  entry,
  baseUrl,
}) => {
  if (isAccessTokenFresh(entry)) {
    return { workspaceId, entry };
  }
  if (!entry?.refreshToken) {
    if (entry?.workspaceToken) {
      return { workspaceId, entry };
    }
    throw new Error(`No workspace token/refresh token for "${workspaceId}". Run workspace login first.`);
  }
  return refreshWorkspaceAccessToken({ state, workspaceId, entry, baseUrl });
};

const authedApiRequest = async ({
  state,
  workspaceId,
  entry,
  baseUrl,
  retryOnUnauthorized = true,
  ...request
}) => {
  const ensured = await ensureWorkspaceAccessToken({ state, workspaceId, entry, baseUrl });
  let activeWorkspaceId = ensured.workspaceId;
  let activeEntry = ensured.entry;
  try {
    return await apiRequest({
      baseUrl,
      workspaceToken: activeEntry.workspaceToken,
      ...request,
    });
  } catch (error) {
    if (!retryOnUnauthorized || error?.status !== 401) {
      throw error;
    }
    const refreshed = await refreshWorkspaceAccessToken({
      state,
      workspaceId: activeWorkspaceId,
      entry: activeEntry,
      baseUrl,
    });
    activeWorkspaceId = refreshed.workspaceId;
    activeEntry = refreshed.entry;
    return apiRequest({
      baseUrl,
      workspaceToken: activeEntry.workspaceToken,
      ...request,
    });
  }
};

const spawnProcess = (cmd, args, label, extraEnv = {}) => {
  const child = spawn(cmd, args, {
    cwd: rootDir,
    env: {
      ...defaultEnv,
      ...process.env,
      ...extraEnv,
    },
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[vibe80] Failed to start ${label}:`, error.message || error);
  });

  return child;
};

let server = null;
let shuttingDown = false;

const unlinkMonoAuthUrlFile = () => {
  try {
    fs.unlinkSync(monoAuthUrlFile);
  } catch {
    // ignore
  }
};

const tryOpenUrl = (url) =>
  new Promise((resolve) => {
    if (!url) {
      resolve(false);
      return;
    }
    const openCommand = process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
    const args = process.platform === "darwin"
      ? [url]
      : process.platform === "win32"
        ? ["/c", "start", "", url]
        : [url];
    const opener = spawn(openCommand, args, {
      stdio: "ignore",
      detached: true,
    });
    opener.on("error", () => resolve(false));
    opener.on("exit", (code) => resolve(code === 0));
    opener.unref();
  });

const waitForMonoAuthUrl = (timeoutMs = 15000) =>
  new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      if (Date.now() >= deadline) {
        resolve("");
        return;
      }
      let url = "";
      try {
        if (fs.existsSync(monoAuthUrlFile)) {
          url = fs.readFileSync(monoAuthUrlFile, "utf8").trim();
        }
      } catch {
        url = "";
      }
      if (url) {
        resolve(url);
        return;
      }
      setTimeout(poll, 250);
    };
    poll();
  });

const maybeOpenMonoAuthUrl = async (serverPort) => {
  const deploymentMode = process.env.DEPLOYMENT_MODE || defaultEnv.DEPLOYMENT_MODE;
  if (deploymentMode !== "mono_user") {
    return;
  }
  const url = await waitForMonoAuthUrl();
  if (!url) {
    console.log(`==> Open this URL to access the application: http://localhost:${serverPort}`);
    return;
  }
  const opened = await tryOpenUrl(url);
  if (!opened) {
    console.log(`==> Open this URL to authenticate: ${url}`);
  }
};

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  unlinkMonoAuthUrlFile();
  if (server?.pid) {
    server.kill("SIGTERM");
  }
  process.exit(code);
};

const startServer = (options = {}) => {
  const enableCodexFromCli = Boolean(options.codex);
  const enableClaudeFromCli = Boolean(options.claude);
  const shouldOpenBrowser = options.open !== false;
  const serverPort = options.port || process.env.PORT || "5179";

  unlinkMonoAuthUrlFile();
  const monoProviderEnv = {};
  if (enableCodexFromCli) {
    monoProviderEnv.VIBE80_MONO_ENABLE_CODEX = "true";
  }
  if (enableClaudeFromCli) {
    monoProviderEnv.VIBE80_MONO_ENABLE_CLAUDE = "true";
  }
  if (options.dataDir) {
    monoProviderEnv.VIBE80_DATA_DIRECTORY = path.resolve(options.dataDir);
  }
  if (options.storageBackend) {
    monoProviderEnv.STORAGE_BACKEND = options.storageBackend;
  }
  monoProviderEnv.PORT = String(serverPort);

  server = spawnProcess(
    process.execPath,
    ["server/src/index.js"],
    "server",
    {
      VIBE80_MONO_AUTH_URL_FILE: monoAuthUrlFile,
      ...monoProviderEnv,
    }
  );
  if (shouldOpenBrowser) {
    void maybeOpenMonoAuthUrl(serverPort);
  }

  server.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (code && code !== 0) {
      shutdown(code);
      return;
    }
    if (signal && signal !== "SIGTERM") {
      shutdown(1);
      return;
    }
    shutdown(0);
  });
};

const resolveWorkspaceForCommand = (state, workspaceIdArg) => {
  const workspaceId = workspaceIdArg || state.currentWorkspaceId;
  if (!workspaceId) {
    throw new Error("No workspace selected. Use `vibe80 workspace use <workspaceId>`.");
  }
  const entry = state.workspaces[workspaceId];
  if (!entry) {
    throw new Error(`Unknown workspace "${workspaceId}".`);
  }
  return { workspaceId, entry };
};

const upsertWorkspaceFromTokens = (state, workspaceId, baseUrl, payload, workspaceSecret) => {
  const entry = ensureWorkspaceEntry(state, workspaceId);
  entry.baseUrl = normalizeBaseUrl(baseUrl || entry.baseUrl || defaultBaseUrl);
  if (workspaceSecret) {
    entry.workspaceSecret = workspaceSecret;
  }
  if (payload.workspaceToken) {
    entry.workspaceToken = payload.workspaceToken;
  }
  if (payload.refreshToken) {
    entry.refreshToken = payload.refreshToken;
  }
  if (payload.expiresIn) {
    entry.expiresAt = new Date(Date.now() + Number(payload.expiresIn) * 1000).toISOString();
  }
  if (payload.refreshExpiresIn) {
    entry.refreshExpiresAt = new Date(
      Date.now() + Number(payload.refreshExpiresIn) * 1000
    ).toISOString();
  }
  entry.lastLoginAt = new Date().toISOString();
  state.currentWorkspaceId = workspaceId;
};

const program = new Command();

program
  .name("vibe80")
  .description("Vibe80 CLI")
  .showHelpAfterError()
  .showSuggestionAfterError(true);

program
  .command("run")
  .description("Run the Vibe80 server (mono_user by default)")
  .option("--codex", "Enable Codex provider in mono_user mode")
  .option("--claude", "Enable Claude provider in mono_user mode")
  .option("--port <port>", "Server port (default: 5179)")
  .option("--data-dir <path>", "Override VIBE80_DATA_DIRECTORY")
  .option("--storage-backend <backend>", "Override STORAGE_BACKEND (default: sqlite)")
  .option("--no-open", "Do not auto-open authentication URL in a browser")
  .action((options) => {
    startServer(options);
  });

const workspaceCommand = program
  .command("workspace")
  .alias("ws")
  .description("Manage workspace context and authentication");

workspaceCommand
  .command("ls")
  .description("List known local workspaces")
  .option("--json", "Output JSON")
  .action((options) => {
    const state = loadCliState();
    const rows = Object.values(state.workspaces).map((entry) => ({
      workspaceId: entry.workspaceId,
      current: state.currentWorkspaceId === entry.workspaceId,
      baseUrl: entry.baseUrl || normalizeBaseUrl(defaultBaseUrl),
      hasToken: Boolean(entry.workspaceToken),
      hasRefreshToken: Boolean(entry.refreshToken),
      lastLoginAt: toIsoStringOrNull(entry.lastLoginAt),
    }));
    rows.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
    if (options.json) {
      console.log(JSON.stringify({ currentWorkspaceId: state.currentWorkspaceId, workspaces: rows }, null, 2));
      return;
    }
    if (!rows.length) {
      console.log("No workspace saved locally.");
      return;
    }
    for (const row of rows) {
      const currentLabel = row.current ? "*" : " ";
      const tokenLabel = row.hasToken ? "token" : "no-token";
      console.log(
        `${currentLabel} ${row.workspaceId}  (${tokenLabel})  ${row.baseUrl}${row.lastLoginAt ? `  lastLogin=${row.lastLoginAt}` : ""}`
      );
    }
  });

workspaceCommand
  .command("current")
  .description("Show current workspace")
  .option("--json", "Output JSON")
  .action((options) => {
    const state = loadCliState();
    const workspaceId = state.currentWorkspaceId;
    if (!workspaceId) {
      console.log("No current workspace selected.");
      return;
    }
    const entry = state.workspaces[workspaceId] || { workspaceId };
    const payload = {
      workspaceId,
      baseUrl: entry.baseUrl || normalizeBaseUrl(defaultBaseUrl),
      hasToken: Boolean(entry.workspaceToken),
      hasRefreshToken: Boolean(entry.refreshToken),
      lastLoginAt: toIsoStringOrNull(entry.lastLoginAt),
    };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(payload.workspaceId);
  });

workspaceCommand
  .command("use <workspaceId>")
  .description("Set current workspace")
  .option("--base-url <url>", "Default API base URL for this workspace")
  .action((workspaceId, options) => {
    const state = loadCliState();
    const entry = ensureWorkspaceEntry(state, workspaceId);
    if (options.baseUrl) {
      entry.baseUrl = normalizeBaseUrl(options.baseUrl);
    }
    state.currentWorkspaceId = workspaceId;
    saveCliState(state);
    console.log(`Current workspace: ${workspaceId}`);
  });

workspaceCommand
  .command("show [workspaceId]")
  .description("Show workspace details (local + remote when possible)")
  .option("--base-url <url>", "Override API base URL for remote call")
  .option("--json", "Output JSON")
  .action(async (workspaceIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, entry } = resolveWorkspaceForCommand(state, workspaceIdArg);
    const baseUrl = normalizeBaseUrl(options.baseUrl || entry.baseUrl || defaultBaseUrl);
    const localPayload = {
      workspaceId,
      baseUrl,
      workspaceSecretSaved: Boolean(entry.workspaceSecret),
      workspaceToken: entry.workspaceToken ? maskToken(entry.workspaceToken) : null,
      refreshToken: entry.refreshToken ? maskToken(entry.refreshToken) : null,
      expiresAt: toIsoStringOrNull(entry.expiresAt),
      refreshExpiresAt: toIsoStringOrNull(entry.refreshExpiresAt),
      lastLoginAt: toIsoStringOrNull(entry.lastLoginAt),
    };
    let remotePayload = null;
    let remoteError = null;
    if (entry.workspaceToken || entry.refreshToken) {
      try {
        remotePayload = await authedApiRequest({
          state,
          workspaceId,
          entry,
          baseUrl,
          pathname: `/api/v1/workspaces/${workspaceId}`,
        });
      } catch (error) {
        remoteError = error.message || String(error);
      }
    }
    const payload = { local: localPayload, remote: remotePayload, remoteError };
    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Workspace: ${workspaceId}`);
    console.log(`Base URL: ${baseUrl}`);
    if (remotePayload) {
      console.log("Remote providers:");
      console.log(JSON.stringify(remotePayload.providers || {}, null, 2));
    } else if (remoteError) {
      console.log(`Remote check failed: ${remoteError}`);
    } else {
      console.log("Remote check skipped (no workspace token saved).");
    }
  });

workspaceCommand
  .command("login")
  .description("Login workspace and persist tokens locally")
  .option("--workspace-id <id>", "Workspace ID")
  .option("--workspace-secret <secret>", "Workspace secret (multi_user)")
  .option("--mono-auth-token <token>", "One-shot mono auth token (mono_user)")
  .option("--base-url <url>", "API base URL (default: http://localhost:5179)")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const baseUrl = normalizeBaseUrl(options.baseUrl || defaultBaseUrl);
    const payload = options.monoAuthToken
      ? {
          grantType: "mono_auth_token",
          monoAuthToken: String(options.monoAuthToken),
        }
      : {
          workspaceId: options.workspaceId,
          workspaceSecret: options.workspaceSecret,
        };
    const response = await apiRequest({
      baseUrl,
      pathname: "/api/v1/workspaces/login",
      method: "POST",
      body: payload,
    });
    const workspaceId =
      response.workspaceId || options.workspaceId || state.currentWorkspaceId || "default";
    upsertWorkspaceFromTokens(
      state,
      workspaceId,
      baseUrl,
      response,
      options.workspaceSecret || null
    );
    saveCliState(state);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            workspaceId,
            expiresAt: state.workspaces[workspaceId]?.expiresAt || null,
            refreshExpiresAt: state.workspaces[workspaceId]?.refreshExpiresAt || null,
          },
          null,
          2
        )
      );
      return;
    }
    console.log(`Workspace login success: ${workspaceId}`);
  });

workspaceCommand
  .command("refresh")
  .description("Refresh workspace token with saved refresh token")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, entry } = resolveWorkspaceForCommand(state, options.workspaceId);
    if (!entry.refreshToken) {
      throw new Error(`No refresh token saved for workspace "${workspaceId}".`);
    }
    const baseUrl = normalizeBaseUrl(options.baseUrl || entry.baseUrl || defaultBaseUrl);
    const response = await apiRequest({
      baseUrl,
      pathname: "/api/v1/workspaces/refresh",
      method: "POST",
      body: { refreshToken: entry.refreshToken },
    });
    upsertWorkspaceFromTokens(state, response.workspaceId || workspaceId, baseUrl, response, null);
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Workspace token refreshed: ${response.workspaceId || workspaceId}`);
  });

workspaceCommand
  .command("logout")
  .description("Delete saved tokens for a workspace")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .action((options) => {
    const state = loadCliState();
    const { workspaceId, entry } = resolveWorkspaceForCommand(state, options.workspaceId);
    delete entry.workspaceToken;
    delete entry.refreshToken;
    delete entry.expiresAt;
    delete entry.refreshExpiresAt;
    saveCliState(state);
    console.log(`Logged out: ${workspaceId}`);
  });

workspaceCommand
  .command("create")
  .description("Create a workspace")
  .option("--base-url <url>", "API base URL")
  .option("--enable <provider>", "Enable provider (repeatable, supports comma-separated)", parseListOption, [])
  .option("--codex-auth-type <type>", "Codex auth type (api_key|auth_json_b64)")
  .option("--codex-auth-value <value>", "Codex auth value")
  .option("--claude-auth-type <type>", "Claude auth type (api_key|setup_token)")
  .option("--claude-auth-value <value>", "Claude auth value")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const patch = buildProvidersPatch(options);
    const baseUrl = normalizeBaseUrl(options.baseUrl || defaultBaseUrl);
    const response = await apiRequest({
      baseUrl,
      pathname: "/api/v1/workspaces",
      method: "POST",
      body: { providers: patch },
    });
    const state = loadCliState();
    const entry = ensureWorkspaceEntry(state, response.workspaceId);
    entry.baseUrl = baseUrl;
    entry.workspaceSecret = response.workspaceSecret || null;
    state.currentWorkspaceId = response.workspaceId;
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Workspace created: ${response.workspaceId}`);
    if (response.workspaceSecret) {
      console.log(`Workspace secret: ${response.workspaceSecret}`);
    }
  });

workspaceCommand
  .command("update <workspaceId>")
  .description("Update workspace providers/auth config")
  .option("--base-url <url>", "API base URL")
  .option("--enable <provider>", "Enable provider (repeatable, supports comma-separated)", parseListOption, [])
  .option("--disable <provider>", "Disable provider (repeatable, supports comma-separated)", parseListOption, [])
  .option("--codex-auth-type <type>", "Codex auth type (api_key|auth_json_b64)")
  .option("--codex-auth-value <value>", "Codex auth value")
  .option("--claude-auth-type <type>", "Claude auth type (api_key|setup_token)")
  .option("--claude-auth-value <value>", "Claude auth value")
  .option("--json", "Output JSON")
  .action(async (workspaceId, options) => {
    const state = loadCliState();
    const entry = ensureWorkspaceEntry(state, workspaceId);
    const baseUrl = normalizeBaseUrl(options.baseUrl || entry.baseUrl || defaultBaseUrl);
    const patch = buildProvidersPatch(options);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/workspaces/${workspaceId}`,
      method: "PATCH",
      body: { providers: patch },
    });
    entry.baseUrl = baseUrl;
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Workspace updated: ${workspaceId}`);
  });

workspaceCommand
  .command("rm <workspaceId>")
  .description("Delete workspace (server policy may refuse)")
  .option("--base-url <url>", "API base URL")
  .option("--yes", "Confirm deletion")
  .action(async (workspaceId, options) => {
    if (!options.yes) {
      throw new Error("Refusing to delete without --yes.");
    }
    const state = loadCliState();
    const entry = ensureWorkspaceEntry(state, workspaceId);
    const baseUrl = normalizeBaseUrl(options.baseUrl || entry.baseUrl || defaultBaseUrl);
    await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/workspaces/${workspaceId}`,
      method: "DELETE",
    });
    delete state.workspaces[workspaceId];
    if (state.currentWorkspaceId === workspaceId) {
      state.currentWorkspaceId = null;
    }
    saveCliState(state);
    console.log(`Workspace deleted: ${workspaceId}`);
  });

const resolveWorkspaceAuthContext = async (state, options = {}) => {
  const { workspaceId, entry } = resolveWorkspaceForCommand(state, options.workspaceId);
  const baseUrl = normalizeBaseUrl(options.baseUrl || entry.baseUrl || defaultBaseUrl);
  const ensured = await ensureWorkspaceAccessToken({
    state,
    workspaceId,
    entry,
    baseUrl,
  });
  return {
    workspaceId: ensured.workspaceId,
    entry: ensured.entry,
    baseUrl,
  };
};

const resolveSessionForCommand = (state, workspaceId, sessionIdArg) => {
  const sessionId = sessionIdArg || getCurrentSessionForWorkspace(state, workspaceId);
  if (!sessionId) {
    throw new Error("No session selected. Use `vibe80 session use <sessionId>`.");
  }
  return sessionId;
};

const sessionCommand = program
  .command("session")
  .alias("s")
  .description("Manage sessions for the current workspace");

sessionCommand
  .command("ls")
  .description("List sessions from API for the selected workspace")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry } = await resolveWorkspaceAuthContext(state, options);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: "/api/v1/sessions",
    });
    const sessions = Array.isArray(response.sessions) ? response.sessions : [];
    for (const session of sessions) {
      upsertKnownSession(state, workspaceId, session);
    }
    saveCliState(state);
    const currentSessionId = getCurrentSessionForWorkspace(state, workspaceId);
    if (options.json) {
      console.log(JSON.stringify({ workspaceId, currentSessionId, sessions }, null, 2));
      return;
    }
    if (!sessions.length) {
      console.log("No session found.");
      return;
    }
    for (const session of sessions) {
      const marker = currentSessionId === session.sessionId ? "*" : " ";
      const name = session.name ? ` name="${session.name}"` : "";
      const repo = session.repoUrl ? ` repo=${session.repoUrl}` : "";
      console.log(`${marker} ${session.sessionId}${name}${repo}`);
    }
  });

sessionCommand
  .command("current")
  .description("Show current session in selected workspace")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--json", "Output JSON")
  .action((options) => {
    const state = loadCliState();
    const { workspaceId } = resolveWorkspaceForCommand(state, options.workspaceId);
    const currentSessionId = getCurrentSessionForWorkspace(state, workspaceId);
    if (options.json) {
      console.log(JSON.stringify({ workspaceId, sessionId: currentSessionId }, null, 2));
      return;
    }
    if (!currentSessionId) {
      console.log("No current session selected.");
      return;
    }
    console.log(currentSessionId);
  });

sessionCommand
  .command("use <sessionId>")
  .description("Set current session for current workspace")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .action((sessionId, options) => {
    const state = loadCliState();
    const { workspaceId } = resolveWorkspaceForCommand(state, options.workspaceId);
    ensureSessionWorkspaceMap(state, workspaceId);
    setCurrentSessionForWorkspace(state, workspaceId, sessionId);
    saveCliState(state);
    console.log(`Current session (${workspaceId}): ${sessionId}`);
  });

sessionCommand
  .command("show [sessionId]")
  .description("Show session details")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (sessionIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry } = await resolveWorkspaceAuthContext(state, options);
    const sessionId = resolveSessionForCommand(state, workspaceId, sessionIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}`,
    });
    upsertKnownSession(state, workspaceId, response);
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Session: ${response.sessionId}`);
    console.log(`Name: ${response.name || "-"}`);
    console.log(`Repo: ${response.repoUrl || "-"}`);
    console.log(`Provider: ${response.defaultProvider || "-"}`);
  });

sessionCommand
  .command("create")
  .description("Create a new session")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--base-url <url>", "API base URL")
  .requiredOption("--repo-url <url>", "Repository URL")
  .option("--name <name>", "Session display name")
  .option("--default-internet-access <bool>", "true|false")
  .option("--default-deny-git-credentials-access <bool>", "true|false")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry } = await resolveWorkspaceAuthContext(state, options);
    const body = {
      repoUrl: options.repoUrl,
      name: options.name,
    };
    if (typeof options.defaultInternetAccess === "string") {
      body.defaultInternetAccess = options.defaultInternetAccess === "true";
    }
    if (typeof options.defaultDenyGitCredentialsAccess === "string") {
      body.defaultDenyGitCredentialsAccess =
        options.defaultDenyGitCredentialsAccess === "true";
    }
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: "/api/v1/sessions",
      method: "POST",
      body,
    });
    upsertKnownSession(state, workspaceId, response);
    setCurrentSessionForWorkspace(state, workspaceId, response.sessionId);
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Session created: ${response.sessionId}`);
  });

sessionCommand
  .command("rm [sessionId]")
  .description("Delete a session")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--base-url <url>", "API base URL")
  .option("--yes", "Confirm deletion")
  .action(async (sessionIdArg, options) => {
    if (!options.yes) {
      throw new Error("Refusing to delete without --yes.");
    }
    const state = loadCliState();
    const { workspaceId, baseUrl, entry } = await resolveWorkspaceAuthContext(state, options);
    const sessionId = resolveSessionForCommand(state, workspaceId, sessionIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}`,
      method: "DELETE",
    });
    const map = ensureSessionWorkspaceMap(state, workspaceId);
    delete map[sessionId];
    setCurrentWorktreeForSession(state, workspaceId, sessionId, null);
    if (getCurrentSessionForWorkspace(state, workspaceId) === sessionId) {
      setCurrentSessionForWorkspace(state, workspaceId, null);
    }
    saveCliState(state);
    console.log(`Session deleted: ${response.sessionId || sessionId}`);
  });

sessionCommand
  .command("health [sessionId]")
  .description("Get session health")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (sessionIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry } = await resolveWorkspaceAuthContext(state, options);
    const sessionId = resolveSessionForCommand(state, workspaceId, sessionIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/health`,
    });
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(
      `${sessionId}: ok=${Boolean(response.ok)} ready=${Boolean(response.ready)} provider=${response.provider || "-"}`
    );
  });

const handoffCommand = sessionCommand
  .command("handoff")
  .description("Create or consume session handoff tokens");

handoffCommand
  .command("create [sessionId]")
  .description("Create handoff token for a session")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (sessionIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry } = await resolveWorkspaceAuthContext(state, options);
    const sessionId = resolveSessionForCommand(state, workspaceId, sessionIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: "/api/v1/sessions/handoff",
      method: "POST",
      body: { sessionId },
    });
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`handoffToken=${response.handoffToken}`);
    if (response.expiresAt) {
      console.log(`expiresAt=${response.expiresAt}`);
    }
  });

handoffCommand
  .command("consume")
  .description("Consume handoff token and save returned workspace/session context")
  .requiredOption("--token <handoffToken>", "Handoff token")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const baseUrl = normalizeBaseUrl(options.baseUrl || defaultBaseUrl);
    const response = await apiRequest({
      baseUrl,
      pathname: "/api/v1/sessions/handoff/consume",
      method: "POST",
      body: { handoffToken: options.token },
    });
    const state = loadCliState();
    upsertWorkspaceFromTokens(state, response.workspaceId, baseUrl, response, null);
    if (response.sessionId) {
      upsertKnownSession(state, response.workspaceId, { sessionId: response.sessionId });
      setCurrentSessionForWorkspace(state, response.workspaceId, response.sessionId);
    }
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(
      `Handoff consumed: workspace=${response.workspaceId}${response.sessionId ? ` session=${response.sessionId}` : ""}`
    );
  });

const resolveSessionAuthContext = async (state, options = {}, sessionIdArg = null) => {
  const { workspaceId, entry, baseUrl } = await resolveWorkspaceAuthContext(state, options);
  const sessionId = resolveSessionForCommand(state, workspaceId, sessionIdArg);
  return { workspaceId, entry, baseUrl, sessionId };
};

const resolveWorktreeForCommand = (state, workspaceId, sessionId, worktreeIdArg) => {
  const worktreeId = worktreeIdArg || getCurrentWorktreeForSession(state, workspaceId, sessionId);
  if (!worktreeId) {
    throw new Error("No worktree selected. Use `vibe80 worktree use <worktreeId>`.");
  }
  return worktreeId;
};

const uploadAttachmentFiles = async ({
  state,
  workspaceId,
  entry,
  baseUrl,
  sessionId,
  files,
}) => {
  if (!Array.isArray(files) || !files.length) {
    return [];
  }
  const doUpload = async (workspaceToken) => {
    const formData = new FormData();
    for (const filePath of files) {
      const absPath = path.resolve(filePath);
      const filename = path.basename(absPath);
      const buffer = fs.readFileSync(absPath);
      const blob = new Blob([buffer]);
      formData.append("files", blob, filename);
    }
    const response = await fetch(
      `${normalizeBaseUrl(baseUrl)}/api/v1/sessions/${encodeURIComponent(sessionId)}/attachments/upload`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${workspaceToken}`,
        },
        body: formData,
      }
    );
    const raw = await response.text();
    let payload = {};
    if (raw) {
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = { raw };
      }
    }
    if (!response.ok) {
      const message =
        payload?.error || payload?.message || `Attachment upload failed (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  };

  const ensured = await ensureWorkspaceAccessToken({
    state,
    workspaceId,
    entry,
    baseUrl,
  });
  let activeWorkspaceId = ensured.workspaceId;
  let activeEntry = ensured.entry;
  try {
    const payload = await doUpload(activeEntry.workspaceToken);
    return Array.isArray(payload?.files) ? payload.files : [];
  } catch (error) {
    if (error?.status !== 401) {
      throw error;
    }
    const refreshed = await refreshWorkspaceAccessToken({
      state,
      workspaceId: activeWorkspaceId,
      entry: activeEntry,
      baseUrl,
    });
    activeWorkspaceId = refreshed.workspaceId;
    activeEntry = refreshed.entry;
    const payload = await doUpload(activeEntry.workspaceToken);
    return Array.isArray(payload?.files) ? payload.files : [];
  }
};

const worktreeCommand = program
  .command("worktree")
  .alias("wt")
  .description("Manage worktrees for the current session");

worktreeCommand
  .command("ls")
  .description("List worktrees for a session")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees`,
    });
    const worktrees = Array.isArray(response.worktrees) ? response.worktrees : [];
    const currentWorktreeId = getCurrentWorktreeForSession(state, workspaceId, sessionId);
    if (options.json) {
      console.log(JSON.stringify({ workspaceId, sessionId, currentWorktreeId, worktrees }, null, 2));
      return;
    }
    if (!worktrees.length) {
      console.log("No worktree found.");
      return;
    }
    for (const wt of worktrees) {
      const marker = currentWorktreeId === wt.id ? "*" : " ";
      console.log(
        `${marker} ${wt.id} name="${wt.name || "-"}" branch=${wt.branchName || "-"} provider=${wt.provider || "-"} status=${wt.status || "-"}`
      );
    }
  });

worktreeCommand
  .command("current")
  .description("Show current worktree in selected session")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--json", "Output JSON")
  .action((options) => {
    const state = loadCliState();
    const { workspaceId } = resolveWorkspaceForCommand(state, options.workspaceId);
    const sessionId = resolveSessionForCommand(state, workspaceId, options.sessionId);
    const worktreeId = getCurrentWorktreeForSession(state, workspaceId, sessionId);
    if (options.json) {
      console.log(JSON.stringify({ workspaceId, sessionId, worktreeId }, null, 2));
      return;
    }
    if (!worktreeId) {
      console.log("No current worktree selected.");
      return;
    }
    console.log(worktreeId);
  });

worktreeCommand
  .command("use <worktreeId>")
  .description("Set current worktree for selected session")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .action((worktreeId, options) => {
    const state = loadCliState();
    const { workspaceId } = resolveWorkspaceForCommand(state, options.workspaceId);
    const sessionId = resolveSessionForCommand(state, workspaceId, options.sessionId);
    setCurrentWorktreeForSession(state, workspaceId, sessionId, worktreeId);
    saveCliState(state);
    console.log(`Current worktree (${workspaceId}/${sessionId}): ${worktreeId}`);
  });

worktreeCommand
  .command("show [worktreeId]")
  .description("Show worktree details")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (worktreeIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(state, workspaceId, sessionId, worktreeIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}`,
    });
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Worktree: ${response.id}`);
    console.log(`Name: ${response.name || "-"}`);
    console.log(`Branch: ${response.branchName || "-"}`);
    console.log(`Provider: ${response.provider || "-"}`);
    console.log(`Status: ${response.status || "-"}`);
  });

worktreeCommand
  .command("create")
  .description("Create a new worktree (context=new)")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .requiredOption("--provider <provider>", "codex|claude")
  .option("--name <name>", "Worktree display name")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const provider = parseProviderName(options.provider);
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees`,
      method: "POST",
      body: {
        context: "new",
        provider,
        name: options.name || null,
      },
    });
    setCurrentWorktreeForSession(state, workspaceId, sessionId, response.worktreeId);
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Worktree created: ${response.worktreeId}`);
  });

worktreeCommand
  .command("fork")
  .description("Fork a worktree (context=fork)")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .requiredOption("--from <worktreeId>", "Source worktree id")
  .option("--name <name>", "Worktree display name")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees`,
      method: "POST",
      body: {
        context: "fork",
        sourceWorktree: options.from,
        name: options.name || null,
      },
    });
    setCurrentWorktreeForSession(state, workspaceId, sessionId, response.worktreeId);
    saveCliState(state);
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Worktree forked: ${response.worktreeId} (from ${options.from})`);
  });

worktreeCommand
  .command("rm [worktreeId]")
  .description("Delete a worktree")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .option("--yes", "Confirm deletion")
  .action(async (worktreeIdArg, options) => {
    if (!options.yes) {
      throw new Error("Refusing to delete without --yes.");
    }
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(state, workspaceId, sessionId, worktreeIdArg);
    await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}`,
      method: "DELETE",
    });
    if (getCurrentWorktreeForSession(state, workspaceId, sessionId) === worktreeId) {
      setCurrentWorktreeForSession(state, workspaceId, sessionId, null);
    }
    saveCliState(state);
    console.log(`Worktree deleted: ${worktreeId}`);
  });

worktreeCommand
  .command("rename [worktreeId]")
  .description("Rename a worktree")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .requiredOption("--name <name>", "New worktree name")
  .option("--json", "Output JSON")
  .action(async (worktreeIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(state, workspaceId, sessionId, worktreeIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}`,
      method: "PATCH",
      body: { name: options.name },
    });
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(`Worktree renamed: ${worktreeId} -> ${options.name}`);
  });

worktreeCommand
  .command("wakeup [worktreeId]")
  .description("Wake provider for a worktree")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .option("--timeout-ms <ms>", "Wakeup timeout in milliseconds")
  .option("--json", "Output JSON")
  .action(async (worktreeIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(state, workspaceId, sessionId, worktreeIdArg);
    const body = {};
    if (options.timeoutMs != null) {
      body.timeoutMs = Number.parseInt(options.timeoutMs, 10);
    }
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}/wakeup`,
      method: "POST",
      body,
    });
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    console.log(
      `${response.worktreeId || worktreeId}: status=${response.status || "ready"} provider=${response.provider || "-"}`
    );
  });

worktreeCommand
  .command("status [worktreeId]")
  .description("Show git status entries for a worktree")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (worktreeIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(state, workspaceId, sessionId, worktreeIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}/status`,
    });
    const entries = Array.isArray(response.entries) ? response.entries : [];
    if (options.json) {
      console.log(JSON.stringify({ worktreeId, entries }, null, 2));
      return;
    }
    if (!entries.length) {
      console.log("Clean worktree.");
      return;
    }
    for (const item of entries) {
      console.log(`${item.type || "modified"}\t${item.path || ""}`);
    }
  });

worktreeCommand
  .command("diff [worktreeId]")
  .description("Show worktree diff")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (worktreeIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(state, workspaceId, sessionId, worktreeIdArg);
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}/diff`,
    });
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }
    if (typeof response.diff === "string") {
      console.log(response.diff);
      return;
    }
    console.log(JSON.stringify(response, null, 2));
  });

worktreeCommand
  .command("commits [worktreeId]")
  .description("List recent commits for a worktree")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--base-url <url>", "API base URL")
  .option("--limit <n>", "Number of commits (default: 20)")
  .option("--json", "Output JSON")
  .action(async (worktreeIdArg, options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(state, workspaceId, sessionId, worktreeIdArg);
    const qs = options.limit ? `?limit=${encodeURIComponent(String(options.limit))}` : "";
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}/commits${qs}`,
    });
    const commits = Array.isArray(response.commits) ? response.commits : [];
    if (options.json) {
      console.log(JSON.stringify({ worktreeId, commits }, null, 2));
      return;
    }
    if (!commits.length) {
      console.log("No commit found.");
      return;
    }
    for (const commit of commits) {
      console.log(`${commit.sha || "-"} ${commit.date || ""} ${commit.message || ""}`);
    }
  });

const messageCommand = program
  .command("message")
  .alias("msg")
  .description("Send and inspect worktree messages");

messageCommand
  .command("send")
  .description("Send a user message to a worktree (supports attachments)")
  .requiredOption("--text <text>", "Message text")
  .option("--file <path>", "Attachment path (repeatable)", parseRepeatOption, [])
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--worktree-id <id>", "Worktree ID (default: current for session)")
  .option("--base-url <url>", "API base URL")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(
      state,
      workspaceId,
      sessionId,
      options.worktreeId
    );
    const uploaded = await uploadAttachmentFiles({
      state,
      workspaceId,
      entry,
      baseUrl,
      sessionId,
      files: options.file || [],
    });
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}/messages`,
      method: "POST",
      body: {
        role: "user",
        text: options.text,
        attachments: uploaded,
      },
    });
    if (options.json) {
      console.log(JSON.stringify({ ...response, attachments: uploaded }, null, 2));
      return;
    }
    console.log(
      `Message sent: worktree=${worktreeId} messageId=${response.messageId || "-"} turnId=${response.turnId || "-"}`
    );
    if (uploaded.length) {
      console.log(`Attachments uploaded: ${uploaded.map((item) => item.name || item.path).join(", ")}`);
    }
  });

messageCommand
  .command("ls")
  .description("List messages for a worktree")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--worktree-id <id>", "Worktree ID (default: current for session)")
  .option("--base-url <url>", "API base URL")
  .option("--limit <n>", "Number of messages (default: 50)")
  .option("--before-message-id <id>", "Pagination cursor")
  .option("--json", "Output JSON")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(
      state,
      workspaceId,
      sessionId,
      options.worktreeId
    );
    const qs = new URLSearchParams();
    if (options.limit) qs.set("limit", String(options.limit));
    if (options.beforeMessageId) qs.set("beforeMessageId", String(options.beforeMessageId));
    const response = await authedApiRequest({
      state,
      workspaceId,
      entry,
      baseUrl,
      pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}/messages${qs.size ? `?${qs.toString()}` : ""}`,
    });
    const messages = Array.isArray(response.messages) ? response.messages : [];
    if (options.json) {
      console.log(JSON.stringify({ ...response, worktreeId, messages }, null, 2));
      return;
    }
    if (!messages.length) {
      console.log("No message found.");
      return;
    }
    for (const msg of messages) {
      const role = msg.role || "unknown";
      const text = String(msg.text || "").replace(/\s+/g, " ").trim();
      const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
      const suffix = attachments.length
        ? ` [attachments: ${attachments.map((a) => a?.name || a?.path).filter(Boolean).join(", ")}]`
        : "";
      console.log(`${msg.id || "-"} ${role}: ${text}${suffix}`);
    }
  });

messageCommand
  .command("tail")
  .description("Poll and display new messages for a worktree")
  .option("--workspace-id <id>", "Workspace ID (default: current)")
  .option("--session-id <id>", "Session ID (default: current for workspace)")
  .option("--worktree-id <id>", "Worktree ID (default: current for session)")
  .option("--base-url <url>", "API base URL")
  .option("--limit <n>", "Initial number of messages (default: 50)")
  .option("--interval-ms <ms>", "Polling interval in milliseconds (default: 2000)")
  .action(async (options) => {
    const state = loadCliState();
    const { workspaceId, baseUrl, entry, sessionId } = await resolveSessionAuthContext(
      state,
      options,
      options.sessionId
    );
    const worktreeId = resolveWorktreeForCommand(
      state,
      workspaceId,
      sessionId,
      options.worktreeId
    );
    const intervalMs = Number.parseInt(options.intervalMs, 10) || 2000;
    const initialLimit = Number.parseInt(options.limit, 10) || 50;
    const seen = new Set();
    console.log(`Tailing messages for ${workspaceId}/${sessionId}/${worktreeId} (Ctrl+C to stop)...`);
    while (true) {
      const qs = new URLSearchParams();
      qs.set("limit", String(initialLimit));
      const response = await authedApiRequest({
        state,
        workspaceId,
        entry,
        baseUrl,
        pathname: `/api/v1/sessions/${sessionId}/worktrees/${worktreeId}/messages?${qs.toString()}`,
      });
      const messages = Array.isArray(response.messages) ? response.messages : [];
      for (const msg of messages) {
        const id = msg.id || `${msg.role}-${msg.createdAt || ""}-${msg.text || ""}`;
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        const role = msg.role || "unknown";
        const text = String(msg.text || "").replace(/\s+/g, " ").trim();
        const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
        const suffix = attachments.length
          ? ` [attachments: ${attachments.map((a) => a?.name || a?.path).filter(Boolean).join(", ")}]`
          : "";
        console.log(`${msg.id || "-"} ${role}: ${text}${suffix}`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  });

program.command("help").description("Show help").action(() => {
  program.outputHelp();
});

if (!process.argv.slice(2).length) {
  console.error(
    "[vibe80] Missing command. Use `vibe80 run --codex`, `vibe80 workspace --help`, `vibe80 session --help`, or `vibe80 worktree --help`."
  );
  program.outputHelp();
  process.exit(1);
}

program.parseAsync(process.argv).catch((error) => {
  console.error(`[vibe80] ${error?.message || error}`);
  if (error?.payload) {
    console.error(JSON.stringify(error.payload, null, 2));
  }
  process.exit(1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
