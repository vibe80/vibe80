import { useState, useRef, useEffect, useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faCircle,
  faCircleHalfStroke,
  faCircleNotch,
  faPlus,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useI18n } from "../i18n.jsx";
import "./WorktreeTabs.css";

const STATUS_ICONS = {
  creating: faCircleNotch,
  ready: faCircle,
  processing: faCircleHalfStroke,
  stopped: faCircle,
  completed: faCheck,
  error: faXmark,
};

const STATUS_COLORS = {
  creating: "#9ca3af",
  ready: "#10b981",
  processing: "#f59e0b",
  stopped: "#ef4444",
  completed: "#3b82f6",
  error: "#ef4444",
};

export default function WorktreeTabs({
  worktrees,
  activeWorktreeId,
  onSelect,
  onCreate,
  onClose,
  onRename,
  provider,
  providers,
  branches,
  defaultBranch,
  branchLoading,
  branchError,
  defaultInternetAccess,
  defaultDenyGitCredentialsAccess,
  onRefreshBranches,
  providerModelState,
  onRequestProviderModels,
  disabled,
  isMobile,
}) {
  const { t } = useI18n();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const [startingBranch, setStartingBranch] = useState("");
  const providerOptions = useMemo(
    () =>
      Array.isArray(providers) && providers.length
        ? providers
        : [provider || "codex"],
    [providers, provider]
  );
  const [newProvider, setNewProvider] = useState(providerOptions[0]);
  const [newContext, setNewContext] = useState("new");
  const [newSourceWorktree, setNewSourceWorktree] = useState("main");
  const [newModel, setNewModel] = useState("");
  const [newReasoningEffort, setNewReasoningEffort] = useState("");
  const [newInternetAccess, setNewInternetAccess] = useState(
    Boolean(defaultInternetAccess)
  );
  const [newDenyGitCredentialsAccess, setNewDenyGitCredentialsAccess] = useState(
    typeof defaultDenyGitCredentialsAccess === "boolean"
      ? defaultDenyGitCredentialsAccess
      : true
  );
  const statusLabels = useMemo(
    () => ({
      creating: t("Creating"),
      ready: t("Ready"),
      processing: t("In progress"),
      stopped: t("Stopped"),
      completed: t("Completed"),
      error: t("Error"),
    }),
    [t]
  );
  const editInputRef = useRef(null);
  const createInputRef = useRef(null);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (createDialogOpen && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [createDialogOpen]);

  useEffect(() => {
    if (!createDialogOpen) return;
    setNewInternetAccess(Boolean(defaultInternetAccess));
    setNewDenyGitCredentialsAccess(
      typeof defaultDenyGitCredentialsAccess === "boolean"
        ? defaultDenyGitCredentialsAccess
        : true
    );
    if (!startingBranch) {
      setStartingBranch(defaultBranch || "");
    }
    if (!branches?.length && onRefreshBranches && !branchLoading) {
      onRefreshBranches();
    }
    if (newContext === "new" && onRequestProviderModels) {
      const providerState = providerModelState?.[newProvider] || {};
      if (!providerState.loading && !(providerState.models || []).length) {
        onRequestProviderModels(newProvider);
      }
    }
  }, [
    createDialogOpen,
    startingBranch,
    defaultBranch,
    branches,
    defaultInternetAccess,
    defaultDenyGitCredentialsAccess,
    onRefreshBranches,
    branchLoading,
    newContext,
    newProvider,
    onRequestProviderModels,
  ]);

  useEffect(() => {
    if (!providerOptions.includes(newProvider)) {
      setNewProvider(providerOptions[0]);
    }
  }, [providerOptions, newProvider]);

  useEffect(() => {
    if (newContext === "new" && onRequestProviderModels) {
      const providerState = providerModelState?.[newProvider] || {};
      if (!providerState.loading && !(providerState.models || []).length) {
        onRequestProviderModels(newProvider);
      }
    }
    if (newContext === "new") {
      setNewModel("");
      setNewReasoningEffort("");
    }
  }, [newContext, newProvider, onRequestProviderModels]);

  const providerState = providerModelState?.[newProvider] || {};
  const availableModels = Array.isArray(providerState.models) ? providerState.models : [];
  const branchOptions = useMemo(
    () =>
      Array.isArray(branches)
        ? branches.map((branch) => branch.trim()).filter(Boolean)
        : [],
    [branches]
  );
  const effectiveBranch = (startingBranch || defaultBranch || "").trim();
  const isBranchValid =
    Boolean(effectiveBranch) && branchOptions.includes(effectiveBranch);
  const defaultModel = useMemo(
    () => availableModels.find((model) => model.isDefault) || null,
    [availableModels]
  );
  const selectedModelDetails = useMemo(
    () => availableModels.find((model) => model.model === newModel) || null,
    [availableModels, newModel]
  );
  const showReasoningField =
    newContext === "new" &&
    newProvider === "codex" &&
    (selectedModelDetails?.supportedReasoningEfforts?.length || 0) > 0;

  useEffect(() => {
    if (newContext !== "new") {
      return;
    }
    if (!newModel && defaultModel?.model) {
      setNewModel(defaultModel.model);
    }
    if (newProvider === "codex" && !newReasoningEffort && defaultModel?.defaultReasoningEffort) {
      setNewReasoningEffort(defaultModel.defaultReasoningEffort);
    }
    if (newProvider !== "codex" && newReasoningEffort) {
      setNewReasoningEffort("");
    }
  }, [newContext, newProvider, newModel, newReasoningEffort, defaultModel]);

  useEffect(() => {
    if (newContext !== "new" || newProvider !== "codex") {
      if (newReasoningEffort) {
        setNewReasoningEffort("");
      }
      return;
    }
    if (!selectedModelDetails?.supportedReasoningEfforts?.length) {
      if (newReasoningEffort) {
        setNewReasoningEffort("");
      }
      return;
    }
    const valid = selectedModelDetails.supportedReasoningEfforts.some(
      (effort) => effort.reasoningEffort === newReasoningEffort
    );
    if (!valid && newReasoningEffort) {
      setNewReasoningEffort("");
    }
  }, [newContext, newProvider, selectedModelDetails, newReasoningEffort]);

  const handleCreate = () => {
    if (onCreate) {
      onCreate({
        context: newContext,
        name: newName.trim() || null,
        provider: newProvider,
        sourceWorktree: newContext === "fork" ? newSourceWorktree : null,
        startingBranch: effectiveBranch || null,
        model: newContext === "new" ? newModel || null : null,
        reasoningEffort: newContext === "new" ? newReasoningEffort || null : null,
        internetAccess: newInternetAccess,
        denyGitCredentialsAccess: newDenyGitCredentialsAccess,
      });
    }
    setNewName("");
    setNewContext("new");
    setNewProvider(providerOptions[0]);
    setNewSourceWorktree("main");
    setStartingBranch(defaultBranch || "");
    setNewModel("");
    setNewReasoningEffort("");
    setNewInternetAccess(Boolean(defaultInternetAccess));
    setNewDenyGitCredentialsAccess(
      typeof defaultDenyGitCredentialsAccess === "boolean"
        ? defaultDenyGitCredentialsAccess
        : true
    );
    setCreateDialogOpen(false);
  };

  const handleStartEdit = (wt) => {
    setEditingId(wt.id);
    setEditingName(wt.name);
  };

  const handleFinishEdit = () => {
    if (editingId && editingName.trim() && onRename) {
      onRename(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName("");
  };

  const handleKeyDownEdit = (e) => {
    if (e.key === "Enter") {
      handleFinishEdit();
    } else if (e.key === "Escape") {
      setEditingId(null);
      setEditingName("");
    }
  };

  const handleKeyDownCreate = (e) => {
    if (e.key === "Enter") {
      handleCreate();
    } else if (e.key === "Escape") {
      setCreateDialogOpen(false);
    }
  };

  const worktreeList = (Array.isArray(worktrees)
    ? worktrees
    : Array.from(worktrees?.values?.() || [])
  ).slice().sort((a, b) => {
    if (a?.id === "main" && b?.id !== "main") return -1;
    if (b?.id === "main" && a?.id !== "main") return 1;
    const aTime = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bTime = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
    return aTime - bTime;
  });
  const sourceWorktreeOptions = worktreeList.map((wt) => ({
    id: wt.id,
    label: wt.id === "main" ? "main" : (wt.name || wt.branchName || wt.id),
    provider: wt.provider || (wt.id === "main" ? provider || null : null),
  }));
  const selectedSourceWorktree = sourceWorktreeOptions.find(
    (wt) => wt.id === newSourceWorktree
  );
  const showClaudeForkWarning =
    newContext === "fork" && selectedSourceWorktree?.provider === "claude";

  useEffect(() => {
    if (!sourceWorktreeOptions.length) {
      return;
    }
    const exists = sourceWorktreeOptions.some((wt) => wt.id === newSourceWorktree);
    if (!exists) {
      const fallback = sourceWorktreeOptions.find((wt) => wt.id === "main")?.id
        || sourceWorktreeOptions[0].id;
      setNewSourceWorktree(fallback);
    }
  }, [newSourceWorktree, sourceWorktreeOptions]);

  return (
    <div className="worktree-tabs-container">
      <div className="worktree-tabs">
        {isMobile ? (
          <div className="worktree-tabs-select">
            <select
              className="worktree-select"
              value={activeWorktreeId}
              onChange={(event) => !disabled && onSelect?.(event.target.value)}
              aria-label={t("Select a branch")}
              disabled={disabled}
            >
              {worktreeList.map((wt) => (
                <option key={wt.id} value={wt.id}>
                  {wt.name}
                </option>
              ))}
            </select>
            <button
              className="worktree-tab-add"
              onClick={() => setCreateDialogOpen(true)}
              disabled={disabled || worktreeList.length >= 10}
              title={t("New parallel branch")}
              aria-label={t("New parallel branch")}
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
          </div>
        ) : (
          <>
            {worktreeList.map((wt) => (
              <div
                key={wt.id}
                className={`worktree-tab ${activeWorktreeId === wt.id ? "active" : ""}`}
                onClick={() => !disabled && onSelect?.(wt.id)}
                style={{
                  "--tab-accent": wt.color || "#3b82f6",
                }}
              >
                <span
                  className={`worktree-status ${wt.status === "processing" ? "pulse" : ""}`}
                  style={{ color: STATUS_COLORS[wt.status] || STATUS_COLORS.ready }}
                  title={statusLabels[wt.status] || wt.status}
                >
                  <FontAwesomeIcon icon={STATUS_ICONS[wt.status] || STATUS_ICONS.ready} />
                </span>

                {editingId === wt.id && wt.id !== "main" ? (
                  <input
                    ref={editInputRef}
                    className="worktree-tab-edit"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={handleFinishEdit}
                    onKeyDown={handleKeyDownEdit}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="worktree-tab-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      // Don't allow renaming "main" tab
                      if (wt.id !== "main") {
                        handleStartEdit(wt);
                      }
                    }}
                    title={
                      wt.id === "main"
                        ? wt.name
                        : `${wt.name || wt.branchName} (${wt.branchName || "main"})`
                    }
                  >
                    {wt.id === "main" ? wt.name : (wt.name || wt.branchName)}
                  </span>
                )}
                {/* Don't show close button for "main" tab */}
                {wt.id !== "main" && (
                  <button
                    className="worktree-tab-close"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose?.(wt.id);
                    }}
                    title={t("Close")}
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                )}
              </div>
            ))}

            <button
              className="worktree-tab-add"
              onClick={() => setCreateDialogOpen(true)}
              disabled={disabled || worktreeList.length >= 10}
              title={t("New parallel branch")}
            >
              <FontAwesomeIcon icon={faPlus} />
            </button>
          </>
        )}
      </div>

      {createDialogOpen && (
        <div className="worktree-create-dialog-overlay" onClick={() => setCreateDialogOpen(false)}>
          <div className="worktree-create-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>{t("New parallel branch")}</h3>
            <div className="worktree-create-grid">
              <div className="worktree-create-field">
                <label>{t("Name (optional)")}</label>
                <input
                  ref={createInputRef}
                  type="text"
                  placeholder={t("e.g. refactor-auth")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={handleKeyDownCreate}
                />
              </div>
              <div className="worktree-create-field">
                <label>{t("Source branch")}</label>
                <input
                  type="text"
                  list="worktree-branch-options"
                  placeholder={defaultBranch || "main"}
                  value={startingBranch}
                  onChange={(e) => setStartingBranch(e.target.value)}
                  onKeyDown={handleKeyDownCreate}
                />
                <datalist id="worktree-branch-options">
                  {branchOptions.map((branch) => (
                    <option key={branch} value={branch} />
                  ))}
                </datalist>
                {!isBranchValid && (
                  <div className="worktree-field-error">
                    {t("Select a valid remote branch.")}
                  </div>
                )}
                {branchError && <div className="worktree-field-error">{branchError}</div>}
              </div>
              <div className="worktree-create-field">
                <label>{t("Context")}</label>
                <select
                  value={newContext}
                  onChange={(e) => setNewContext(e.target.value === "fork" ? "fork" : "new")}
                >
                  <option value="new">{t("New")}</option>
                  <option value="fork">{t("Fork")}</option>
                </select>
              </div>
              {newContext === "new" ? (
                <div className="worktree-create-field">
                  <label>{t("Provider")}</label>
                  <select
                    value={newProvider}
                    onChange={(e) => setNewProvider(e.target.value)}
                    disabled={providerOptions.length <= 1}
                  >
                    {providerOptions.includes("codex") && (
                      <option value="codex">{t("Codex (OpenAI)")}</option>
                    )}
                    {providerOptions.includes("claude") && (
                      <option value="claude">{t("Claude")}</option>
                    )}
                  </select>
                </div>
              ) : (
                <div className="worktree-create-field">
                  <label>{t("Source worktree")}</label>
                  <select
                    value={newSourceWorktree}
                    onChange={(e) => setNewSourceWorktree(e.target.value || "main")}
                  >
                    {sourceWorktreeOptions.map((wt) => (
                      <option key={wt.id} value={wt.id}>
                        {wt.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {showClaudeForkWarning && (
                <div className="worktree-create-field is-full">
                  <div className="worktree-warning-bubble">
                    {t(
                      "Claude Code does not natively support forked sessions with directory changes. This feature is experimental."
                    )}
                  </div>
                </div>
              )}
              {newContext === "new" && (newProvider === "codex" || newProvider === "claude") && (
                <>
                  <div
                    className={`worktree-create-field ${
                      showReasoningField ? "" : "is-full"
                    }`}
                  >
                    <label>{t("Model")}</label>
                    <select
                      value={newModel}
                      onChange={(e) => setNewModel(e.target.value)}
                      disabled={providerState.loading || availableModels.length === 0}
                    >
                      <option value="">{t("Default model")}</option>
                      {availableModels.map((model) => (
                        <option key={model.id} value={model.model}>
                          {model.displayName || model.model}
                        </option>
                      ))}
                    </select>
                    {providerState.error && (
                      <div className="worktree-field-error">{providerState.error}</div>
                    )}
                  </div>
                  {showReasoningField && (
                    <div className="worktree-create-field">
                      <label>{t("Reasoning")}</label>
                      <select
                        value={newReasoningEffort}
                        onChange={(e) => setNewReasoningEffort(e.target.value)}
                        disabled={providerState.loading || !selectedModelDetails}
                      >
                        <option value="">{t("Default reasoning")}</option>
                        {(selectedModelDetails?.supportedReasoningEfforts || []).map(
                          (effort) => (
                            <option
                              key={effort.reasoningEffort}
                              value={effort.reasoningEffort}
                            >
                              {effort.reasoningEffort}
                            </option>
                          )
                        )}
                      </select>
                    </div>
                  )}
                </>
              )}
              <div className="worktree-create-field worktree-toggle-field">
                <label className="worktree-toggle">
                  <input
                    type="checkbox"
                    checked={newInternetAccess}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setNewInternetAccess(checked);
                      if (!checked) {
                        setNewDenyGitCredentialsAccess(false);
                      }
                    }}
                  />
                  <span>{t("Internet access")}</span>
                </label>
              </div>
              {newInternetAccess && (
                <div className="worktree-create-field worktree-toggle-field">
                  <label className="worktree-toggle">
                    <input
                      type="checkbox"
                      checked={newDenyGitCredentialsAccess}
                      onChange={(e) => setNewDenyGitCredentialsAccess(e.target.checked)}
                    />
                    <span>{t("Deny git credentials access")}</span>
                  </label>
                </div>
              )}
            </div>
            <div className="worktree-create-actions">
              <button
                className="worktree-btn-cancel"
                onClick={() => setCreateDialogOpen(false)}
              >
                {t("Cancel")}
              </button>
              <button
                className="worktree-btn-create"
                onClick={handleCreate}
                disabled={!isBranchValid || (newContext === "fork" && !newSourceWorktree)}
              >
                {t("Create")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
