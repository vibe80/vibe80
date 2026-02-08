import { useCallback, useEffect } from "react";

export default function usePaneNavigation({
  activePane,
  activeWorktreeId,
  debugMode,
  rpcLogsEnabled,
  terminalEnabled,
  setPaneByTab,
  setToolbarExportOpen,
  lastPaneByTabRef,
}) {
  const handleViewSelect = useCallback(
    (nextPane) => {
      if ((!debugMode || !rpcLogsEnabled) && nextPane === "logs") {
        return;
      }
      if (!terminalEnabled && nextPane === "terminal") {
        return;
      }
      const key = activeWorktreeId || "main";
      setPaneByTab((current) => ({
        ...current,
        [key]: nextPane,
      }));
      setToolbarExportOpen(false);
    },
    [
      activeWorktreeId,
      debugMode,
      rpcLogsEnabled,
      setPaneByTab,
      setToolbarExportOpen,
      terminalEnabled,
    ]
  );

  const handleOpenSettings = useCallback(() => {
    if (activePane !== "settings") {
      const key = activeWorktreeId || "main";
      lastPaneByTabRef.current.set(key, activePane);
    }
    handleViewSelect("settings");
  }, [activePane, activeWorktreeId, handleViewSelect, lastPaneByTabRef]);

  const handleSettingsBack = useCallback(() => {
    const key = activeWorktreeId || "main";
    const previousPane = lastPaneByTabRef.current.get(key);
    const fallbackPane =
      previousPane && previousPane !== "settings" ? previousPane : "chat";
    handleViewSelect(fallbackPane);
  }, [activeWorktreeId, handleViewSelect, lastPaneByTabRef]);

  useEffect(() => {
    if ((!debugMode || !rpcLogsEnabled) && activePane === "logs") {
      handleViewSelect("chat");
    }
  }, [activePane, debugMode, handleViewSelect, rpcLogsEnabled]);

  useEffect(() => {
    if (!terminalEnabled && activePane === "terminal") {
      handleViewSelect("chat");
    }
  }, [activePane, handleViewSelect, terminalEnabled]);

  return { handleViewSelect, handleOpenSettings, handleSettingsBack };
}
