import { useCallback } from "react";

export default function useSessionResync({
  attachmentSessionId,
  apiFetch,
  llmProvider,
  setLlmProvider,
  setSelectedProviders,
  setOpenAiReady,
  setClaudeReady,
  setRepoDiff,
  setRpcLogsEnabled,
  setRpcLogs,
  setTerminalEnabled,
  loadMainWorktreeSnapshot,
}) {
  const resyncSession = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    try {
      const response = await apiFetch(
        `/api/v1/sessions/${encodeURIComponent(attachmentSessionId)}`
      );
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data?.defaultProvider && data.defaultProvider !== llmProvider) {
        setLlmProvider(data.defaultProvider);
      }
      if (Array.isArray(data?.providers) && data.providers.length) {
        const filtered = data.providers.filter(
          (entry) => entry === "codex" || entry === "claude"
        );
        if (filtered.length) {
          setSelectedProviders(filtered);
          setOpenAiReady(filtered.includes("codex"));
          setClaudeReady(filtered.includes("claude"));
        }
      }
      if (data?.repoDiff) {
        setRepoDiff(data.repoDiff);
      }
      if (typeof data?.rpcLogsEnabled === "boolean") {
        setRpcLogsEnabled(data.rpcLogsEnabled);
        if (!data.rpcLogsEnabled) {
          setRpcLogs([]);
        }
      }
      if (Array.isArray(data?.rpcLogs) && data?.rpcLogsEnabled !== false) {
        setRpcLogs(data.rpcLogs);
      }
      if (typeof data?.terminalEnabled === "boolean") {
        setTerminalEnabled(data.terminalEnabled);
      }
      void loadMainWorktreeSnapshot();
    } catch (error) {
      // Ignore resync failures; reconnect loop will retry.
    }
  }, [
    attachmentSessionId,
    apiFetch,
    llmProvider,
    loadMainWorktreeSnapshot,
    setClaudeReady,
    setLlmProvider,
    setOpenAiReady,
    setRepoDiff,
    setRpcLogs,
    setRpcLogsEnabled,
    setSelectedProviders,
    setTerminalEnabled,
  ]);

  return { resyncSession };
}
