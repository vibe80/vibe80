import React, { useEffect } from "react";
import Editor from "@monaco-editor/react";

export default function ExplorerPanel({
  t,
  activePane,
  repoName,
  activeWorktree,
  isInWorktree,
  activeWorktreeId,
  attachmentSession,
  requestExplorerTree,
  requestExplorerStatus,
  activeExplorer,
  renderExplorerNodes,
  explorerStatusByPath,
  explorerDirStatus,
  saveExplorerFile,
  updateExplorerDraft,
  setActiveExplorerFile,
  closeExplorerFile,
  getLanguageForPath,
  themeMode,
}) {
  const tabId = activeWorktreeId || "main";
  const openTabPaths = Array.isArray(activeExplorer.openTabPaths)
    ? activeExplorer.openTabPaths
    : [];
  const activeFilePath = activeExplorer.activeFilePath || activeExplorer.selectedPath || "";
  const activeFile = activeFilePath ? activeExplorer.filesByPath?.[activeFilePath] : null;

  useEffect(() => {
    if (activePane !== "explorer") {
      return undefined;
    }
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) {
        return;
      }
      if (event.key.toLowerCase() !== "s") {
        return;
      }
      if (!activeFilePath || activeFile?.binary || activeFile?.saving) {
        return;
      }
      event.preventDefault();
      saveExplorerFile(tabId, activeFilePath);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activePane, activeFilePath, activeFile?.binary, activeFile?.saving, saveExplorerFile, tabId]);

  const getFileLabel = (path) => {
    if (!path) {
      return "";
    }
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
  };

  return (
    <div
      className={`explorer-panel ${activePane === "explorer" ? "" : "is-hidden"}`}
    >
      <div className="explorer-header">
        <div>
          <div className="explorer-title">{t("Explorer")}</div>
          {(repoName || activeWorktree?.branchName || activeWorktree?.name) && (
            <div className="explorer-subtitle">
              {isInWorktree
                ? activeWorktree?.branchName || activeWorktree?.name
                : repoName}
            </div>
          )}
        </div>
        <button
          type="button"
          className="explorer-refresh"
          onClick={() => {
            requestExplorerTree(tabId, true);
            requestExplorerStatus(tabId, true);
          }}
          disabled={!attachmentSession?.sessionId}
        >
          {t("Refresh")}
        </button>
      </div>
      <div className="explorer-body">
        <div className="explorer-tree">
          {activeExplorer.loading ? (
            <div className="explorer-empty">{t("Loading...")}</div>
          ) : activeExplorer.error ? (
            <div className="explorer-empty">{activeExplorer.error}</div>
          ) : Array.isArray(activeExplorer.tree) &&
            activeExplorer.tree.length > 0 ? (
            <>
              {renderExplorerNodes(
                activeExplorer.tree,
                tabId,
                new Set(activeExplorer.expandedPaths || []),
                activeFilePath,
                explorerStatusByPath,
                explorerDirStatus
              )}
              {activeExplorer.treeTruncated && (
                <div className="explorer-truncated">
                  {t("List truncated after {{count}} entries.", {
                    count: activeExplorer.treeTotal,
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="explorer-empty">{t("No file found.")}</div>
          )}
        </div>
        <div className="explorer-editor">
          <div className="explorer-editor-tabs">
            {openTabPaths.map((path) => {
              const file = activeExplorer.filesByPath?.[path];
              const isActive = path === activeFilePath;
              return (
                <div
                  key={path}
                  className={`explorer-editor-tab ${isActive ? "is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="explorer-editor-tab-open"
                    onClick={() => setActiveExplorerFile(tabId, path)}
                  >
                    {getFileLabel(path)}
                    {file?.isDirty ? " *" : ""}
                  </button>
                  <button
                    type="button"
                    className="explorer-editor-tab-close"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeExplorerFile(tabId, path);
                    }}
                    aria-label={t("Close")}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          <div className="explorer-editor-header">
            <span className="explorer-editor-path">
              {activeFilePath || t("No file selected")}
            </span>
            <div className="explorer-editor-actions">
              {activeFilePath && !activeFile?.binary && (
                <button
                  type="button"
                  className="explorer-action primary"
                  onClick={() => saveExplorerFile(tabId, activeFilePath)}
                  disabled={activeFile?.saving || !activeFile?.isDirty}
                >
                  {activeFile?.saving ? t("Saving...") : t("Save")}
                </button>
              )}
            </div>
          </div>
          {activeFile?.loading ? (
            <div className="explorer-editor-empty">{t("Loading...")}</div>
          ) : activeFile?.error ? (
            <div className="explorer-editor-empty">
              {activeFile.error}
            </div>
          ) : activeFile?.binary ? (
            <div className="explorer-editor-empty">
              {t("Binary file not displayed.")}
            </div>
          ) : activeFilePath ? (
            <>
              <div className="explorer-editor-input">
                <Editor
                  key={activeFilePath}
                  value={activeFile?.draftContent || ""}
                  onChange={(value) =>
                    updateExplorerDraft(tabId, activeFilePath, value || "")
                  }
                  language={getLanguageForPath(activeFilePath)}
                  theme={themeMode === "dark" ? "vs-dark" : "light"}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 18,
                    fontFamily:
                      '"Space Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "off",
                    readOnly: false,
                  }}
                />
              </div>
              {activeFile?.saveError && (
                <div className="explorer-truncated">
                  {activeFile.saveError}
                </div>
              )}
              {activeFile?.truncated && (
                <div className="explorer-truncated">
                  {t("File truncated for display.")}
                </div>
              )}
            </>
          ) : (
            <div className="explorer-editor-empty">
              {t("Select a file in the tree.")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
