import { useCallback } from "react";

export default function useProviderSelection({
  attachmentSessionId,
  socketRef,
  availableProviders,
  llmProvider,
  providerSwitching,
  processing,
  setProviderSwitching,
  setStatus,
  setSelectedProviders,
  setLlmProvider,
  t,
}) {
  const handleProviderSwitch = useCallback(
    (newProvider) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!availableProviders.includes(newProvider)) {
        return;
      }
      if (newProvider === llmProvider || providerSwitching || processing) {
        return;
      }
      setProviderSwitching(true);
      setStatus(t("Switching to {{provider}}...", { provider: newProvider }));
      socketRef.current.send(
        JSON.stringify({ type: "switch_provider", provider: newProvider })
      );
    },
    [
      availableProviders,
      llmProvider,
      processing,
      providerSwitching,
      setProviderSwitching,
      setStatus,
      socketRef,
      t,
    ]
  );

  const toggleProviderSelection = useCallback(
    (provider) => {
      if (attachmentSessionId) {
        return;
      }
      setSelectedProviders((current) => {
        const exists = current.includes(provider);
        const next = exists
          ? current.filter((item) => item !== provider)
          : [...current, provider];
        if (!exists) {
          setLlmProvider(provider);
        } else if (provider === llmProvider) {
          const fallback = next[0] || provider;
          if (fallback !== llmProvider) {
            setLlmProvider(fallback);
          }
        }
        return next;
      });
    },
    [attachmentSessionId, llmProvider, setLlmProvider, setSelectedProviders]
  );

  return { handleProviderSwitch, toggleProviderSelection };
}
