import { spawn } from "child_process";
import { EventEmitter } from "events";

export class CodexAppServerClient extends EventEmitter {
  constructor({ cwd }) {
    super();
    this.cwd = cwd;
    this.proc = null;
    this.buffer = "";
    this.nextId = 1;
    this.pending = new Map();
    this.threadId = null;
    this.ready = false;
  }

  async start() {
    this.proc = spawn("codex", ["app-server"], {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
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

    await this.#initialize();
    await this.#startThread();
    this.ready = true;
    this.emit("ready", { threadId: this.threadId });
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
      this.emit("notification", message);
    }
  }

  #sendRequest(method, params) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async #initialize() {
    await this.#sendRequest("initialize", {
      clientInfo: {
        name: "m5chat",
        version: "0.1.0",
      },
    });
  }

  async #startThread() {
    const result = await this.#sendRequest("thread/start", {
      cwd: this.cwd,
      approvalPolicy: "never",
      sandbox: "workspace-write",
    });

    this.threadId = result.thread.id;
  }
}
