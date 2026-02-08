import { useCallback } from "react";

export default function useRpcLogActions({
  activeWorktreeId,
  setRpcLogs,
}) {
  const handleClearRpcLogs = useCallback(() => {
    setRpcLogs((current) => {
      if (activeWorktreeId && activeWorktreeId !== "main") {
        return current.filter(
          (entry) => entry?.worktreeId !== activeWorktreeId
        );
      }
      return current.filter((entry) => Boolean(entry?.worktreeId));
    });
  }, [activeWorktreeId, setRpcLogs]);

  return { handleClearRpcLogs };
}
