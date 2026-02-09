import { useCallback, useEffect, useMemo, useState } from "react";

export default function useBacklog({
  attachmentSessionId,
  apiFetch,
  normalizeAttachments,
  sendMessage,
  setInput,
  setMessages,
  setWorktrees,
  setDraftAttachments,
  input,
  draftAttachments,
  inputRef,
  showToast,
  t,
}) {
  const [backlog, setBacklog] = useState([]);

  const backlogKey = useMemo(
    () =>
      attachmentSessionId ? `backlog:${attachmentSessionId}` : null,
    [attachmentSessionId]
  );

  useEffect(() => {
    if (!backlogKey) {
      return;
    }
    try {
      const stored = JSON.parse(localStorage.getItem(backlogKey) || "[]");
      setBacklog(Array.isArray(stored) ? stored : []);
    } catch {
      setBacklog([]);
    }
  }, [backlogKey]);

  useEffect(() => {
    if (!backlogKey) {
      return;
    }
    localStorage.setItem(backlogKey, JSON.stringify(backlog));
  }, [backlog, backlogKey]);

  const updateBacklogMessages = useCallback(
    (updateFn) => {
      setMessages((current) =>
        current.map((message) => {
          if (message?.type !== "backlog_view") {
            return message;
          }
          const items = Array.isArray(message.backlog?.items)
            ? message.backlog.items
            : [];
          const updatedItems = updateFn(items);
          if (updatedItems === items) {
            return message;
          }
          return {
            ...message,
            backlog: {
              ...(message.backlog || {}),
              items: updatedItems,
            },
          };
        })
      );
      setWorktrees((current) => {
        const next = new Map(current);
        next.forEach((wt, id) => {
          if (!Array.isArray(wt?.messages)) {
            return;
          }
          let changed = false;
          const updatedMessages = wt.messages.map((message) => {
            if (message?.type !== "backlog_view") {
              return message;
            }
            const items = Array.isArray(message.backlog?.items)
              ? message.backlog.items
              : [];
            const updatedItems = updateFn(items);
            if (updatedItems === items) {
              return message;
            }
            changed = true;
            return {
              ...message,
              backlog: {
                ...(message.backlog || {}),
                items: updatedItems,
              },
            };
          });
          if (changed) {
            next.set(id, { ...wt, messages: updatedMessages });
          }
        });
        return next;
      });
    },
    [setMessages, setWorktrees]
  );

  const setBacklogMessagePage = useCallback(
    (targetWorktreeId, messageId, page) => {
      if (targetWorktreeId && targetWorktreeId !== "main") {
        setWorktrees((current) => {
          const next = new Map(current);
          const wt = next.get(targetWorktreeId);
          if (!wt) {
            return current;
          }
          const updatedMessages = wt.messages.map((message) =>
            message?.id === messageId && message.type === "backlog_view"
              ? {
                  ...message,
                  backlog: {
                    ...(message.backlog || {}),
                    page,
                  },
                }
              : message
          );
          next.set(targetWorktreeId, { ...wt, messages: updatedMessages });
          return next;
        });
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message?.id === messageId && message.type === "backlog_view"
            ? {
                ...message,
                backlog: {
                  ...(message.backlog || {}),
                  page,
                },
              }
            : message
        )
      );
    },
    [setMessages, setWorktrees]
  );

  const markBacklogItemDone = useCallback(
    async (itemId) => {
      if (!attachmentSessionId) {
        showToast?.(t("Session not found."), "error");
        return;
      }
      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/backlog-items/${encodeURIComponent(itemId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ done: true }),
          }
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || t("Unable to update backlog."));
        }
        const payload = await response.json().catch(() => ({}));
        const updatedItem = payload?.item;
        updateBacklogMessages((items) =>
          items.map((item) =>
            item?.id === itemId
              ? { ...item, ...updatedItem, done: true }
              : item
          )
        );
      } catch (error) {
        showToast?.(error.message || t("Unable to update backlog."), "error");
      }
    },
    [apiFetch, attachmentSessionId, showToast, t, updateBacklogMessages]
  );

  const addToBacklog = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    const entry = {
      id: `backlog-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: trimmed,
      createdAt: Date.now(),
      attachments: draftAttachments,
    };
    setBacklog((current) => [entry, ...current]);
    setInput("");
  }, [draftAttachments, input, setInput]);

  const removeFromBacklog = useCallback((id) => {
    setBacklog((current) => current.filter((item) => item.id !== id));
  }, []);

  const editBacklogItem = useCallback(
    (item) => {
      setInput(item.text || "");
      setDraftAttachments(normalizeAttachments(item.attachments || []));
      inputRef?.current?.focus();
    },
    [inputRef, normalizeAttachments, setDraftAttachments, setInput]
  );

  const launchBacklogItem = useCallback(
    (item) => {
      sendMessage(item.text || "", item.attachments || []);
      removeFromBacklog(item.id);
    },
    [removeFromBacklog, sendMessage]
  );

  return {
    addToBacklog,
    backlog,
    markBacklogItemDone,
    removeFromBacklog,
    editBacklogItem,
    launchBacklogItem,
    setBacklog,
    setBacklogMessagePage,
    updateBacklogMessages,
  };
}
