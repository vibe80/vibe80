import { useCallback, useMemo } from "react";

export default function useRpcLogView({
  rpcLogs,
  activeWorktreeId,
  locale,
  logFilterByTab,
  setLogFilterByTab,
}) {
  const logFilter = logFilterByTab[activeWorktreeId] || "all";
  const setLogFilter = useCallback(
    (value) => {
      const key = activeWorktreeId || "main";
      setLogFilterByTab((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [activeWorktreeId]
  );
  const scopedRpcLogs = useMemo(() => {
    if (activeWorktreeId && activeWorktreeId !== "main") {
      return (rpcLogs || []).filter(
        (entry) => entry?.worktreeId === activeWorktreeId
      );
    }
    return (rpcLogs || []).filter((entry) => !entry?.worktreeId);
  }, [rpcLogs, activeWorktreeId]);
  const formattedRpcLogs = useMemo(
    () =>
      scopedRpcLogs.map((entry) => ({
        ...entry,
        timeLabel: entry?.timestamp
          ? new Date(entry.timestamp).toLocaleTimeString(locale)
          : "",
      })),
    [scopedRpcLogs, locale]
  );
  const filteredRpcLogs = useMemo(() => {
    if (logFilter === "stdin") {
      return formattedRpcLogs.filter((entry) => entry.direction === "stdin");
    }
    if (logFilter === "stdout") {
      return formattedRpcLogs.filter((entry) => entry.direction === "stdout");
    }
    return formattedRpcLogs;
  }, [formattedRpcLogs, logFilter]);

  return {
    logFilterByTab,
    setLogFilterByTab,
    logFilter,
    setLogFilter,
    formattedRpcLogs,
    filteredRpcLogs,
  };
}
