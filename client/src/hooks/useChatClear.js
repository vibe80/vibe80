import { useCallback } from "react";

export default function useChatClear({
  activeWorktreeId,
  setToolbarExportOpen,
  setWorktrees,
  lastNotifiedIdRef,
  attachmentSessionId,
  apiFetch,
  setMessages,
  messageIndex,
  commandIndex,
  setChoiceSelections,
  choicesKey,
  setCommandPanelOpen,
  setToolResultPanelOpen,
  llmProvider,
}) {
  const handleClearChat = useCallback(async () => {
    setToolbarExportOpen(false);
    if (activeWorktreeId !== "main") {
      setWorktrees((current) => {
        const next = new Map(current);
        const wt = next.get(activeWorktreeId);
        if (wt) {
          next.set(activeWorktreeId, { ...wt, messages: [] });
        }
        return next;
      });
      lastNotifiedIdRef.current = null;
      if (attachmentSessionId) {
        try {
          await apiFetch(
            `/api/v1/sessions/${encodeURIComponent(attachmentSessionId)}/clear`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ worktreeId: activeWorktreeId }),
            }
          );
        } catch (error) {
          // Ignore clear failures; next refresh will resync.
        }
      }
      return;
    }

    setMessages([]);
    messageIndex.clear();
    commandIndex.clear();
    setChoiceSelections({});
    if (choicesKey) {
      localStorage.removeItem(choicesKey);
    }
    setCommandPanelOpen({});
    setToolResultPanelOpen({});
    lastNotifiedIdRef.current = null;
    if (attachmentSessionId) {
      try {
        await apiFetch(
          `/api/v1/sessions/${encodeURIComponent(attachmentSessionId)}/clear`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: llmProvider }),
          }
        );
      } catch (error) {
        // Ignore clear failures; next refresh will resync.
      }
    }
  }, [
    activeWorktreeId,
    apiFetch,
    attachmentSessionId,
    choicesKey,
    commandIndex,
    llmProvider,
    messageIndex,
    setChoiceSelections,
    setCommandPanelOpen,
    setMessages,
    setToolResultPanelOpen,
    setToolbarExportOpen,
    setWorktrees,
    lastNotifiedIdRef,
  ]);

  return { handleClearChat };
}
