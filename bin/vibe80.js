#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const rootDir = path.resolve(__dirname, "..");
const homeDir = process.env.HOME || os.homedir();
const monoAuthUrlFile = path.join(
  os.tmpdir(),
  `vibe80-mono-auth-${process.pid}-${Date.now()}.url`
);
const defaultEnv = {
  DEPLOYMENT_MODE: "mono_user",
  JWT_KEY_PATH: path.join(homeDir, ".vibe80", "jwt.key"),
  STORAGE_BACKEND: "sqlite",
  SQLITE_PATH: path.join(homeDir, ".vibe80", "data.sqlite"),
};
const deploymentMode = process.env.DEPLOYMENT_MODE || defaultEnv.DEPLOYMENT_MODE;
const serverPort = process.env.PORT || "5179";

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

const maybeOpenMonoAuthUrl = async () => {
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

const startServer = () => {
  unlinkMonoAuthUrlFile();
  server = spawnProcess(
    process.execPath,
    ["server/src/index.js"],
    "server",
    { VIBE80_MONO_AUTH_URL_FILE: monoAuthUrlFile }
  );
  void maybeOpenMonoAuthUrl();

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

startServer();

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
