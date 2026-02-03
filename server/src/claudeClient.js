import { spawn } from "child_process";
import { EventEmitter } from "events";
import crypto from "crypto";
import path from "path";
import { SYSTEM_PROMPT } from "./config.js";
import { buildSandboxArgs, getWorkspaceHome } from "./runAs.js";

const RUN_AS_HELPER = process.env.VIBE80_RUN_AS_HELPER || "/usr/local/bin/vibe80-run-as";
const SUDO_PATH = process.env.VIBE80_SUDO_PATH || "sudo";
const isMonoUser = process.env.DEPLOYMENT_MODE === "mono_user";

const createTurnId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

export class ClaudeCliClient extends EventEmitter {
  constructor({
    cwd,
    attachmentsDir,
    repoDir,
    internetAccess,
    shareGitCredentials,
    gitDir,
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
    this.ready = false;
    this.threadId = "claude-session";
    this.modelInfo = null;
    this.defaultModel = null;
    this.toolUses = new Map();
    this.buffer = "";
    this.systemPrompt = SYSTEM_PROMPT;
  }

  async start() {
    this.ready = true;
    this.emit("ready", { threadId: this.threadId });
  }

  async stop() {
    return;
  }

  async sendTurn(text) {
    const turnId = createTurnId();
    const allowedDirs = [
      this.cwd,
      this.repoDir,
      this.attachmentsDir,
      this.shareGitCredentials ? this.gitDir : null,
    ]
      .filter(Boolean)
      .filter((value, index, self) => self.indexOf(value) === index);
    const allowedTools = ["Bash(git:*)"];
    if (this.internetAccess) {
      allowedTools.push("WebSearch");
    }
    const args = [
      "--continue",
      "--verbose",
      "-p",
      ...(this.defaultModel ? ["--model", this.defaultModel] : []),
      "--output-format",
      "stream-json",
      "--input-format",
      "stream-json",
      "--permission-mode",
      "acceptEdits",
      "--allowed-tools",
      allowedTools.join(" "),
      "--append-system-prompt",
      this.systemPrompt,
    ];
    for (const dir of allowedDirs) {
      args.push("--add-dir", dir);
    }

    const command = "claude";
    const spawnCommand = isMonoUser ? command : SUDO_PATH;
    const spawnArgs = isMonoUser
      ? args
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
              path.join(getWorkspaceHome(this.workspaceId), ".claude"),
            ],
            extraAllowRwFiles: [
              path.join(getWorkspaceHome(this.workspaceId), ".claude.json"),
            ],
          }),
          "--",
          command,
          ...args,
        ];

    const proc = spawn(spawnCommand, spawnArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: this.env,
      cwd: isMonoUser ? this.cwd : undefined,
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
      const details = [
        "Claude spawn failed",
        `mode=${isMonoUser ? "mono_user" : "multi_user"}`,
        isMonoUser ? `cmd=${command}` : `sudo=${SUDO_PATH}`,
        isMonoUser ? null : `helper=${RUN_AS_HELPER}`,
        `workspace=${this.workspaceId}`,
        `cwd=${this.cwd}`,
        `error=${error?.message || error}`,
      ]
        .filter(Boolean)
        .join(" ");
      this.emit("log", details);
      this.emit("turn_error", {
        turnId,
        message: details,
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
    const model = this.modelInfo?.model || "default";
    return {
      data: [
        {
          id: "default",
          model: "default",
          displayName: "default",
          isDefault: true,
        },
        { id: "sonnet", model: "sonnet", displayName: "sonnet" },
        { id: "opus", model: "opus", displayName: "opus" },
        { id: "haiku", model: "haiku", displayName: "haiku" },
        { id: "opusplan", model: "opusplan", displayName: "opusplan" },
      ],
      nextCursor: null,
    };
  }

  async setDefaultModel(model) {
    if (typeof model === "string" && model.trim()) {
      this.defaultModel = model.trim();
      this.modelInfo = { model: this.defaultModel };
      return { ok: true };
    }
    this.defaultModel = null;
    return { ok: true };
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
