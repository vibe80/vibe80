import { useCallback, useEffect, useRef, useState } from "react";

export default function useRepoBranchesModels({
  apiFetch,
  attachmentSessionId,
  llmProvider,
  loadRepoLastCommit,
  processing,
  setBranchMenuOpen,
  socketRef,
  t,
}) {
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [providerModelState, setProviderModelState] = useState({});
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState("");
  const initialBranchRef = useRef("");

  const loadBranches = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    setBranchLoading(true);
    setBranchError("");
    try {
      const response = await apiFetch(
        `/api/v1/branches?session=${encodeURIComponent(attachmentSessionId)}`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t("Unable to load branches."));
      }
      setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      setCurrentBranch(payload.current || "");
      if (!initialBranchRef.current && payload.current) {
        initialBranchRef.current = payload.current;
        setDefaultBranch(payload.current);
      }
    } catch (error) {
      setBranchError(error.message || t("Unable to load branches."));
    } finally {
      setBranchLoading(false);
    }
  }, [attachmentSessionId, apiFetch, t]);

  const loadProviderModels = useCallback(
    async (provider) => {
      if (!attachmentSessionId || !provider) {
        return;
      }
      setProviderModelState((current) => ({
        ...current,
        [provider]: {
          ...(current?.[provider] || {}),
          loading: true,
          error: "",
        },
      }));
      try {
        const response = await apiFetch(
          `/api/v1/models?session=${encodeURIComponent(
            attachmentSessionId
          )}&provider=${encodeURIComponent(provider)}`
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || t("Unable to load models."));
        }
        setProviderModelState((current) => ({
          ...current,
          [provider]: {
            models: Array.isArray(payload.models) ? payload.models : [],
            loading: false,
            error: "",
          },
        }));
      } catch (error) {
        setProviderModelState((current) => ({
          ...current,
          [provider]: {
            ...(current?.[provider] || {}),
            loading: false,
            error: error.message || t("Unable to load models."),
          },
        }));
      }
    },
    [attachmentSessionId, apiFetch, t]
  );

  useEffect(() => {
    if (!attachmentSessionId) {
      setBranches([]);
      setCurrentBranch("");
      setDefaultBranch("");
      setBranchError("");
      initialBranchRef.current = "";
      setProviderModelState({});
      return;
    }
    initialBranchRef.current = "";
    setDefaultBranch("");
    setProviderModelState({});
    loadBranches();
  }, [attachmentSessionId, loadBranches]);

  useEffect(() => {
    if (!attachmentSessionId) {
      return;
    }
    void loadRepoLastCommit?.();
  }, [attachmentSessionId, currentBranch, loadRepoLastCommit]);

  const requestModelList = useCallback(() => {
    if (!socketRef.current || llmProvider !== "codex") {
      return;
    }
    setModelLoading(true);
    setModelError("");
    socketRef.current.send(JSON.stringify({ type: "model_list" }));
  }, [llmProvider, socketRef]);

  const handleModelChange = useCallback(
    (event) => {
      const value = event.target.value;
      setSelectedModel(value);
      if (!socketRef.current) {
        return;
      }
      setModelLoading(true);
      setModelError("");
      socketRef.current.send(
        JSON.stringify({
          type: "model_set",
          model: value,
          reasoningEffort: selectedReasoningEffort || null,
        })
      );
    },
    [selectedReasoningEffort, socketRef]
  );

  const handleReasoningEffortChange = useCallback(
    (event) => {
      const value = event.target.value;
      setSelectedReasoningEffort(value);
      if (!socketRef.current) {
        return;
      }
      setModelLoading(true);
      setModelError("");
      socketRef.current.send(
        JSON.stringify({
          type: "model_set",
          model: selectedModel || null,
          reasoningEffort: value || null,
        })
      );
    },
    [selectedModel, socketRef]
  );

  const handleBranchSelect = useCallback(
    async (branch) => {
      if (!attachmentSessionId || processing) {
        return;
      }
      setBranchError(t("Branch switching is no longer supported."));
      if (setBranchMenuOpen) {
        setBranchMenuOpen(false);
      }
    },
    [
      attachmentSessionId,
      processing,
      setBranchMenuOpen,
      t,
    ]
  );

  return {
    branches,
    branchError,
    branchLoading,
    currentBranch,
    defaultBranch,
    handleBranchSelect,
    handleModelChange,
    handleReasoningEffortChange,
    loadBranches,
    loadProviderModels,
    modelError,
    modelLoading,
    models,
    providerModelState,
    requestModelList,
    selectedModel,
    selectedReasoningEffort,
    setBranches,
    setCurrentBranch,
    setDefaultBranch,
    setModelError,
    setModelLoading,
    setModels,
    setProviderModelState,
    setSelectedModel,
    setSelectedReasoningEffort,
  };
}
