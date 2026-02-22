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
    const command = process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open";
    const args = process.platform === "darwin"
      ? [url]
      : process.platform === "win32"
        ? ["/c", "start", "", url]
        : [url];
    const opener = spawn(command, args, {
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

program.command("help").description("Show help").action(() => {
  program.outputHelp();
});

if (!process.argv.slice(2).length) {
  console.error("[vibe80] Missing command. Use `vibe80 run --codex` or `vibe80 run --claude`.");
  program.outputHelp();
  process.exit(1);
}

program.parse(process.argv);

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
