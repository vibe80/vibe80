#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

const spawnProcess = (args, label) => {
  const child = spawn(npmCmd, args, {
    cwd: rootDir,
    stdio: "inherit",
  });

  child.on("error", (error) => {
    console.error(`[vibe80] Failed to start ${label}:`, error.message || error);
  });

  return child;
};

const runBuild = () =>
  new Promise((resolve, reject) => {
    const build = spawnProcess(
      ["--workspace", "client", "run", "build"],
      "client build"
    );
    build.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Client build failed with exit code ${code}`));
      }
    });
  });

let server = null;

let shuttingDown = false;

const shutdown = (code = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server?.pid) {
    server.kill("SIGTERM");
  }
  process.exit(code);
};

const startServer = () => {
  server = spawnProcess(
    ["--workspace", "server", "run", "start"],
    "server"
  );

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

runBuild()
  .then(() => startServer())
  .catch((error) => {
    console.error(`[vibe80] ${error.message || error}`);
    shutdown(1);
  });

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
