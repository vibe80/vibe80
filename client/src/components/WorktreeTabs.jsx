import { useState, useRef, useEffect, useMemo } from "react";

const STATUS_ICONS = {
  creating: "◌",
  ready: "●",
  processing: "◐",
  completed: "✓",
  error: "✕",
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
  disabled,
}) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [newName, setNewName] = useState("");
  const providerOptions = useMemo(
    () =>
      Array.isArray(providers) && providers.length
        ? providers
        : [provider || "codex"],
    [providers, provider]
  );
  const [newProvider, setNewProvider] = useState(providerOptions[0]);
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
    if (!providerOptions.includes(newProvider)) {
      setNewProvider(providerOptions[0]);
    }
  }, [providerOptions, newProvider]);

  const handleCreate = () => {
    if (onCreate) {
      onCreate({
        name: newName.trim() || null,
        provider: newProvider,
      });
    }
    setNewName("");
    setNewProvider(providerOptions[0]);
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
              title={wt.status}
            >
              {STATUS_ICONS[wt.status] || STATUS_ICONS.ready}
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
                title={`${wt.name} (${wt.branchName})`}
              >
                {wt.name}
              </span>
            )}

            <span className="worktree-tab-provider">{wt.provider}</span>

            {/* Don't show close button for "main" tab */}
            {wt.id !== "main" && (
              <button
                className="worktree-tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose?.(wt.id);
                }}
                title="Fermer"
              >
                ×
              </button>
            )}
          </div>
        ))}

        <button
          className="worktree-tab-add"
          onClick={() => setCreateDialogOpen(true)}
          disabled={disabled || worktreeList.length >= 5}
          title="Nouvelle branche parallèle"
        >
          +
        </button>
      </div>

      {createDialogOpen && (
        <div className="worktree-create-dialog-overlay" onClick={() => setCreateDialogOpen(false)}>
          <div className="worktree-create-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Nouvelle branche parallèle</h3>
            <div className="worktree-create-field">
              <label>Nom (optionnel)</label>
              <input
                ref={createInputRef}
                type="text"
                placeholder="ex: refactor-auth"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleKeyDownCreate}
              />
            </div>
            <div className="worktree-create-field">
              <label>Provider</label>
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                disabled={providerOptions.length <= 1}
              >
                {providerOptions.includes("codex") && (
                  <option value="codex">Codex (OpenAI)</option>
                )}
                {providerOptions.includes("claude") && (
                  <option value="claude">Claude</option>
                )}
              </select>
            </div>
            <div className="worktree-create-actions">
              <button className="worktree-btn-cancel" onClick={() => setCreateDialogOpen(false)}>
                Annuler
              </button>
              <button className="worktree-btn-create" onClick={handleCreate}>
                Créer
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .worktree-tabs-container {
          width: 100%;
        }

        .worktree-tabs {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.5);
          border-radius: 12px 12px 0 0;
          overflow-x: auto;
          scrollbar-width: thin;
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

        .worktree-tab-provider {
          font-size: 10px;
          color: #9ca3af;
          text-transform: uppercase;
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

        .worktree-create-field {
          margin-bottom: 16px;
        }

        .worktree-create-field label {
          display: block;
          font-size: 13px;
          color: #6b7280;
          margin-bottom: 6px;
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

        .worktree-create-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
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
      `}</style>
    </div>
  );
}
