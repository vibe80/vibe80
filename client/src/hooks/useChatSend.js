import { useCallback } from "react";

export default function useChatSend({
  input,
  setInput,
  setMessages,
  setDraftAttachments,
  socketRef,
  connected,
  normalizeAttachments,
  draftAttachments,
  setWorktrees,
  handleSendMessageRef,
  ensureNotificationPermission,
}) {
  const sendMessage = useCallback(
    (textOverride, attachmentsOverride) => {
      const rawText = (textOverride ?? input).trim();
      if (!rawText || !socketRef.current || !connected) {
        return;
      }

      void ensureNotificationPermission?.();
      const resolvedAttachments = normalizeAttachments(
        attachmentsOverride ?? draftAttachments
      );
      const selectedPaths = resolvedAttachments
        .map((item) => item?.path)
        .filter(Boolean);
      const suffix =
        selectedPaths.length > 0
          ? `;; attachments: ${JSON.stringify(selectedPaths)}`
          : "";
      const displayText = rawText;
      const text = `${displayText}${suffix}`;
      setMessages((current) => [
        ...current,
        {
          id: `user-${Date.now()}`,
          role: "user",
          text: displayText,
          attachments: resolvedAttachments,
        },
      ]);
      socketRef.current.send(
        JSON.stringify({
          type: "user_message",
          text,
          displayText,
          attachments: resolvedAttachments,
        })
      );
      setInput("");
      setDraftAttachments([]);
    },
    [
      connected,
      draftAttachments,
      input,
      normalizeAttachments,
      setDraftAttachments,
      setInput,
      setMessages,
      socketRef,
    ]
  );

  const sendCommitMessage = useCallback(
    (text) => {
      if (!handleSendMessageRef.current) {
        return;
      }
      handleSendMessageRef.current(text, []);
    },
    [handleSendMessageRef]
  );

  const sendWorktreeMessage = useCallback(
    (worktreeId, textOverride, attachmentsOverride) => {
      const rawText = (textOverride ?? input).trim();
      if (!rawText || !socketRef.current || !connected || !worktreeId) return;

      const resolvedAttachments = normalizeAttachments(
        attachmentsOverride ?? draftAttachments
      );
      const selectedPaths = resolvedAttachments
        .map((item) => item?.path)
        .filter(Boolean);
      const suffix =
        selectedPaths.length > 0
          ? `;; attachments: ${JSON.stringify(selectedPaths)}`
          : "";
      const displayText = rawText;
      const text = `${displayText}${suffix}`;

      setWorktrees((current) => {
        const next = new Map(current);
        const wt = next.get(worktreeId);
        if (wt) {
          const messages = [
            ...wt.messages,
            {
              id: `user-${Date.now()}`,
              role: "user",
              text: displayText,
              attachments: resolvedAttachments,
            },
          ];
          next.set(worktreeId, { ...wt, messages });
        }
        return next;
      });

      socketRef.current.send(
        JSON.stringify({
          type: "worktree_send_message",
          worktreeId,
          text,
          displayText,
          attachments: resolvedAttachments,
        })
      );
      setInput("");
      setDraftAttachments([]);
    },
    [
      connected,
      draftAttachments,
      input,
      normalizeAttachments,
      setDraftAttachments,
      setInput,
      setWorktrees,
      socketRef,
    ]
  );

  return { sendMessage, sendCommitMessage, sendWorktreeMessage };
}
