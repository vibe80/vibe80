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
    return { version: 1, currentWorkspaceId: null, workspaces: {} };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    if (!parsed || typeof parsed !== "object") {
      return { version: 1, currentWorkspaceId: null, workspaces: {} };
    }
    return {
      version: 1,
      currentWorkspaceId:
        typeof parsed.currentWorkspaceId === "string" && parsed.currentWorkspaceId
          ? parsed.currentWorkspaceId
          : null,
      workspaces:
        parsed.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {},
    };
  } catch {
    return { version: 1, currentWorkspaceId: null, workspaces: {} };
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

const parseListOption = (value, previous = []) => {
  const parts = String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return [...previous, ...parts];
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
    if (entry.workspaceToken) {
      try {
        remotePayload = await apiRequest({
          baseUrl,
          pathname: `/api/v1/workspaces/${workspaceId}`,
          workspaceToken: entry.workspaceToken,
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
    if (!entry.workspaceToken) {
      throw new Error(`No workspace token for "${workspaceId}". Run workspace login first.`);
    }
    const patch = buildProvidersPatch(options);
    const response = await apiRequest({
      baseUrl,
      pathname: `/api/v1/workspaces/${workspaceId}`,
      method: "PATCH",
      workspaceToken: entry.workspaceToken,
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
    if (!entry.workspaceToken) {
      throw new Error(`No workspace token for "${workspaceId}". Run workspace login first.`);
    }
    await apiRequest({
      baseUrl,
      pathname: `/api/v1/workspaces/${workspaceId}`,
      method: "DELETE",
      workspaceToken: entry.workspaceToken,
    });
    delete state.workspaces[workspaceId];
    if (state.currentWorkspaceId === workspaceId) {
      state.currentWorkspaceId = null;
    }
    saveCliState(state);
    console.log(`Workspace deleted: ${workspaceId}`);
  });

program.command("help").description("Show help").action(() => {
  program.outputHelp();
});

if (!process.argv.slice(2).length) {
  console.error("[vibe80] Missing command. Use `vibe80 run --codex` or `vibe80 workspace --help`.");
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
