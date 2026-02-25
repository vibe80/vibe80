import { useEffect } from "react";

export default function useChatSocket({
  attachmentSessionId,
  workspaceToken,
  socketRef,
  reconnectTimerRef,
  reconnectAttemptRef,
  closingRef,
  pingIntervalRef,
  lastPongRef,
  messageIndex,
  commandIndex,
  rpcLogsEnabledRef,
  mergeAndApplyMessages,
  requestMessageSync,
  requestWorktreesList,
  requestWorktreeMessages,
  applyWorktreesList,
  resyncSession,
  t,
  setStatus,
  setConnected,
  setAppServerReady,
  setHasMainWorktreeStatus,
  setMessages,
  setProcessing,
  setActivity,
  setCurrentTurnId,
  setMainTaskLabel,
  setModelLoading,
  setModelError,
  setModels,
  setProviderModelState,
  setSelectedModel,
  setSelectedReasoningEffort,
  setRepoDiff,
  setRpcLogs,
  setWorktrees,
  setPaneByTab,
  setLogFilterByTab,
  setActiveWorktreeId,
  activeWorktreeIdRef,
  extractVibe80Task,
  extractFirstLine,
  getItemActivityLabel,
  maybeNotify,
  normalizeAttachments,
  loadRepoLastCommit,
  loadWorktreeLastCommit,
  openAiLoginRequest,
  setOpenAiLoginRequest,
  connected,
}) {
  useEffect(() => {
    if (!attachmentSessionId || !workspaceToken) {
      return;
    }
    let isMounted = true;
    let wakeUpInterval = null;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearPingInterval = () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };
    const clearWakeUpInterval = () => {
      if (wakeUpInterval) {
        clearInterval(wakeUpInterval);
        wakeUpInterval = null;
      }
    };

    const startPingInterval = () => {
      clearPingInterval();
      lastPongRef.current = Date.now();
      pingIntervalRef.current = setInterval(() => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        if (document.hidden) {
          lastPongRef.current = Date.now();
          return;
        }
        const elapsed = Date.now() - lastPongRef.current;
        if (elapsed > 10000 + 5000) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "ping" }));
      }, 10000);
    };

    const startWakeUpInterval = () => {
      clearWakeUpInterval();
      const sendWakeUp = () => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const worktreeId = activeWorktreeIdRef?.current || "main";
        socket.send(JSON.stringify({ type: "wake_up", worktreeId }));
      };
      sendWakeUp();
      wakeUpInterval = setInterval(sendWakeUp, 60 * 1000);
    };

    const scheduleReconnect = () => {
      if (!isMounted) {
        return;
      }
      const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
      reconnectAttemptRef.current = attempt;
      const baseDelay = 500;
      const maxDelay = 10000;
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      const jitter = Math.floor(Math.random() * 250);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay + jitter);
    };

    const connect = () => {
      if (!isMounted) {
        return;
      }
      setStatus(t("Connecting..."));
      const socket = new WebSocket(
        `${window.location.protocol === "https:" ? "wss" : "ws"}://${
          window.location.host
        }/ws?session=${encodeURIComponent(attachmentSessionId)}`
      );
      socketRef.current = socket;
      let authenticated = false;

      const isCurrent = () => socketRef.current === socket;

      socket.addEventListener("open", () => {
        if (!isCurrent()) {
          return;
        }
        socket.send(JSON.stringify({ type: "auth", token: workspaceToken }));
      });

      socket.addEventListener("close", () => {
        if (!isCurrent()) {
          return;
        }
        setConnected(false);
        setStatus(t("Disconnected"));
        setAppServerReady(false);
        clearPingInterval();
        clearWakeUpInterval();
        if (!closingRef.current) {
          scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        if (!isCurrent()) {
          return;
        }
        socket.close();
      });

      socket.addEventListener("message", (event) => {
        if (!isCurrent()) {
          return;
        }
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          return;
        }

        const scopedWorktreeId =
          typeof payload.worktreeId === "string" ? payload.worktreeId : "";
        const hasWorktreeScope = scopedWorktreeId.length > 0;
        const isMainScope = scopedWorktreeId === "main";
        const isWorktreeScoped = hasWorktreeScope && !isMainScope;
        const isMainScopedOrLegacy = isMainScope || !hasWorktreeScope;

        if (
          isMainScopedOrLegacy &&
          (payload.type === "assistant_delta" ||
            payload.type === "command_execution_delta" ||
            payload.type === "command_execution_completed" ||
            payload.type === "item_started")
        ) {
          setProcessing((current) => (current ? current : true));
          setActivity(t("Processing..."));
        }

        if (payload.type === "auth_ok") {
          if (!authenticated) {
            authenticated = true;
            reconnectAttemptRef.current = 0;
            clearReconnectTimer();
            setConnected(true);
            setStatus(t("Connected"));
            startPingInterval();
            startWakeUpInterval();
            void resyncSession();
            requestMessageSync();
            requestWorktreesList();
            const socket = socketRef.current;
            if (socket && socket.readyState === WebSocket.OPEN) {
              const worktreeId = activeWorktreeIdRef?.current || "main";
              socket.send(JSON.stringify({ type: "wake_up", worktreeId }));
            }
          }
          return;
        }

        if (!authenticated) {
          return;
        }

        if (payload.type === "pong") {
          lastPongRef.current = Date.now();
        }

        if (payload.type === "status") {
          setStatus(payload.message);
          if (payload.provider === "codex") {
            setAppServerReady(false);
          }
        }

        if (payload.type === "ready") {
          setStatus(t("Ready"));
          setAppServerReady(true);
        }

        if (payload.type === "provider_status") {
          if (payload.provider === "codex") {
            setAppServerReady(payload.status === "ready");
          }
        }

        if (isMainScopedOrLegacy && payload.type === "assistant_delta") {
          if (typeof payload.delta !== "string") {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = next.findIndex(
              (item) => item?.id === payload.itemId
            );
            if (existingIndex === -1) {
              next.push({
                id: payload.itemId,
                role: "assistant",
                text: payload.delta,
                isStreaming: true,
              });
              return next;
            }

            const updated = { ...next[existingIndex] };
            updated.text += payload.delta;
            updated.isStreaming = true;
            next[existingIndex] = updated;
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "assistant_message") {
          if (typeof payload.text !== "string") {
            return;
          }
          const taskLabel = extractVibe80Task(payload.text);
          if (taskLabel) {
            setMainTaskLabel(taskLabel);
          }
          maybeNotify({ id: payload.itemId, text: payload.text });
          setMessages((current) => {
            const next = [...current];
            const existingIndex = next.findIndex(
              (item) => item?.id === payload.itemId
            );
            if (existingIndex === -1) {
              next.push({
                id: payload.itemId,
                role: "assistant",
                text: payload.text,
                isStreaming: false,
              });
              return next;
            }

            next[existingIndex] = {
              ...next[existingIndex],
              text: payload.text,
              isStreaming: false,
            };
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "action_request") {
          if (!payload.id) {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = next.findIndex(
              (item) => item?.id === payload.id
            );
            if (existingIndex === -1) {
              next.push({
                id: payload.id,
                role: "user",
                type: "action_request",
                text:
                  payload.text ||
                  `/${payload.request || "run"} ${payload.arg || ""}`.trim(),
                action: {
                  request: payload.request,
                  arg: payload.arg,
                },
              });
            }
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "action_result") {
          if (!payload.id) {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = next.findIndex(
              (item) => item?.id === payload.id
            );
            const nextMessage = {
              id: payload.id,
              role: "assistant",
              type: "action_result",
              text: payload.text || "",
              action: {
                request: payload.request,
                arg: payload.arg,
                status: payload.status,
                output: payload.output,
              },
            };
            if (existingIndex === -1) {
              next.push(nextMessage);
            } else {
              next[existingIndex] = {
                ...next[existingIndex],
                ...nextMessage,
              };
            }
            return next;
          });
          if (payload.request === "run" || payload.request === "git") {
            void loadRepoLastCommit();
          }
        }

        if (isMainScopedOrLegacy && payload.type === "backlog_view") {
          if (!payload.id) {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = next.findIndex(
              (item) => item?.id === payload.id
            );
            if (existingIndex === -1) {
              next.push({
                id: payload.id,
                role: "assistant",
                type: "backlog_view",
                text: payload.text || "Backlog",
                backlog: {
                  items: Array.isArray(payload.items) ? payload.items : [],
                  page: Number.isFinite(payload.page) ? payload.page : 0,
                },
              });
            }
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "command_execution_delta") {
          if (typeof payload.delta !== "string") {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = commandIndex.get(payload.itemId);
            if (existingIndex === undefined) {
              const entry = {
                id: payload.itemId,
                role: "commandExecution",
                command: t("Command"),
                output: payload.delta,
                isExpandable: true,
                status: "running",
              };
              commandIndex.set(payload.itemId, next.length);
              next.push(entry);
              return next;
            }
            const updated = { ...next[existingIndex] };
            updated.output = `${updated.output || ""}${payload.delta}`;
            updated.isExpandable = true;
            next[existingIndex] = updated;
            return next;
          });
        }

        if (
          isMainScopedOrLegacy &&
          payload.type === "command_execution_completed"
        ) {
          const item = payload.item;
          const itemId = payload.itemId || item?.id;
          if (!itemId) {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = commandIndex.get(itemId);
            const command =
              item?.commandActions?.command || item?.command || t("Command");
            if (existingIndex === undefined) {
              const entry = {
                id: itemId,
                role: "commandExecution",
                command,
                output: item?.aggregatedOutput || "",
                isExpandable: true,
                status: "completed",
              };
              commandIndex.set(itemId, next.length);
              next.push(entry);
              return next;
            }
            const updated = { ...next[existingIndex] };
            updated.command = command;
            updated.output = item?.aggregatedOutput || updated.output || "";
            updated.isExpandable = true;
            updated.status = "completed";
            next[existingIndex] = updated;
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "turn_error") {
          setStatus(t("Error: {{message}}", { message: payload.message }));
          setCurrentTurnId(null);
          setMainTaskLabel("");
        }

        if (isMainScopedOrLegacy && payload.type === "agent_reasoning") {
          const label = extractFirstLine(payload.text);
          if (label) {
            setMainTaskLabel(label);
          }
        }

        if (isMainScopedOrLegacy && payload.type === "error") {
          setStatus(payload.message || t("Unexpected error"));
          setModelLoading(false);
          setModelError(payload.message || t("Unexpected error"));
        }

        if (isWorktreeScoped && payload.type === "error") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(scopedWorktreeId);
            if (!wt) {
              return current;
            }
            next.set(scopedWorktreeId, {
              ...wt,
              modelLoading: false,
              modelError: payload.message || t("Unexpected error"),
            });
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "turn_started") {
          setCurrentTurnId(payload.turnId || null);
        }

        if (isMainScopedOrLegacy && payload.type === "turn_completed") {
          const errorPayload = payload?.turn?.error || payload?.error || null;
          const turnErrorInfo = errorPayload?.codexErrorInfo;
          if (turnErrorInfo === "usageLimitExceeded") {
            const warningId = `usage-limit-${
              payload.turnId || payload.turn?.id || Date.now()
            }`;
            const warningText =
              (typeof errorPayload === "string"
                ? errorPayload
                : errorPayload?.message) ||
              t("Usage limit reached. Please try again later.");
            setMessages((current) => {
              if (current.some((message) => message.id === warningId)) {
                return current;
              }
              return [
                ...current,
                {
                  id: warningId,
                  role: "assistant",
                  text: `⚠️ ${warningText}`,
                },
              ];
            });
          }
          setCurrentTurnId(null);
          setMainTaskLabel("");
          void loadRepoLastCommit();
        }

        if (isMainScopedOrLegacy && payload.type === "repo_diff") {
          setRepoDiff({
            status: payload.status || "",
            diff: payload.diff || "",
          });
        }

        if (isMainScopedOrLegacy && payload.type === "model_list") {
          const list = Array.isArray(payload.models) ? payload.models : [];
          setModels(list);
          if (payload.provider) {
            setProviderModelState((current) => ({
              ...current,
              [payload.provider]: {
                models: list,
                loading: false,
                error: "",
              },
            }));
          }
          const defaultModel = list.find((model) => model.isDefault);
          if (defaultModel?.model) {
            setSelectedModel(defaultModel.model);
          }
          if (defaultModel?.defaultReasoningEffort) {
            setSelectedReasoningEffort(defaultModel.defaultReasoningEffort);
          }
          setModelLoading(false);
          setModelError("");
        }

        if (isWorktreeScoped && payload.type === "model_list") {
          const list = Array.isArray(payload.models) ? payload.models : [];
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(scopedWorktreeId);
            if (!wt) {
              return current;
            }
            const defaultModel = list.find((model) => model.isDefault);
            const resolvedModel = wt.model || defaultModel?.model || null;
            next.set(scopedWorktreeId, {
              ...wt,
              models: list,
              model: resolvedModel,
              modelLoading: false,
              modelError: "",
            });
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "model_set") {
          setSelectedModel(payload.model || "");
          if (payload.reasoningEffort !== undefined) {
            setSelectedReasoningEffort(payload.reasoningEffort || "");
          }
          setModelLoading(false);
          setModelError("");
        }

        if (isWorktreeScoped && payload.type === "model_set") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(scopedWorktreeId);
            if (!wt) {
              return current;
            }
            next.set(scopedWorktreeId, {
              ...wt,
              model: payload.model || null,
              reasoningEffort: payload.reasoningEffort ?? wt.reasoningEffort ?? null,
              modelLoading: false,
              modelError: "",
            });
            return next;
          });
        }

        if (isMainScopedOrLegacy && payload.type === "rpc_log") {
          if (!rpcLogsEnabledRef.current) {
            return;
          }
          if (payload.entry) {
            setRpcLogs((current) => [...current, payload.entry]);
          }
        }

        if (isMainScopedOrLegacy && payload.type === "session_sync") {
          if (!payload?.session) {
            return;
          }
          const data = payload.session;
          setMessages(
            (data.messages || []).map((message, index) => ({
              ...message,
              id: message?.id || `history-${index}`,
              attachments: normalizeAttachments(message?.attachments || []),
              toolResult: message?.toolResult,
            }))
          );
          setRepoDiff(data.repoDiff || { status: "", diff: "" });
          if (data.provider) {
            setProviderModelState((current) => ({
              ...current,
              [data.provider]: {
                models: data.models || [],
                loading: false,
                error: "",
              },
            }));
          }
        }

        if (isMainScopedOrLegacy && payload.type === "worktrees_list") {
          applyWorktreesList(payload.worktrees || []);
        }

        if (isMainScopedOrLegacy && payload.type === "worktree_messages_sync") {
          if (payload.worktreeId === "main") {
            mergeAndApplyMessages(payload.messages || []);
            return;
          }
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              const incoming = (payload.messages || []).map((message, index) => ({
                ...message,
                id: message?.id || `history-${index}`,
                attachments: normalizeAttachments(message?.attachments || []),
                toolResult: message?.toolResult,
              }));
              const seen = new Set(
                wt.messages.map((message) => message?.id).filter(Boolean)
              );
              const merged = [...wt.messages];
              incoming.forEach((message) => {
                if (message?.id && seen.has(message.id)) {
                  return;
                }
                if (message?.id) {
                  seen.add(message.id);
                }
                merged.push(message);
              });
              next.set(payload.worktreeId, {
                ...wt,
                messages: merged,
                status: payload.status ?? wt.status,
              });
            }
            return next;
          });
        }

        if (payload.type === "worktree_diff") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, {
                ...wt,
                diff: { status: payload.status, diff: payload.diff },
              });
            }
            return next;
          });
        }

        if (
          isWorktreeScoped &&
          (payload.type === "assistant_delta" ||
            payload.type === "assistant_message" ||
            payload.type === "action_request" ||
            payload.type === "action_result" ||
            payload.type === "backlog_view" ||
            payload.type === "command_execution_delta" ||
            payload.type === "command_execution_completed" ||
            payload.type === "turn_started" ||
            payload.type === "turn_completed" ||
            payload.type === "turn_error")
        ) {
          const wtId = payload.worktreeId;

          if (
            payload.type === "assistant_delta" ||
            payload.type === "command_execution_delta" ||
            payload.type === "command_execution_completed" ||
            payload.type === "item_started"
          ) {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt && wt.status === "ready") {
                next.set(wtId, { ...wt, status: "processing" });
              }
              return next;
            });
          }

          if (payload.type === "turn_started") {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt) {
                next.set(wtId, {
                  ...wt,
                  currentTurnId: payload.turnId,
                  activity: t("Processing..."),
                });
              }
              return next;
            });
          }

          if (payload.type === "action_request") {
            if (!payload.id) {
              return;
            }
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt) {
                next.set(wtId, {
                  ...wt,
                  messages: [
                    ...wt.messages,
                    {
                      id: payload.id,
                      role: "user",
                      type: "action_request",
                      text:
                        payload.text ||
                        `/${payload.request || "run"} ${payload.arg || ""}`.trim(),
                      action: {
                        request: payload.request,
                        arg: payload.arg,
                      },
                    },
                  ],
                });
              }
              return next;
            });
          }

          if (payload.type === "action_result") {
            if (!payload.id) {
              return;
            }
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId) || {
                id: wtId,
                name: wtId,
                branchName: "",
                provider: "codex",
                status: "processing",
                messages: [],
                models: [],
                modelLoading: false,
                modelError: "",
                activity: "",
                currentTurnId: null,
              };
              if (wt.messages.some((message) => message?.id === payload.id)) {
                return current;
              }
              next.set(wtId, {
                ...wt,
                messages: [
                  ...wt.messages,
                  {
                    id: payload.id,
                    role: "assistant",
                    type: "action_result",
                    text: payload.text || "",
                    action: {
                      request: payload.request,
                      arg: payload.arg,
                      status: payload.status,
                      output: payload.output,
                    },
                  },
                ],
              });
              return next;
            });
          if (payload.request === "run" || payload.request === "git") {
            void loadWorktreeLastCommit(wtId);
          }
          }

          if (payload.type === "backlog_view") {
            if (!payload.id) {
              return;
            }
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt) {
                next.set(wtId, {
                  ...wt,
                  messages: [
                    ...wt.messages,
                    {
                      id: payload.id,
                      role: "assistant",
                      type: "backlog_view",
                      text: payload.text || "Backlog",
                      backlog: {
                        items: Array.isArray(payload.items) ? payload.items : [],
                        page: Number.isFinite(payload.page) ? payload.page : 0,
                      },
                    },
                  ],
                });
              }
              return next;
            });
          }

          if (payload.type === "turn_completed" || payload.type === "turn_error") {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt) {
                next.set(wtId, {
                  ...wt,
                  currentTurnId: null,
                  activity: "",
                  taskLabel: "",
                });
              }
              return next;
            });
          }

          if (payload.type === "turn_completed") {
            const errorPayload = payload?.turn?.error || payload?.error || null;
            const turnErrorInfo = errorPayload?.codexErrorInfo;
            if (turnErrorInfo === "usageLimitExceeded") {
              const warningId = `usage-limit-${payload.turnId || Date.now()}`;
              const warningText =
                (typeof errorPayload === "string"
                  ? errorPayload
                  : errorPayload?.message) ||
                t("Usage limit reached. Please try again later.");
              setWorktrees((current) => {
                const next = new Map(current);
                const wt = next.get(wtId);
                if (!wt) return current;
                if (wt.messages.some((message) => message.id === warningId)) {
                  return current;
                }
                next.set(wtId, {
                  ...wt,
                  messages: [
                    ...wt.messages,
                    { id: warningId, role: "assistant", text: `⚠️ ${warningText}` },
                  ],
                });
                return next;
              });
            }
            void loadWorktreeLastCommit(wtId);
          }

          if (
            payload.type === "assistant_delta" ||
            payload.type === "assistant_message"
          ) {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (!wt) return current;

              const messages = [...wt.messages];
              const existingIdx = messages.findIndex(
                (m) => m.id === payload.itemId
              );

              if (payload.type === "assistant_delta") {
                if (existingIdx === -1) {
                  messages.push({
                    id: payload.itemId,
                    role: "assistant",
                    text: payload.delta || "",
                    isStreaming: true,
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    text:
                      (messages[existingIdx].text || "") + (payload.delta || ""),
                    isStreaming: true,
                  };
                }
              } else {
                if (existingIdx === -1) {
                  messages.push({
                    id: payload.itemId,
                    role: "assistant",
                    text: payload.text || "",
                    isStreaming: false,
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    text: payload.text || "",
                    isStreaming: false,
                  };
                }
              }

              next.set(wtId, { ...wt, messages });
              return next;
            });
            if (payload.type === "assistant_message" && typeof payload.text === "string") {
              const taskLabel = extractVibe80Task(payload.text);
              if (taskLabel) {
                setWorktrees((current) => {
                  const next = new Map(current);
                  const wt = next.get(wtId);
                  if (!wt) return current;
                  next.set(wtId, { ...wt, taskLabel });
                  return next;
                });
              }
            }
          }

          if (
            payload.type === "command_execution_delta" ||
            payload.type === "command_execution_completed"
          ) {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (!wt) return current;

              const messages = [...wt.messages];
              const itemId = payload.itemId || payload.item?.id;
              const existingIdx = messages.findIndex((m) => m.id === itemId);

              if (payload.type === "command_execution_delta") {
                if (existingIdx === -1) {
                  messages.push({
                    id: itemId,
                    role: "commandExecution",
                    command: t("Command"),
                    output: payload.delta || "",
                    status: "running",
                    isExpandable: true,
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    output:
                      (messages[existingIdx].output || "") + (payload.delta || ""),
                  };
                }
              } else {
                const item = payload.item;
                const command =
                  item?.commandActions?.command || item?.command || t("Command");
                if (existingIdx === -1) {
                  messages.push({
                    id: itemId,
                    role: "commandExecution",
                    command,
                    output: item?.aggregatedOutput || "",
                    status: "completed",
                    isExpandable: true,
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    command,
                    output:
                      item?.aggregatedOutput ||
                      messages[existingIdx].output ||
                      "",
                    status: "completed",
                  };
                }
              }

              next.set(wtId, { ...wt, messages });
              return next;
            });
          }
        }

        if (payload.type === "agent_reasoning" && isWorktreeScoped) {
          const label = extractFirstLine(payload.text);
          if (label) {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(payload.worktreeId);
              if (!wt) return current;
              next.set(payload.worktreeId, { ...wt, taskLabel: label });
              return next;
            });
          }
        }

        if (payload.type === "item_started" && isWorktreeScoped) {
          const label = getItemActivityLabel(payload.item);
          if (!label) {
            return;
          }
          const wtId = payload.worktreeId;
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(wtId);
            if (wt) {
              next.set(wtId, { ...wt, activity: label });
            }
            return next;
          });
        }

        if (payload.type === "worktree_created") {
          setWorktrees((current) => {
            const next = new Map(current);
            next.set(payload.worktreeId, {
              id: payload.worktreeId,
              name: payload.name,
              branchName: payload.branchName,
              provider: payload.provider,
              model: payload.model || null,
              reasoningEffort: payload.reasoningEffort || null,
              internetAccess: Boolean(payload.internetAccess),
              denyGitCredentialsAccess:
                typeof payload.denyGitCredentialsAccess === "boolean"
                  ? payload.denyGitCredentialsAccess
                  : true,
              status: payload.status || "creating",
              color: payload.color,
              models: [],
              modelLoading: false,
              modelError: "",
              messages: [],
              activity: "",
              currentTurnId: null,
            });
            return next;
          });
          setPaneByTab((current) => ({
            ...current,
            [payload.worktreeId]: current[payload.worktreeId] || "chat",
          }));
          setLogFilterByTab((current) => ({
            ...current,
            [payload.worktreeId]: current[payload.worktreeId] || "all",
          }));
          setActiveWorktreeId(payload.worktreeId);
        }

        if (payload.type === "worktree_ready") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, { ...wt, status: "ready" });
            }
            return next;
          });
        }

        if (payload.type === "worktree_status") {
          if (payload.worktreeId === "main") {
            if (!payload.status) {
              return;
            }
            setHasMainWorktreeStatus?.(true);
            const nextStatus = payload.status;
            setProcessing(nextStatus === "processing");
            setActivity(nextStatus === "processing" ? t("Processing...") : "");
            if (nextStatus !== "processing") {
              setMainTaskLabel("");
            }
            return;
          }
          if (!payload.status) {
            return;
          }
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, {
                ...wt,
                status: payload.status,
                error: payload.error || null,
                ...(payload.status === "processing"
                  ? {}
                  : { activity: "", taskLabel: "", currentTurnId: null }),
              });
            }
            return next;
          });
        }

        if (payload.type === "worktree_removed") {
          setWorktrees((current) => {
            const next = new Map(current);
            next.delete(payload.worktreeId);
            return next;
          });
          setPaneByTab((current) => {
            const next = { ...current };
            delete next[payload.worktreeId];
            return next;
          });
          setLogFilterByTab((current) => {
            const next = { ...current };
            delete next[payload.worktreeId];
            return next;
          });
          if (activeWorktreeIdRef.current === payload.worktreeId) {
            setActiveWorktreeId("main");
          }
        }

        if (payload.type === "worktree_renamed") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, { ...wt, name: payload.name });
            }
            return next;
          });
        }
      });
    };

    connect();

    const handleVisibilityChange = () => {
      if (document.hidden || !isMounted) {
        return;
      }
      lastPongRef.current = Date.now();
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "ping" }));
        void resyncSession();
        requestMessageSync();
        const worktreeId = activeWorktreeIdRef?.current || "main";
        socket.send(JSON.stringify({ type: "wake_up", worktreeId }));
      } else {
        clearReconnectTimer();
        reconnectAttemptRef.current = 0;
        connect();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      closingRef.current = true;
      clearReconnectTimer();
      clearPingInterval();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (socketRef.current) {
        socketRef.current.close();
      }
      clearWakeUpInterval();
      closingRef.current = false;
    };
  }, [
    attachmentSessionId,
    workspaceToken,
    messageIndex,
    commandIndex,
    mergeAndApplyMessages,
    requestMessageSync,
    requestWorktreesList,
    requestWorktreeMessages,
    applyWorktreesList,
    resyncSession,
    t,
  ]);

  useEffect(() => {
    if (!attachmentSessionId || !openAiLoginRequest || !connected) {
      return;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        type: "account_login_start",
        provider: "codex",
        params: openAiLoginRequest,
      })
    );
    setOpenAiLoginRequest(null);
  }, [attachmentSessionId, connected, openAiLoginRequest, setOpenAiLoginRequest, socketRef]);
}
