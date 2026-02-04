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

const STATUS_ICONS = {
  creating: faCircleNotch,
  ready: faCircle,
  processing: faCircleHalfStroke,
  completed: faCheck,
  error: faXmark,
};

const STATUS_COLORS = {
  creating: "#9ca3af",
  ready: "#10b981",
  processing: "#f59e0b",
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
  defaultShareGitCredentials,
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
  const [newModel, setNewModel] = useState("");
  const [newReasoningEffort, setNewReasoningEffort] = useState("");
  const [newInternetAccess, setNewInternetAccess] = useState(
    Boolean(defaultInternetAccess)
  );
  const [newShareGitCredentials, setNewShareGitCredentials] = useState(
    Boolean(defaultShareGitCredentials)
  );
  const statusLabels = useMemo(
    () => ({
      creating: t("Creating"),
      ready: t("Ready"),
      processing: t("In progress"),
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
    setNewShareGitCredentials(Boolean(defaultShareGitCredentials));
    if (!startingBranch) {
      setStartingBranch(defaultBranch || "");
    }
    if (!branches?.length && onRefreshBranches && !branchLoading) {
      onRefreshBranches();
    }
    if (onRequestProviderModels) {
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
    defaultShareGitCredentials,
    onRefreshBranches,
    branchLoading,
    newProvider,
    onRequestProviderModels,
  ]);

  useEffect(() => {
    if (!providerOptions.includes(newProvider)) {
      setNewProvider(providerOptions[0]);
    }
  }, [providerOptions, newProvider]);

  useEffect(() => {
    if (onRequestProviderModels) {
      const providerState = providerModelState?.[newProvider] || {};
      if (!providerState.loading && !(providerState.models || []).length) {
        onRequestProviderModels(newProvider);
      }
    }
    setNewModel("");
    setNewReasoningEffort("");
  }, [newProvider, onRequestProviderModels]);

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
    newProvider === "codex" &&
    (selectedModelDetails?.supportedReasoningEfforts?.length || 0) > 0;

  useEffect(() => {
    if (!newModel && defaultModel?.model) {
      setNewModel(defaultModel.model);
    }
    if (newProvider === "codex" && !newReasoningEffort && defaultModel?.defaultReasoningEffort) {
      setNewReasoningEffort(defaultModel.defaultReasoningEffort);
    }
    if (newProvider !== "codex" && newReasoningEffort) {
      setNewReasoningEffort("");
    }
  }, [newProvider, newModel, newReasoningEffort, defaultModel]);

  useEffect(() => {
    if (newProvider !== "codex") {
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
  }, [selectedModelDetails, newReasoningEffort]);

  const handleCreate = () => {
    if (onCreate) {
      onCreate({
        name: newName.trim() || null,
        provider: newProvider,
        startingBranch: effectiveBranch || null,
        model: newModel || null,
        reasoningEffort: newReasoningEffort || null,
        internetAccess: newInternetAccess,
        shareGitCredentials: newShareGitCredentials,
      });
    }
    setNewName("");
    setNewProvider(providerOptions[0]);
    setStartingBranch(defaultBranch || "");
    setNewModel("");
    setNewReasoningEffort("");
    setNewInternetAccess(Boolean(defaultInternetAccess));
    setNewShareGitCredentials(Boolean(defaultShareGitCredentials));
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

  const worktreeList = Array.isArray(worktrees)
    ? worktrees
    : Array.from(worktrees?.values?.() || []);

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
              disabled={disabled || worktreeList.length >= 5}
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
              disabled={disabled || worktreeList.length >= 5}
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
              <div className="worktree-create-field is-full">
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
              {(newProvider === "codex" || newProvider === "claude") && (
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
                    onChange={(e) => setNewInternetAccess(e.target.checked)}
                  />
                  <span>{t("Internet access")}</span>
                </label>
              </div>
              <div className="worktree-create-field worktree-toggle-field">
                <label className="worktree-toggle">
                  <input
                    type="checkbox"
                    checked={newShareGitCredentials}
                    onChange={(e) => setNewShareGitCredentials(e.target.checked)}
                  />
                  <span>{t("Share git credentials")}</span>
                </label>
              </div>
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
                disabled={!isBranchValid}
              >
                {t("Create")}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .worktree-tabs-container {
          width: 100%;
          min-width: 0;
        }

        .worktree-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 10px;
          background: rgba(20, 19, 17, 0.04);
          border-radius: 999px;
          border: 1px solid rgba(20, 19, 17, 0.1);
          overflow-x: auto;
          scrollbar-width: thin;
        }

        .worktree-tabs-select {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 8px;
          align-items: center;
          width: 100%;
        }

        .worktree-select {
          width: 100%;
          border: 1px solid rgba(20, 19, 17, 0.12);
          border-radius: 999px;
          padding: 6px 12px;
          background: var(--surface);
          color: var(--ink);
          font-size: 13px;
          font-weight: 600;
          outline: none;
        }

        .worktree-select:focus {
          border-color: rgba(238, 93, 59, 0.6);
          box-shadow: 0 0 0 3px rgba(238, 93, 59, 0.12);
        }

        .worktree-tab {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: rgba(255, 255, 255, 0.7);
          border: 1px solid rgba(20, 19, 17, 0.08);
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.15s ease;
          white-space: nowrap;
          max-width: 180px;
        }

        .worktree-tab:hover {
          background: rgba(255, 255, 255, 0.9);
          border-color: rgba(20, 19, 17, 0.15);
        }

        .worktree-tab.active {
          background: white;
          border-color: var(--tab-accent, #3b82f6);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .worktree-status {
          font-size: 10px;
          line-height: 1;
        }

        .worktree-status.pulse {
          animation: pulse 1.2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        .worktree-tab-name {
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 100px;
        }

        .worktree-tab-edit {
          border: 1px solid var(--tab-accent, #3b82f6);
          border-radius: 4px;
          padding: 2px 4px;
          font-size: 12px;
          width: 80px;
          outline: none;
        }

        .worktree-tab-close {
          background: none;
          border: none;
          color: #9ca3af;
          cursor: pointer;
          font-size: 14px;
          line-height: 1;
          padding: 0 2px;
          margin-left: 2px;
        }

        .worktree-tab-close:hover {
          color: #ef4444;
        }

        .worktree-tab-add {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          background: rgba(255, 255, 255, 0.5);
          border: 1px dashed rgba(20, 19, 17, 0.2);
          border-radius: 8px;
          cursor: pointer;
          font-size: 18px;
          color: #9ca3af;
          transition: all 0.15s ease;
        }

        .worktree-tab-add:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.9);
          border-color: var(--accent, #ee5d3b);
          color: var(--accent, #ee5d3b);
        }

        .worktree-tab-add:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        :root[data-theme="dark"] .worktree-tabs {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.14);
        }

        :root[data-theme="dark"] .worktree-select {
          background: rgba(22, 24, 23, 0.9);
          border-color: rgba(255, 255, 255, 0.18);
          color: #e6edf3;
        }

        :root[data-theme="dark"] .worktree-tab {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.12);
          color: #e6edf3;
        }

        :root[data-theme="dark"] .worktree-tab:hover {
          background: rgba(255, 255, 255, 0.16);
          border-color: rgba(255, 255, 255, 0.22);
        }

        :root[data-theme="dark"] .worktree-tab.active {
          background: rgba(255, 255, 255, 0.22);
          border-color: var(--tab-accent, #3b82f6);
          box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
        }

        :root[data-theme="dark"] .worktree-tab-close {
          color: #c6cbd1;
        }

        :root[data-theme="dark"] .worktree-tab-add {
          background: rgba(255, 255, 255, 0.06);
          border-color: rgba(255, 255, 255, 0.22);
          color: #b7ada1;
        }

        :root[data-theme="dark"] .worktree-tab-add:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.16);
          border-color: var(--accent, #ee5d3b);
          color: var(--accent, #ee5d3b);
        }

        :root[data-theme="dark"] .worktree-create-dialog {
          background: var(--surface-elevated, #1f2321);
          color: var(--ink, #f2ede3);
          box-shadow: var(--shadow);
        }

        :root[data-theme="dark"] .worktree-create-dialog h3 {
          color: var(--ink, #f2ede3);
        }

        :root[data-theme="dark"] .worktree-create-field label {
          color: var(--ink-muted, #b7ada1);
        }

        :root[data-theme="dark"] .worktree-create-field input,
        :root[data-theme="dark"] .worktree-create-field select {
          background: var(--bg-strong, #171a18);
          border-color: var(--border-soft, rgba(255, 255, 255, 0.12));
          color: var(--ink, #f2ede3);
        }

        :root[data-theme="dark"] .worktree-create-field input::placeholder {
          color: rgba(242, 237, 227, 0.5);
        }

        :root[data-theme="dark"] .worktree-btn-refresh {
          background: var(--surface-ghost, rgba(20, 24, 22, 0.8));
          border-color: var(--border-soft, rgba(255, 255, 255, 0.12));
          color: var(--ink-muted, #b7ada1);
        }

        :root[data-theme="dark"] .worktree-btn-cancel {
          border-color: var(--border-soft, rgba(255, 255, 255, 0.12));
          color: var(--ink-muted, #b7ada1);
        }

        :root[data-theme="dark"] .worktree-btn-cancel:hover {
          background: rgba(255, 255, 255, 0.06);
        }

        :root[data-theme="dark"] .worktree-field-hint {
          color: rgba(242, 237, 227, 0.55);
        }

        .worktree-create-dialog-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }

        .worktree-create-dialog {
          background: white;
          border-radius: 16px;
          padding: 24px;
          width: min(400px, 90vw);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
        }

        .worktree-create-dialog h3 {
          margin: 0 0 16px;
          font-size: 18px;
        }

        .worktree-create-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .worktree-create-field {
          margin-bottom: 0;
        }

        .worktree-create-field label {
          display: block;
          font-size: 13px;
          color: #6b7280;
          margin-bottom: 6px;
        }

        .worktree-create-field .worktree-toggle {
          display: inline-flex;
          align-items: center;
          justify-content: flex-start;
          gap: 8px;
          font-size: 13px;
          color: inherit;
          margin-bottom: 6px;
          width: 100%;
        }

        .worktree-toggle span {
          line-height: 1;
          white-space: nowrap;
        }

        .worktree-toggle input {
          accent-color: var(--accent, #ee5d3b);
          width: auto;
          flex: 0 0 auto;
          margin: 0;
          margin-top: 0;
        }

        .worktree-create-field input,
        .worktree-create-field select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid rgba(20, 19, 17, 0.14);
          border-radius: 10px;
          font-size: 14px;
          outline: none;
        }

        .worktree-create-field input:focus,
        .worktree-create-field select:focus {
          border-color: var(--accent, #ee5d3b);
        }

        .worktree-branch-row {
          display: flex;
          gap: 8px;
          align-items: center;
        }

        .worktree-branch-row select,
        .worktree-branch-row input {
          flex: 1;
        }

        .worktree-create-field.is-full {
          grid-column: 1 / -1;
        }

        .worktree-toggle-field {
          align-self: start;
          grid-column: 1 / -1;
          display: flex;
          justify-content: flex-start;
        }

        .worktree-btn-refresh {
          border: 1px solid rgba(20, 19, 17, 0.14);
          border-radius: 10px;
          padding: 10px 12px;
          background: white;
          font-size: 13px;
          color: #6b7280;
          cursor: pointer;
        }

        .worktree-btn-refresh:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .worktree-field-hint {
          margin-top: 6px;
          font-size: 12px;
          color: #9ca3af;
        }

        .worktree-field-error {
          margin-top: 6px;
          font-size: 12px;
          color: #ef4444;
        }

        .worktree-create-actions {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          margin-top: 20px;
        }

        .worktree-btn-cancel,
        .worktree-btn-create {
          padding: 10px 20px;
          border-radius: 10px;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .worktree-btn-cancel {
          background: transparent;
          border: 1px solid rgba(20, 19, 17, 0.14);
          color: #6b7280;
        }

        .worktree-btn-cancel:hover {
          background: rgba(0, 0, 0, 0.04);
        }

        .worktree-btn-create {
          background: var(--accent, #ee5d3b);
          border: none;
          color: white;
        }

        .worktree-btn-create:hover {
          background: var(--accent-dark, #b43c24);
        }

        @media (max-width: 720px) {
          .worktree-create-grid {
            grid-template-columns: 1fr;
          }

          .worktree-create-field.is-full {
            grid-column: auto;
          }
        }
      `}</style>
    </div>
  );
}
