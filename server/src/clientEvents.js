/**
 * Client event handlers for Codex (app-server) and Claude (CLI) clients.
 *
 * Each function receives a `context` object and a `deps` object:
 *
 * context = { sessionId, worktreeId, provider, client }
 *   - worktreeId: null for the main session, a string for a worktree
 *
 * deps = {
 *   getSession, broadcastToSession, appendMessage, broadcastDiff,
 *   updateWorktreeStatus, updateWorktreeThreadId, appendRpcLog,
 *   getProviderLabel, storage, debugApiWsLog,
 * }
 */

// ---------------------------------------------------------------------------
// Codex (app-server JSONRPC) events
// ---------------------------------------------------------------------------

export function attachCodexEvents(context, deps) {
  const { sessionId, worktreeId, provider, client } = context;
  const {
    getSession,
    broadcastToSession,
    appendMessage,
    broadcastDiff,
    updateWorktreeStatus,
    updateWorktreeThreadId,
    appendRpcLog,
    getProviderLabel,
    storage,
    debugApiWsLog,
  } = deps;

  const isWorktree = worktreeId != null;
  let lastAuthError = null;

  client.on("thread_starting", () => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (isWorktree) {
        await updateWorktreeStatus(session, worktreeId, "processing");
        broadcastToSession(sessionId, {
          type: "worktree_status",
          worktreeId,
          status: "processing",
        });
      } else if (session.activeProvider === provider) {
        broadcastToSession(sessionId, {
          type: "provider_status",
          status: "starting",
          provider,
        });
        broadcastToSession(sessionId, {
          type: "status",
          message: `Starting ${getProviderLabel(session)}...`,
          provider,
        });
      }
    })();
  });

  client.on("ready", ({ threadId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (isWorktree) {
        if (threadId) {
          await updateWorktreeThreadId(session, worktreeId, threadId);
        }
        await updateWorktreeStatus(session, worktreeId, "ready");
        broadcastToSession(sessionId, {
          type: "worktree_ready",
          worktreeId,
          threadId,
          provider,
        });
      } else {
        if (threadId) {
          const updated = { ...session, threadId, lastActivityAt: Date.now() };
          await storage.saveSession(sessionId, updated);
        }
        if (session.activeProvider === provider) {
          broadcastToSession(sessionId, { type: "ready", threadId, provider });
          broadcastToSession(sessionId, {
            type: "provider_status",
            status: "ready",
            provider,
          });
        }
      }
    })();
  });

  client.on("log", (message) => {
    if (!message) return;
    const prefix = isWorktree
      ? `[codex:${sessionId}:wt-${worktreeId}]`
      : `[codex:${sessionId}]`;
    console.log(`${prefix} ${message}`);
    if (
      message.includes("401 Unauthorized") ||
      message.includes("Unauthorized")
    ) {
      lastAuthError =
        "Erreur d'authentification Codex: vérifiez votre fichier auth.json";
      if (!isWorktree) {
        void (async () => {
          const session = await getSession(sessionId);
          if (session?.activeProvider === provider) {
            broadcastToSession(sessionId, {
              type: "error",
              message: lastAuthError,
              details: message,
            });
          }
        })();
      }
    }
  });

  client.on("exit", ({ code, signal }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (isWorktree) {
        if (session) {
          await updateWorktreeStatus(session, worktreeId, "error");
          broadcastToSession(sessionId, {
            type: "worktree_status",
            worktreeId,
            status: "error",
            error: lastAuthError || "Codex app-server stopped.",
          });
        }
        console.error("Worktree Codex app-server stopped.", {
          code,
          signal,
          sessionId,
          worktreeId,
        });
      } else {
        if (session?.activeProvider === provider) {
          const errorMessage = lastAuthError || "Codex app-server stopped.";
          broadcastToSession(sessionId, { type: "error", message: errorMessage });
        }
        console.error("Codex app-server stopped.", { code, signal, sessionId });
      }
    })();
  });

  client.on("notification", (message) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (!isWorktree && session.activeProvider !== provider) return;

      switch (message.method) {
        case "thread/started": {
          const threadId = message?.params?.thread?.id;
          if (threadId) {
            if (isWorktree) {
              await updateWorktreeThreadId(session, worktreeId, threadId);
            } else {
              const updated = {
                ...session,
                threadId,
                lastActivityAt: Date.now(),
              };
              await storage.saveSession(sessionId, updated);
              await updateWorktreeThreadId(session, "main", threadId);
            }
          }
          break;
        }
        case "codex/event/agent_reasoning": {
          const text = message?.params?.msg?.text || "";
          if (text) {
            const payload = { type: "agent_reasoning", text, provider };
            if (isWorktree) payload.worktreeId = worktreeId;
            broadcastToSession(sessionId, payload);
          }
          break;
        }
        case "item/agentMessage/delta": {
          const { delta, itemId, turnId } = message.params;
          const payload = {
            type: "assistant_delta",
            delta,
            itemId,
            turnId,
            provider,
          };
          if (isWorktree) payload.worktreeId = worktreeId;
          broadcastToSession(sessionId, payload);
          break;
        }
        case "item/commandExecution/outputDelta": {
          const { delta, itemId, turnId, threadId } = message.params;
          const payload = {
            type: "command_execution_delta",
            delta,
            itemId,
            turnId,
            threadId,
            provider,
          };
          if (isWorktree) payload.worktreeId = worktreeId;
          broadcastToSession(sessionId, payload);
          break;
        }
        case "item/completed": {
          const { item, turnId } = message.params;
          if (item?.type === "agentMessage") {
            await appendMessage(session, worktreeId, {
              id: item.id,
              role: "assistant",
              text: item.text,
              provider,
            });
            const payload = {
              type: "assistant_message",
              text: item.text,
              itemId: item.id,
              turnId,
              provider,
            };
            if (isWorktree) payload.worktreeId = worktreeId;
            broadcastToSession(sessionId, payload);
            void broadcastDiff(sessionId, worktreeId);
          }
          if (item?.type === "commandExecution") {
            await appendMessage(session, worktreeId, {
              id: item.id,
              role: "tool_result",
              text: item.aggregatedOutput || "",
              provider,
              toolResult: {
                callId: item.id,
                name: item.command || "command",
                output: item.aggregatedOutput || "",
                success: item.status === "completed",
              },
            });
            const payload = {
              type: "command_execution_completed",
              item,
              itemId: item.id,
              turnId,
              provider,
            };
            if (isWorktree) payload.worktreeId = worktreeId;
            broadcastToSession(sessionId, payload);
          }
          break;
        }
        case "turn/completed": {
          const { turn, threadId } = message.params;
          if (isWorktree) {
            await updateWorktreeStatus(session, worktreeId, "ready");
          }
          const payload = {
            type: "turn_completed",
            threadId,
            turnId: turn.id,
            status: turn.status,
            error: turn.error || null,
            provider,
          };
          if (isWorktree) payload.worktreeId = worktreeId;
          broadcastToSession(sessionId, payload);
          break;
        }
        case "turn/started": {
          const { turn, threadId } = message.params;
          if (isWorktree) {
            await updateWorktreeStatus(session, worktreeId, "processing");
          }
          const payload = {
            type: "turn_started",
            threadId,
            turnId: turn.id,
            status: turn.status,
            provider,
          };
          if (isWorktree) payload.worktreeId = worktreeId;
          broadcastToSession(sessionId, payload);
          break;
        }
        case "item/started": {
          const { item, turnId, threadId } = message.params;
          const payload = {
            type: "item_started",
            threadId,
            turnId,
            item,
            provider,
          };
          if (isWorktree) payload.worktreeId = worktreeId;
          broadcastToSession(sessionId, payload);
          break;
        }
        case "error": {
          const { error, threadId, turnId, willRetry } = message.params;
          const payload = {
            type: "turn_error",
            threadId,
            turnId,
            willRetry,
            message: error?.message || "Unknown error",
            provider,
          };
          if (isWorktree) payload.worktreeId = worktreeId;
          broadcastToSession(sessionId, payload);
          break;
        }
        case "account/login/completed": {
          if (!isWorktree) {
            const { success, error, loginId } = message.params;
            broadcastToSession(sessionId, {
              type: "account_login_completed",
              success: Boolean(success),
              error: error || null,
              loginId: loginId || null,
              provider,
            });
          }
          break;
        }
        default:
          break;
      }
    })();
  });

  client.on("rpc_out", (payload) => {
    void (async () => {
      if (!debugApiWsLog) return;
      const entry = {
        direction: "stdin",
        timestamp: Date.now(),
        payload,
        provider,
      };
      if (isWorktree) entry.worktreeId = worktreeId;
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });

  client.on("rpc_in", (payload) => {
    void (async () => {
      if (!debugApiWsLog) return;
      const entry = {
        direction: "stdout",
        timestamp: Date.now(),
        payload,
        provider,
      };
      if (isWorktree) entry.worktreeId = worktreeId;
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });
}

// ---------------------------------------------------------------------------
// Claude CLI events
// ---------------------------------------------------------------------------

export function attachClaudeEvents(context, deps) {
  const { sessionId, worktreeId, provider, client } = context;
  const {
    getSession,
    broadcastToSession,
    appendMessage,
    broadcastDiff,
    updateWorktreeStatus,
    appendRpcLog,
    debugApiWsLog,
  } = deps;

  const isWorktree = worktreeId != null;

  client.on("ready", ({ threadId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (isWorktree) {
        await updateWorktreeStatus(session, worktreeId, "ready");
        broadcastToSession(sessionId, {
          type: "worktree_ready",
          worktreeId,
          threadId,
          provider,
        });
      } else if (session.activeProvider === provider) {
        broadcastToSession(sessionId, { type: "ready", threadId, provider });
      }
    })();
  });

  client.on("log", (message) => {
    if (message) {
      const prefix = isWorktree
        ? `[claude:${sessionId}:wt-${worktreeId}]`
        : `[claude:${sessionId}]`;
      console.log(`${prefix} ${message}`);
    }
  });

  client.on("stdout_json", ({ message }) => {
    void (async () => {
      if (!debugApiWsLog) return;
      const entry = {
        direction: "stdout",
        timestamp: Date.now(),
        payload: message,
        provider,
      };
      if (isWorktree) entry.worktreeId = worktreeId;
      await appendRpcLog(sessionId, entry);
      broadcastToSession(sessionId, { type: "rpc_log", entry });
    })();
  });

  client.on("assistant_message", ({ id, text, turnId }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (!isWorktree && session.activeProvider !== provider) return;

      await appendMessage(session, worktreeId, {
        id,
        role: "assistant",
        text,
        provider,
      });
      const payload = {
        type: "assistant_message",
        text,
        itemId: id,
        turnId,
        provider,
      };
      if (isWorktree) payload.worktreeId = worktreeId;
      broadcastToSession(sessionId, payload);
      void broadcastDiff(sessionId, worktreeId);
    })();
  });

  client.on("command_execution_completed", (payload) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (!isWorktree && session.activeProvider !== provider) return;

      await appendMessage(session, worktreeId, {
        id: payload.itemId,
        role: "tool_result",
        text: payload.item?.aggregatedOutput || "",
        provider,
        toolResult: {
          callId: payload.itemId,
          name: payload.item?.command || "tool",
          output: payload.item?.aggregatedOutput || "",
          success: payload.item?.status === "completed",
        },
      });
      const msg = {
        type: "command_execution_completed",
        item: payload.item,
        itemId: payload.itemId,
        turnId: payload.turnId,
        provider,
      };
      if (isWorktree) msg.worktreeId = worktreeId;
      broadcastToSession(sessionId, msg);
    })();
  });

  client.on("turn_completed", ({ turnId, status }) => {
    void (async () => {
      const session = await getSession(sessionId);
      if (!session) return;
      if (!isWorktree && session.activeProvider !== provider) return;

      if (isWorktree) {
        await updateWorktreeStatus(session, worktreeId, "ready");
      }
      const payload = {
        type: "turn_completed",
        turnId,
        status: status || "success",
        error: null,
        provider,
      };
      if (isWorktree) payload.worktreeId = worktreeId;
      broadcastToSession(sessionId, payload);
    })();
  });

  client.on("turn_error", ({ turnId, message }) => {
    void (async () => {
      if (!isWorktree) {
        const session = await getSession(sessionId);
        if (!session || session.activeProvider !== provider) return;
      }
      const payload = {
        type: "turn_error",
        turnId,
        message: message || "Claude CLI error.",
        provider,
      };
      if (isWorktree) payload.worktreeId = worktreeId;
      broadcastToSession(sessionId, payload);
    })();
  });
}
