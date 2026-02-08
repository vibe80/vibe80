import React from "react";
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
  getLanguageForPath,
  themeMode,
}) {
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
            const tabId = activeWorktreeId || "main";
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
                activeWorktreeId || "main",
                new Set(activeExplorer.expandedPaths || []),
                activeExplorer.selectedPath,
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
          <div className="explorer-editor-header">
            <span className="explorer-editor-path">
              {activeExplorer.selectedPath || t("No file selected")}
            </span>
            <div className="explorer-editor-actions">
              {activeExplorer.selectedPath && !activeExplorer.fileBinary && (
                <button
                  type="button"
                  className="explorer-action primary"
                  onClick={() => saveExplorerFile(activeWorktreeId || "main")}
                  disabled={activeExplorer.fileSaving || !activeExplorer.isDirty}
                >
                  {activeExplorer.fileSaving ? t("Saving...") : t("Save")}
                </button>
              )}
            </div>
          </div>
          {activeExplorer.fileLoading ? (
            <div className="explorer-editor-empty">{t("Loading...")}</div>
          ) : activeExplorer.fileError ? (
            <div className="explorer-editor-empty">
              {activeExplorer.fileError}
            </div>
          ) : activeExplorer.fileBinary ? (
            <div className="explorer-editor-empty">
              {t("Binary file not displayed.")}
            </div>
          ) : activeExplorer.selectedPath ? (
            <>
              <div className="explorer-editor-input">
                <Editor
                  key={activeExplorer.selectedPath}
                  value={activeExplorer.draftContent || ""}
                  onChange={(value) =>
                    updateExplorerDraft(activeWorktreeId || "main", value || "")
                  }
                  language={getLanguageForPath(activeExplorer.selectedPath)}
                  theme={themeMode === "dark" ? "vs-dark" : "light"}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 12,
                    lineHeight: 18,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    wordWrap: "off",
                    readOnly: false,
                  }}
                />
              </div>
              {activeExplorer.fileSaveError && (
                <div className="explorer-truncated">
                  {activeExplorer.fileSaveError}
                </div>
              )}
              {activeExplorer.fileTruncated && (
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
