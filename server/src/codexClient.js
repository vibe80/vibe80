import { spawn } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import { SYSTEM_PROMPT } from "./config.js";
import { createProviderLogger } from "./providerLogger.js";
import { buildSandboxArgs, getWorkspaceHome } from "./runAs.js";

const RUN_AS_HELPER = process.env.VIBE80_RUN_AS_HELPER || "/usr/local/bin/vibe80-run-as";
const SUDO_PATH = process.env.VIBE80_SUDO_PATH || "sudo";
const isMonoUser = process.env.DEPLOYMENT_MODE === "mono_user";

export class CodexAppServerClient extends EventEmitter {
  constructor({
    cwd,
    attachmentsDir,
    repoDir,
    internetAccess,
    denyGitCredentialsAccess,
    gitDir,
    threadId,
    env,
    workspaceId,
    tmpDir,
    sessionId,
    worktreeId,
  }) {
    super();
    this.cwd = cwd;
    this.attachmentsDir = attachmentsDir;
    this.repoDir = repoDir || cwd;
    this.internetAccess = internetAccess ?? true;
    this.denyGitCredentialsAccess = denyGitCredentialsAccess ?? true;
    if (this.internetAccess === false && this.denyGitCredentialsAccess) {
      throw new Error(
        "Invalid Codex configuration: denyGitCredentialsAccess must be false when internetAccess is false."
      );
    }
    this.gitDir = gitDir || null;
    this.env = env || process.env;
    this.workspaceId = workspaceId;
    this.tmpDir = tmpDir || null;
    this.sessionId = sessionId || null;
    this.worktreeId = worktreeId || "main";
    this.proc = null;
    this.buffer = "";
    this.stdoutLogBuffer = "";
    this.stderrLogBuffer = "";
    this.activeTurnIds = new Set();
    this.restartPending = false;
    this.restarting = false;
    this.starting = false;
    this.stopping = false;
    this.lastIdleAt = Date.now();
    this.providerLogger = createProviderLogger({
      provider: "codex",
      sessionId: this.sessionId,
      worktreeId: this.worktreeId,
    });
    this.nextId = 1;
    this.pending = new Map();
    this.threadId = threadId || null;
    this.ready = false;
  }

