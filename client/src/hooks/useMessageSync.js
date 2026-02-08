import { useCallback } from "react";

export default function useMessageSync({ socketRef, messagesRef }) {
  const requestMessageSync = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const lastSeenMessageId = (() => {
      if (!Array.isArray(messagesRef.current)) {
        return null;
      }
      for (let i = messagesRef.current.length - 1; i >= 0; i -= 1) {
        if (messagesRef.current[i]?.id) {
          return messagesRef.current[i].id;
        }
      }
      return null;
    })();
    socket.send(
      JSON.stringify({
        type: "worktree_messages_sync",
        worktreeId: "main",
        lastSeenMessageId,
      })
    );
  }, [messagesRef, socketRef]);

  return { requestMessageSync };
}
