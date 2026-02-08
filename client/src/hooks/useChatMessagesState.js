import { useCallback } from "react";

export default function useChatMessagesState({
  normalizeAttachments,
  messageIndex,
  commandIndex,
  messagesRef,
  setMessages,
  setCommandPanelOpen,
  setToolResultPanelOpen,
}) {
  const applyMessages = useCallback(
    (items = []) => {
      const normalized = items.map((item, index) => ({
        id: item.id || `history-${index}`,
        role: item.role,
        text: item.text,
        toolResult: item.toolResult,
        attachments: normalizeAttachments(item.attachments || []),
      }));
      messageIndex.clear();
      commandIndex.clear();
      normalized.forEach((item, index) => {
        if (item.role === "assistant") {
          messageIndex.set(item.id, index);
        }
      });
      setMessages(normalized);
      setCommandPanelOpen({});
      setToolResultPanelOpen({});
    },
    [
      commandIndex,
      messageIndex,
      normalizeAttachments,
      setCommandPanelOpen,
      setMessages,
      setToolResultPanelOpen,
    ]
  );

  const mergeAndApplyMessages = useCallback(
    (incoming = []) => {
      if (!Array.isArray(incoming) || incoming.length === 0) {
        return;
      }
      const current = Array.isArray(messagesRef.current)
        ? messagesRef.current
        : [];
      const seen = new Set(current.map((item) => item?.id).filter(Boolean));
      const merged = [...current];
      for (const item of incoming) {
        const id = item?.id;
        if (id && seen.has(id)) {
          continue;
        }
        if (id) {
          seen.add(id);
        }
        merged.push(item);
      }
      applyMessages(merged);
    },
    [applyMessages, messagesRef]
  );

  return { applyMessages, mergeAndApplyMessages };
}