  async start() {
    if (this.starting || this.restarting) {
      return;
    }
    this.starting = true;
    const codexArgs = [
      "codex",
      "app-server"
    ];
    const useLandlock = this.internetAccess;
    const shareGitCredentials = !this.denyGitCredentialsAccess;
    const sshDir = path.join(getWorkspaceHome(this.workspaceId), ".ssh");
    const sandboxArgs = !isMonoUser && useLandlock
      ? buildSandboxArgs({
          cwd: this.cwd,
        repoDir: this.repoDir,
        attachmentsDir: this.attachmentsDir,
        tmpDir: this.tmpDir,
        workspaceId: this.workspaceId,
          internetAccess: this.internetAccess,
          netMode: "tcp:22,53,443",
          extraAllowRw: [
            path.join(getWorkspaceHome(this.workspaceId), ".codex"),
            ...(shareGitCredentials
              ? [sshDir, ...(this.gitDir ? [this.gitDir] : [])]
              : []),
          ],
        })
      : [];
    const spawnCommand = isMonoUser ? codexArgs[0] : SUDO_PATH;
    const spawnArgs = isMonoUser
      ? codexArgs.slice(1)
      : [
          "-n",
          RUN_AS_HELPER,
          "--workspace-id",
          this.workspaceId,
          "--cwd",
          this.cwd,
          ...sandboxArgs,
          "--",
          ...codexArgs,
        ];
    this.proc = spawn(spawnCommand, spawnArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.env,
      cwd: isMonoUser ? this.cwd : undefined,
    });
    const spawnReady = new Promise((resolve, reject) => {
      this.proc.once("spawn", resolve);
      this.proc.once("error", (error) => {
        const details = [
          `Failed to spawn Codex app-server`,
          `mode=${isMonoUser ? "mono_user" : "multi_user"}`,
          isMonoUser ? `cmd=${codexArgs[0]}` : `sudo=${SUDO_PATH}`,
          isMonoUser ? null : `helper=${RUN_AS_HELPER}`,
          `workspace=${this.workspaceId}`,
          `cwd=${this.cwd}`,
          `error=${error?.message || error}`,
        ]
          .filter(Boolean)
          .join(" ");
        this.emit("log", details);
        reject(new Error(details));
      });
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => {
      this.#logStreamChunk("OUT", "stdoutLogBuffer", chunk);
      this.#handleStdout(chunk);
    });

    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.#logStreamChunk("ERR", "stderrLogBuffer", chunk);
      this.emit("log", chunk.trim());
    });

    this.proc.on("exit", (code, signal) => {
      this.ready = false;
      this.activeTurnIds.clear();
      this.starting = false;
      this.stopping = false;
      this.restarting = false;
      this.#flushLogBuffer("OUT", "stdoutLogBuffer");
      this.#flushLogBuffer("ERR", "stderrLogBuffer");
      this.providerLogger?.close?.();
      this.emit("exit", { code, signal });
    });

    try {
      await spawnReady;
      await this.#initialize();
      await this.#startThread();
      this.ready = true;
      this.lastIdleAt = Date.now();
      this.emit("ready", { threadId: this.threadId });
      this.#restartIfIdle();
    } finally {
      this.starting = false;
    }
  }

  async stop({ force = false, timeoutMs = 5000 } = {}) {
    if (!this.proc) {
      return;
    }
    this.stopping = true;
    const proc = this.proc;
    this.proc = null;
    const exitPromise = new Promise((resolve) => {
      proc.once("exit", resolve);
      proc.once("close", resolve);
    });
    if (force) {
      proc.kill("SIGKILL");
      await exitPromise;
      this.stopping = false;
      return;
    }
    proc.kill("SIGTERM");
    const timeout = new Promise((resolve) => {
      setTimeout(resolve, timeoutMs);
    });
    await Promise.race([exitPromise, timeout]);
    if (!proc.killed) {
      proc.kill("SIGKILL");
      await exitPromise;
    }
    this.stopping = false;
  }

  getStatus() {
    if (this.restarting) return "restarting";
    if (this.starting) return "starting";
    if (this.stopping) return "stopping";
    if (!this.ready) return "starting";
    if (this.activeTurnIds.size > 0) return "busy";
    return "idle";
  }

  requestRestart() {
    this.restartPending = true;
  }

  async restart() {
    if (this.restarting) {
      return;
    }
    this.restarting = true;
    this.restartPending = false;
    try {
      await this.stop();
    } catch {
      // ignore stop errors
    }
    await this.start();
    this.restarting = false;
  }

  async sendTurn(text) {
    if (!this.threadId) {
      throw new Error("Thread not ready yet.");
    }

    return this.#sendRequest("turn/start", {
      threadId: this.threadId,
      input: [{ type: "text", text }],
    });
  }

  async interruptTurn(turnId) {
    if (!this.threadId) {
      throw new Error("Thread not ready yet.");
    }
    if (!turnId) {
      throw new Error("Turn id is required.");
    }

    return this.#sendRequest("turn/interrupt", {
      threadId: this.threadId,
      turnId,
    });
  }

  async listModels(cursor = null, limit = 100) {
    return this.#sendRequest("model/list", { cursor, limit });
  }

  async setDefaultModel(model, reasoningEffort = null) {
    return this.#sendRequest("setDefaultModel", { model, reasoningEffort });
  }

  async startAccountLogin(params) {
    return this.#sendRequest("account/login/start", params);
  }

  #handleStdout(chunk) {
    this.buffer += chunk;
    let newlineIndex;

    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const raw = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!raw) {
        continue;
      }

      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        this.emit("log", `Failed to parse JSON: ${raw}`);
        continue;
      }

      this.#handleMessage(message);
    }
  }

  #handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      this.emit("rpc_in", message);
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message || "Unknown error"));
        } else {
          pending.resolve(message.result);
        }
      }
      return;
    }

    if (message.method) {
      this.emit("rpc_in", message);
      if (message.method === "turn/started") {
        const turnId = message?.params?.turn?.id;
        if (turnId) {
          this.activeTurnIds.add(turnId);
        }
      }
      if (message.method === "turn/completed") {
        const turnId = message?.params?.turn?.id;
        if (turnId) {
          this.activeTurnIds.delete(turnId);
        }
        if (this.activeTurnIds.size === 0) {
          this.lastIdleAt = Date.now();
        }
        this.#restartIfIdle();
      }
      if (message.method === "error") {
        const turnId = message?.params?.turnId;
        const willRetry = Boolean(message?.params?.willRetry);
        if (turnId && !willRetry) {
          this.activeTurnIds.delete(turnId);
          if (this.activeTurnIds.size === 0) {
            this.lastIdleAt = Date.now();
          }
          this.#restartIfIdle();
        }
      }
      this.emit("notification", message);
    }
  }

  #restartIfIdle() {
    if (!this.restartPending || this.restarting) {
      return;
    }
    if (this.activeTurnIds.size === 0) {
      void this.restart();
    }
  }

  markActive() {
    this.lastIdleAt = Date.now();
  }

  #sendRequest(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.emit("rpc_out", payload);
      const line = JSON.stringify(payload);
      this.providerLogger?.writeLine("IN", line);
      this.proc.stdin.write(`${line}\n`);
    });
  }

  #logStreamChunk(prefix, bufferKey, chunk) {
    if (!this.providerLogger) {
      return;
    }
    const text = chunk == null ? "" : String(chunk);
    this[bufferKey] += text;
    let newlineIndex;
    while ((newlineIndex = this[bufferKey].indexOf("\n")) !== -1) {
      let line = this[bufferKey].slice(0, newlineIndex);
      if (line.endsWith("\r")) {
        line = line.slice(0, -1);
      }
      this.providerLogger.writeLine(prefix, line);
      this[bufferKey] = this[bufferKey].slice(newlineIndex + 1);
    }
  }

  #flushLogBuffer(prefix, bufferKey) {
    if (!this.providerLogger) {
      return;
    }
    const leftover = this[bufferKey];
    if (leftover) {
      this.providerLogger.writeLine(prefix, leftover);
      this[bufferKey] = "";
    }
  }

  async #initialize() {
    await this.#sendRequest("initialize", {
      clientInfo: {
        name: "vibe80",
        version: "0.1.0",
      },
    });
  }

  async #startThread() {
    const shareGitCredentials = !this.denyGitCredentialsAccess;
    const writableRoots = [
      this.cwd,
      this.repoDir,
      this.attachmentsDir,
      shareGitCredentials ? this.gitDir : null,
    ].filter(Boolean);
    const sandboxMode = isMonoUser
      ? "workspace-write"
      : this.internetAccess
        ? "danger-full-access"
        : "workspace-write";

    const params = {
      cwd: this.cwd,
      config: {
        // Reserved for future usage
        // "developer_instructions": "",
        "sandbox_workspace_write.writable_roots": writableRoots,
        "sandbox_workspace_write.network_access": Boolean(this.internetAccess),
        "web_search": this.internetAccess ? "live" : "disabled"
      },
      baseInstructions: SYSTEM_PROMPT,
      sandbox: sandboxMode,
      approvalPolicy: "never"
    };

    this.emit("thread_starting", {
      mode: this.threadId ? "resume" : "start",
      threadId: this.threadId || null,
    });

    const result = this.threadId
      ? await this.#sendRequest("thread/resume", {
          ...params,
          threadId: this.threadId,
        })
      : await this.#sendRequest("thread/start", {
          ...params,
          includePlanTool: true,
        });

    this.threadId = result.thread.id;
  }
}
