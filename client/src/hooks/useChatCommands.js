import { useCallback, useEffect } from "react";

export default function useChatCommands({
  activeProvider,
  activeWorktreeId,
  addToBacklog,
  apiFetch,
  attachmentSessionId,
  captureScreenshot,
  connected,
  handleSendMessageRef,
  handleViewSelect,
  input,
  isCodexReady,
  isInWorktree,
  openPathInExplorer,
  requestRepoDiff,
  requestWorktreeDiff,
  sendMessage,
  sendWorktreeMessage,
  setCommandMenuOpen,
  setDraftAttachments,
  setInput,
  setMessages,
  setWorktrees,
  socketRef,
  t,
  showToast,
}) {
  const handleSendMessage = useCallback(
    (textOverride, attachmentsOverride) => {
      const rawText = (textOverride ?? input).trim();
      if (!rawText) {
        return;
      }
      if (activeProvider === "codex" && !isCodexReady) {
        showToast(t("Codex is starting. Please wait."), "info");
        return;
      }
      if (rawText === "/diff" || rawText.startsWith("/diff ")) {
        handleViewSelect("diff");
        if (activeWorktreeId && activeWorktreeId !== "main") {
          requestWorktreeDiff(activeWorktreeId);
        } else {
          requestRepoDiff();
        }
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/backlog")) {
        if (!attachmentSessionId) {
          showToast(t("Session not found."), "error");
          return;
        }
        void (async () => {
          try {
            const response = await apiFetch(
              `/api/sessions/${encodeURIComponent(attachmentSessionId)}/backlog-items`
            );
            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || t("Unable to load backlog."));
            }
            const payload = await response.json().catch(() => ({}));
            const items = Array.isArray(payload?.items) ? payload.items : [];
            const messageId = `backlog-${Date.now()}-${Math.random()
              .toString(16)
              .slice(2, 8)}`;
            const backlogMessage = {
              id: messageId,
              role: "assistant",
              type: "backlog_view",
              text: "Backlog",
              backlog: {
                items,
                page: 0,
              },
            };
            if (isInWorktree && activeWorktreeId) {
              setWorktrees((current) => {
                const next = new Map(current);
                const wt = next.get(activeWorktreeId);
                if (wt) {
                  next.set(activeWorktreeId, {
                    ...wt,
                    messages: [...(wt.messages || []), backlogMessage],
                  });
                }
                return next;
              });
            } else {
              setMessages((current) => [...current, backlogMessage]);
            }
          } catch (error) {
            showToast(error.message || t("Unable to load backlog."), "error");
          }
        })();
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/open")) {
        const targetPath = rawText.replace(/^\/open\s*/i, "").trim();
        if (!targetPath) {
          showToast(t("Path required."), "error");
          return;
        }
        openPathInExplorer(targetPath)
          .then(() => {
            setInput("");
            setDraftAttachments([]);
            setCommandMenuOpen(false);
          })
          .catch(() => null);
        return;
      }
      if (rawText.startsWith("/todo")) {
        const action = rawText.replace(/^\/todo\s*/i, "").trim();
        if (!action) {
          showToast(t("Todo text required."), "error");
          return;
        }
        if (!attachmentSessionId) {
          showToast(t("Session not found."), "error");
          return;
        }
        void (async () => {
          try {
            const response = await apiFetch(
              `/api/sessions/${encodeURIComponent(attachmentSessionId)}/backlog-items`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: action }),
              }
            );
            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || t("Unable to update backlog."));
            }
            showToast(t("Added to backlog."));
          } catch (error) {
            showToast(
              error.message || t("Unable to update backlog."),
              "error"
            );
          }
        })();
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/run")) {
        const command = rawText.replace(/^\/run\s*/i, "").trim();
        if (!command) {
          showToast(t("Command required."), "error");
          return;
        }
        if (!socketRef.current || !connected) {
          showToast(t("Disconnected"), "error");
          return;
        }
        const targetWorktreeId =
          isInWorktree && activeWorktreeId ? activeWorktreeId : null;
        socketRef.current.send(
          JSON.stringify({
            type: "action_request",
            request: "run",
            arg: command,
            worktreeId: targetWorktreeId || undefined,
          })
        );
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/screenshot")) {
        captureScreenshot()
          .then(() => {
            setInput("");
            setCommandMenuOpen(false);
          })
          .catch(() => null);
        return;
      }
      if (rawText.startsWith("/git")) {
        const command = rawText.replace(/^\/git\s*/i, "").trim();
        if (!command) {
          showToast(t("Git command required."), "error");
          return;
        }
        if (!socketRef.current || !connected) {
          showToast(t("Disconnected"), "error");
          return;
        }
        const targetWorktreeId =
          isInWorktree && activeWorktreeId ? activeWorktreeId : null;
        socketRef.current.send(
          JSON.stringify({
            type: "action_request",
            request: "git",
            arg: command,
            worktreeId: targetWorktreeId || undefined,
          })
        );
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (isInWorktree && activeWorktreeId) {
        sendWorktreeMessage(activeWorktreeId, textOverride, attachmentsOverride);
      } else {
        sendMessage(textOverride, attachmentsOverride);
      }
    },
    [
      activeProvider,
      activeWorktreeId,
      apiFetch,
      attachmentSessionId,
      captureScreenshot,
      connected,
      handleViewSelect,
      input,
      isCodexReady,
      isInWorktree,
      openPathInExplorer,
      requestRepoDiff,
      requestWorktreeDiff,
      sendMessage,
      sendWorktreeMessage,
      setCommandMenuOpen,
      setDraftAttachments,
      setInput,
      showToast,
      socketRef,
      t,
    ]
  );

  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage, handleSendMessageRef]);

  return {
    handleSendMessage,
  };
}
