import { useCallback, useEffect, useRef, useState } from "react";

export default function useWorktrees({
  apiFetch,
  attachmentSessionId,
  availableProviders,
  llmProvider,
  messagesRef,
  normalizeAttachments,
  applyMessages,
  socketRef,
  setPaneByTab,
  setLogFilterByTab,
  showToast,
  t,
}) {
  const [worktrees, setWorktrees] = useState(new Map());
  const worktreesRef = useRef(new Map());
  const [activeWorktreeId, setActiveWorktreeId] = useState("main");
  const activeWorktreeIdRef = useRef("main");

  useEffect(() => {
    worktreesRef.current = worktrees;
  }, [worktrees]);

  useEffect(() => {
    activeWorktreeIdRef.current = activeWorktreeId;
  }, [activeWorktreeId]);

  const getLastSeenMessageId = useCallback((items) => {
    if (!Array.isArray(items)) {
      return null;
    }
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i]?.id) {
        return items[i].id;
      }
    }
    return null;
  }, []);

  const loadMainWorktreeSnapshot = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    try {
      const response = await apiFetch(
        `/api/worktree/main/messages?session=${encodeURIComponent(
          attachmentSessionId
        )}`
      );
      if (!response.ok) {
        return;
      }
      const payload = await response.json().catch(() => ({}));
      if (Array.isArray(payload?.messages)) {
        const normalized = payload.messages.map((message, index) => ({
          ...message,
          id: message?.id || `history-${index}`,
          attachments: normalizeAttachments(message?.attachments || []),
          toolResult: message?.toolResult,
        }));
        applyMessages(normalized);
      }
    } catch {
      // Ignore snapshot failures; WS sync will retry.
    }
  }, [attachmentSessionId, apiFetch, applyMessages, normalizeAttachments]);

  const loadWorktreeSnapshot = useCallback(
    async (worktreeId) => {
      if (!attachmentSessionId || !worktreeId) {
        return;
      }
      if (worktreeId === "main") {
        await loadMainWorktreeSnapshot();
        return;
      }
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            worktreeId
          )}?session=${encodeURIComponent(attachmentSessionId)}`
        );
        if (!response.ok) {
          return;
        }
        const payload = await response.json().catch(() => ({}));
        const messagesResponse = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            worktreeId
          )}/messages?session=${encodeURIComponent(attachmentSessionId)}`
        );
        if (!messagesResponse.ok) {
          return;
        }
        const messagesPayload = await messagesResponse.json().catch(() => ({}));
        if (!Array.isArray(messagesPayload?.messages)) {
          return;
        }
        const normalizedMessages = messagesPayload.messages.map(
          (message, index) => ({
            ...message,
            id: message?.id || `history-${index}`,
            attachments: normalizeAttachments(message?.attachments || []),
            toolResult: message?.toolResult,
          })
        );
        setWorktrees((current) => {
          const next = new Map(current);
          const wt = next.get(worktreeId);
          if (wt) {
            next.set(worktreeId, {
              ...wt,
              messages: normalizedMessages,
              status: payload.status || wt.status,
            });
          }
          return next;
        });
      } catch {
        // Ignore snapshot failures; WS sync will retry.
      }
    },
    [
      attachmentSessionId,
      apiFetch,
      loadMainWorktreeSnapshot,
      normalizeAttachments,
    ]
  );

  const requestWorktreeMessages = useCallback(
    (worktreeId) => {
      const socket = socketRef?.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!worktreeId) {
        return;
      }
      const worktreesCurrent = worktreesRef.current;
      const lastSeenMessageId =
        worktreeId === "main"
          ? getLastSeenMessageId(messagesRef.current)
          : getLastSeenMessageId(worktreesCurrent.get(worktreeId)?.messages);
      socket.send(
        JSON.stringify({
          type: "sync_worktree_messages",
          worktreeId,
          lastSeenMessageId,
        })
      );
    },
    [getLastSeenMessageId, messagesRef, socketRef]
  );

  const applyWorktreesList = useCallback(
    (worktreesList) => {
      if (!Array.isArray(worktreesList)) {
        return;
      }
      const nextMap = new Map();
      worktreesList.forEach((wt) => {
        nextMap.set(wt.id, {
          ...wt,
          messages: [],
          activity: "",
          currentTurnId: null,
        });
      });
      setWorktrees(nextMap);
      setPaneByTab((current) => {
        const next = { ...current };
        worktreesList.forEach((wt) => {
          if (!next[wt.id]) {
            next[wt.id] = "chat";
          }
        });
        return next;
      });
      setLogFilterByTab((current) => {
        const next = { ...current };
        worktreesList.forEach((wt) => {
          if (!next[wt.id]) {
            next[wt.id] = "all";
          }
        });
        return next;
      });
      if (
        activeWorktreeIdRef.current !== "main" &&
        !worktreesList.some((wt) => wt.id === activeWorktreeIdRef.current)
      ) {
        setActiveWorktreeId("main");
      }
    },
    [setLogFilterByTab, setPaneByTab]
  );

  const requestWorktreesList = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    try {
      const response = await apiFetch(
        `/api/worktrees?session=${encodeURIComponent(attachmentSessionId)}`
      );
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      applyWorktreesList(payload?.worktrees);
    } catch {
      // Ignore worktree list failures (retry on next reconnect).
    }
  }, [attachmentSessionId, apiFetch, applyWorktreesList]);

  const handleSelectWorktree = useCallback(
    (worktreeId) => {
      if (!worktreeId) {
        return;
      }
      setActiveWorktreeId(worktreeId);
      void loadWorktreeSnapshot(worktreeId);
    },
    [loadWorktreeSnapshot]
  );

  const createWorktree = useCallback(
    async ({
      name,
      provider: wtProvider,
      startingBranch,
      model,
      reasoningEffort,
      internetAccess,
      denyGitCredentialsAccess,
    }) => {
      if (!attachmentSessionId) {
        showToast?.(t("Session not found."), "error");
        return;
      }
      try {
        const response = await apiFetch("/api/worktree", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session: attachmentSessionId,
            provider: availableProviders.includes(wtProvider)
              ? wtProvider
              : llmProvider,
            name: name || null,
            startingBranch: startingBranch || null,
            model: model || null,
            reasoningEffort: reasoningEffort ?? null,
            internetAccess: Boolean(internetAccess),
            denyGitCredentialsAccess: Boolean(denyGitCredentialsAccess),
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error || t("Failed to create parallel request.")
          );
        }
        const payload = await response.json();
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
            denyGitCredentialsAccess: Boolean(payload.denyGitCredentialsAccess),
            status: payload.status || "creating",
            color: payload.color,
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
        void requestWorktreesList();
      } catch (error) {
        showToast?.(
          error.message || t("Failed to create parallel request."),
          "error"
        );
      }
    },
    [
      apiFetch,
      attachmentSessionId,
      availableProviders,
      llmProvider,
      requestWorktreesList,
      setLogFilterByTab,
      setPaneByTab,
      showToast,
      t,
    ]
  );

  const closeWorktree = useCallback(
    async (worktreeId) => {
      if (!attachmentSessionId) return;
      try {
        const response = await apiFetch(
          `/api/worktree/${worktreeId}?session=${encodeURIComponent(
            attachmentSessionId
          )}`,
          { method: "DELETE" }
        );
        if (!response.ok) {
          console.error("Failed to close worktree");
        }
      } catch (error) {
        console.error("Error closing worktree:", error);
      }
    },
    [attachmentSessionId, apiFetch]
  );

  const renameWorktreeHandler = useCallback(
    async (worktreeId, newName) => {
      if (!attachmentSessionId) return;
      try {
        const response = await apiFetch(
          `/api/worktree/${worktreeId}?session=${encodeURIComponent(
            attachmentSessionId
          )}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName }),
          }
        );
        if (!response.ok) {
          console.error("Failed to rename worktree");
        }
      } catch (error) {
        console.error("Error renaming worktree:", error);
      }
    },
    [attachmentSessionId, apiFetch]
  );

  return {
    activeWorktreeId,
    activeWorktreeIdRef,
    applyWorktreesList,
    closeWorktree,
    createWorktree,
    handleSelectWorktree,
    loadMainWorktreeSnapshot,
    loadWorktreeSnapshot,
    requestWorktreeMessages,
    requestWorktreesList,
    renameWorktreeHandler,
    setActiveWorktreeId,
    setWorktrees,
    worktrees,
  };
}
