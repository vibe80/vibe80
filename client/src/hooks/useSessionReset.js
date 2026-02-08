import { useCallback } from "react";

export default function useSessionReset({
  setAttachmentSession,
  setRepoUrl,
  setRepoInput,
  setRepoAuth,
  setSessionRequested,
  setAttachmentsError,
  setAttachmentsLoading,
  setMessages,
  setRepoDiff,
  setRpcLogs,
  setRpcLogsEnabled,
  setRepoLastCommit,
  setWorktreeLastCommitById,
  setCurrentTurnId,
  setActivity,
}) {
  const handleLeaveSession = useCallback(() => {
    setAttachmentSession(null);
    setRepoUrl("");
    setRepoInput("");
    setRepoAuth(null);
    setSessionRequested(false);
    setAttachmentsError("");
    setAttachmentsLoading(false);
    setMessages([]);
    setRepoDiff({ status: "", diff: "" });
    setRpcLogs([]);
    setRpcLogsEnabled(true);
    setRepoLastCommit(null);
    setWorktreeLastCommitById(new Map());
    setCurrentTurnId(null);
    setActivity("");
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    window.history.replaceState({}, "", url);
  }, [
    setActivity,
    setAttachmentSession,
    setAttachmentsError,
    setAttachmentsLoading,
    setCurrentTurnId,
    setMessages,
    setRepoAuth,
    setRepoDiff,
    setRepoInput,
    setRepoLastCommit,
    setRepoUrl,
    setRpcLogs,
    setRpcLogsEnabled,
    setSessionRequested,
    setWorktreeLastCommitById,
  ]);

  return { handleLeaveSession };
}
