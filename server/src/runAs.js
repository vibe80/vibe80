import { spawn } from "child_process";
import os from "os";
import path from "path";

const RUN_AS_HELPER = process.env.VIBE80_RUN_AS_HELPER || "/usr/local/bin/vibe80-run-as";
const SUDO_PATH = process.env.VIBE80_SUDO_PATH || "sudo";
const DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE;
const IS_MONO_USER = DEPLOYMENT_MODE === "mono_user";
const ALLOWED_ENV_KEYS = new Set([
  "GIT_SSH_COMMAND",
  "GIT_CONFIG_GLOBAL",
  "GIT_TERMINAL_PROMPT",
  "TERM",
]);
export const DEFAULT_ALLOW_RO = [
  "/bin",
  "/etc",
  "/lib",
  "/lib64",
  "/usr",
  "/dev",
  "/proc",
];

const normalizePaths = (paths = []) => {
  const seen = new Set();
  const result = [];
  for (const entry of paths) {
    if (!entry) {
      continue;
    }
    const resolved = path.resolve(entry);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
};

export const buildSandboxArgs = (options = {}) => {
  const allowRo = normalizePaths([
    ...(options.allowRo || DEFAULT_ALLOW_RO),
    ...(options.extraAllowRo || []),
  ]);
  const allowRw = normalizePaths([
    ...(options.allowRw || []),
    ...(options.extraAllowRw || []),
    options.repoDir,
    options.cwd,
    options.attachmentsDir,
  ]);
  const allowRoFiles = normalizePaths([
    ...(options.allowRoFiles || []),
    ...(options.extraAllowRoFiles || []),
  ]);
  const allowRwFiles = normalizePaths([
    ...(options.allowRwFiles || []),
    ...(options.extraAllowRwFiles || []),
  ]);
  const args = [];
  if (allowRo.length) {
    args.push("--allow-ro", allowRo.join(","));
  }
  if (allowRw.length) {
    args.push("--allow-rw", allowRw.join(","));
  }
  if (allowRoFiles.length) {
    args.push("--allow-ro-file", allowRoFiles.join(","));
  }
  if (allowRwFiles.length) {
    args.push("--allow-rw-file", allowRwFiles.join(","));
  }
  args.push("--net", options.internetAccess === false ? "none" : "tcp:53,443");
  args.push("--seccomp", options.seccomp || "default");
  return args;
};

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
  if (options.sandbox) {
    result.push(...buildSandboxArgs(options));
  }
  result.push("--", command, ...args);
  return result;
};

const buildRunEnv = (options = {}) => {
  const env = { ...process.env };
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      if (!ALLOWED_ENV_KEYS.has(key)) {
        continue;
      }
      env[key] = value;
    }
  }
  return env;
};

export const getWorkspaceHome = (workspaceId) => {
  const homeBase = process.env.WORKSPACE_HOME_BASE || "/home";
  return IS_MONO_USER ? os.homedir() : path.join(homeBase, workspaceId);
};

const validateCwd = (workspaceId, cwd) => {
  const resolved = path.resolve(cwd);
  const homeDir = getWorkspaceHome(workspaceId);
  if (
    resolved !== homeDir &&
    !resolved.startsWith(homeDir + path.sep)
  ) {
    throw new Error("cwd outside workspace");
  }
};

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ["pipe", "ignore", "pipe"], ...options });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (options.input) {
      if (typeof options.input.pipe === "function") {
        options.input.pipe(proc.stdin);
      } else {
        proc.stdin.write(options.input);
        proc.stdin.end();
      }
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
    const stdoutChunks = [];
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    if (options.input) {
      if (typeof options.input.pipe === "function") {
        options.input.pipe(proc.stdin);
      } else {
        proc.stdin.write(options.input);
        proc.stdin.end();
      }
    } else {
      proc.stdin.end();
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        const output = Buffer.concat(stdoutChunks);
        resolve(options.binary ? output : output.toString("utf8"));
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });

export const runAsCommand = (workspaceId, command, args, options = {}) =>
  (IS_MONO_USER
    ? (validateCwd(workspaceId, options.cwd || getWorkspaceHome(workspaceId)),
      runCommand(command, args, {
        cwd: options.cwd || getWorkspaceHome(workspaceId),
        env: buildRunEnv(options),
        input: options.input,
      }))
    : runCommand(
        SUDO_PATH,
        ["-n", RUN_AS_HELPER, ...buildRunAsArgs(workspaceId, command, args, options)],
        {
          env: process.env,
          input: options.input,
        }
      )
  ).catch((error) => {
    const details = [
      "run-as failed",
      `mode=${DEPLOYMENT_MODE || "unknown"}`,
      IS_MONO_USER ? null : `sudo=${SUDO_PATH}`,
      IS_MONO_USER ? null : `helper=${RUN_AS_HELPER}`,
      `workspace=${workspaceId}`,
      `command=${command}`,
      `args=${JSON.stringify(args || [])}`,
      `error=${error?.message || error}`,
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(details);
  });

export const runAsCommandOutput = (workspaceId, command, args, options = {}) =>
  (IS_MONO_USER
    ? (validateCwd(workspaceId, options.cwd || getWorkspaceHome(workspaceId)),
      runCommandOutput(command, args, {
        cwd: options.cwd || getWorkspaceHome(workspaceId),
        env: buildRunEnv(options),
        input: options.input,
        binary: options.binary,
      }))
    : runCommandOutput(
        SUDO_PATH,
        ["-n", RUN_AS_HELPER, ...buildRunAsArgs(workspaceId, command, args, options)],
        {
          env: process.env,
          input: options.input,
          binary: options.binary,
        }
      )
  ).catch((error) => {
    const details = [
      "run-as output failed",
      `mode=${DEPLOYMENT_MODE || "unknown"}`,
      IS_MONO_USER ? null : `sudo=${SUDO_PATH}`,
      IS_MONO_USER ? null : `helper=${RUN_AS_HELPER}`,
      `workspace=${workspaceId}`,
      `command=${command}`,
      `args=${JSON.stringify(args || [])}`,
      `error=${error?.message || error}`,
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(details);
  });
