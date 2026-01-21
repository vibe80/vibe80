import { spawn } from "child_process";
import { EventEmitter } from "events";
import crypto from "crypto";

const createTurnId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

export class ClaudeCliClient extends EventEmitter {
  constructor({ cwd, attachmentsDir }) {
    super();
    this.cwd = cwd;
    this.attachmentsDir = attachmentsDir;
    this.ready = false;
    this.threadId = "claude-session";
    this.modelInfo = null;
    this.toolUses = new Map();
    this.buffer = "";
    this.systemPrompt =
      "output markdown format for inline generated text;When proposing possible next steps, use: <!-- vibecoder:choices <question?> --> then options (one per line), end with <!-- /vibecoder:choices -->";
  }

  async start() {
    this.ready = true;
    this.emit("ready", { threadId: this.threadId });
  }

  async sendTurn(text) {
    const turnId = createTurnId();
    const args = [
      "--continue",
      "--verbose",
      "-p",
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--add-dir",
      "./",
      "--permission-mode",
      "bypassPermissions",
      "--append-system-prompt",
      this.systemPrompt,
    ];
    if (this.attachmentsDir) {
      args.push("--add-dir", this.attachmentsDir);
    }

    const proc = spawn("claude", args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => this.#handleStdout(turnId, chunk));

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) {
        this.emit("log", message);
      }
    });

    proc.on("error", (error) => {
      this.emit("turn_error", {
        turnId,
        message: error?.message || "Claude process failed to start.",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        this.emit("turn_completed", { turnId, status: "success" });
      } else {
        this.emit("turn_error", {
          turnId,
          message: `Claude process exited with code ${code}`,
        });
      }
    });

    const payload = {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    };
    proc.stdin.write(`${JSON.stringify(payload)}\n`);
    proc.stdin.end();

    return { turn: { id: turnId } };
  }

  async interruptTurn() {
    throw new Error("Claude CLI does not support turn interruption.");
  }

  async listModels() {
    const model = this.modelInfo?.model || "claude";
    return {
      data: [
        {
          id: model,
          model,
          displayName: model,
          isDefault: true,
        },
      ],
      nextCursor: null,
    };
  }

  async setDefaultModel() {
    return { ok: false };
  }

  async startAccountLogin() {
    throw new Error("Claude CLI does not support account login.");
  }

  #handleStdout(turnId, chunk) {
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
        this.emit("log", `Failed to parse Claude JSON: ${raw}`);
        continue;
      }
      this.emit("stdout_json", { turnId, message });
      this.#handleMessage(turnId, message);
    }
  }

  #handleMessage(turnId, message) {
    if (message?.type === "system" && message.subtype === "init") {
      this.modelInfo = { model: message.model || null };
      return;
    }

    if (message?.type === "assistant" && message.message?.content) {
      const { content, id } = message.message;
      let textBlocks = [];
      for (const part of content) {
        if (part?.type === "text" && typeof part.text === "string") {
          textBlocks.push(part.text);
        }
        if (part?.type === "tool_use") {
          this.toolUses.set(part.id, { name: part.name });
        }
      }
      const text = textBlocks.join("");
      if (text) {
        this.emit("assistant_message", {
          id: id || createTurnId(),
          text,
          turnId,
        });
      }
      return;
    }

    if (message?.type === "user" && message.message?.content) {
      for (const part of message.message.content) {
        if (part?.type !== "tool_result") {
          continue;
        }
        const tool = this.toolUses.get(part.tool_use_id) || {};
        const output = typeof part.content === "string" ? part.content : "";
        this.emit("command_execution_completed", {
          item: {
            id: part.tool_use_id,
            type: "commandExecution",
            command: tool.name || "Tool",
            aggregatedOutput: output,
            status: part.is_error ? "error" : "completed",
          },
          itemId: part.tool_use_id,
          turnId,
        });
        this.toolUses.delete(part.tool_use_id);
      }
      return;
    }

    if (message?.type === "result") {
      if (message.is_error) {
        this.emit("turn_error", {
          turnId,
          message: message.result || "Claude returned an error.",
        });
      }
    }
  }
}
