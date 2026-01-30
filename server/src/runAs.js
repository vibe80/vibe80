import { spawn } from "child_process";

const RUN_AS_HELPER = process.env.VIBECODER_RUN_AS_HELPER || "/usr/local/bin/vibecoder-run-as";
const SUDO_PATH = process.env.VIBECODER_SUDO_PATH || "sudo";
const ALLOWED_ENV_KEYS = new Set([
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_GLOBAL",
  "GIT_TERMINAL_PROMPT",
  "TERM",
]);

const buildRunAsArgs = (workspaceId, command, args, options = {}) => {
  const result = ["--workspace-id", workspaceId];
  if (options.cwd) {
    result.push("--cwd", options.cwd);
  }
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (!ALLOWED_ENV_KEYS.has(key)) {
        continue;
      }
      result.push("--env", `${key}=${value}`);
    }
  }
  result.push("--", command, ...args);
  return result;
};

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], ...options });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (options.input) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });

const runCommandOutput = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (options.input) {
      proc.stdin.write(options.input);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });

export const runAsCommand = (workspaceId, command, args, options = {}) =>
  runCommand(SUDO_PATH, ["-n", RUN_AS_HELPER, ...buildRunAsArgs(workspaceId, command, args, options)], {
    env: process.env,
    input: options.input,
  });

export const runAsCommandOutput = (workspaceId, command, args, options = {}) =>
  runCommandOutput(SUDO_PATH, ["-n", RUN_AS_HELPER, ...buildRunAsArgs(workspaceId, command, args, options)], {
    env: process.env,
    input: options.input,
  });
