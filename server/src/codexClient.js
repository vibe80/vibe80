import { spawn } from "child_process";
import { EventEmitter } from "events";
import path from "path";
import { SYSTEM_PROMPT } from "./config.js";
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
    shareGitCredentials,
    gitDir,
    threadId,
    env,
    workspaceId,
  }) {
    super();
    this.cwd = cwd;
    this.attachmentsDir = attachmentsDir;
    this.repoDir = repoDir || cwd;
    this.internetAccess = internetAccess ?? true;
    this.shareGitCredentials = shareGitCredentials ?? false;
    this.gitDir = gitDir || null;
    this.env = env || process.env;
    this.workspaceId = workspaceId;
    this.proc = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.threadId = threadId || null;
    this.ready = false;
  }

  async start() {
    const codexArgs = [
      "codex",
      "app-server"
    ];
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
          ...buildSandboxArgs({
            cwd: this.cwd,
            repoDir: this.repoDir,
            attachmentsDir: this.attachmentsDir,
            internetAccess: this.internetAccess,
            extraAllowRw: [
              path.join(getWorkspaceHome(this.workspaceId), ".codex"),
            ],
          }),
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
    this.proc.stdout.on("data", (chunk) => this.#handleStdout(chunk));

    this.proc.stderr.setEncoding("utf8");
    this.proc.stderr.on("data", (chunk) => {
      this.emit("log", chunk.trim());
    });

    this.proc.on("exit", (code, signal) => {
      this.ready = false;
      this.emit("exit", { code, signal });
    });

    await spawnReady;
    await this.#initialize();
    await this.#startThread();
    this.ready = true;
    this.emit("ready", { threadId: this.threadId });
  }

  async stop() {
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
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
      this.emit("notification", message);
    }
  }

  #sendRequest(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.emit("rpc_out", payload);
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
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
    const writableRoots = [
      this.cwd,
      this.repoDir,
      this.attachmentsDir,
      this.shareGitCredentials ? this.gitDir : null,
    ].filter(Boolean);

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
      sandbox: "workspace-write",
      approvalPolicy: "never"
    };

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
