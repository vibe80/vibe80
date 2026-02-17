import React, { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowsRotate,
  faFileCirclePlus,
  faFolderPlus,
  faPenToSquare,
  faTrashCan,
} from "@fortawesome/free-solid-svg-icons";

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
  startExplorerRename,
  createExplorerFile,
  createExplorerFolder,
  deleteExplorerSelection,
  getLanguageForPath,
  themeMode,
}) {
  const tabId = activeWorktreeId || "main";
  const openTabPaths = Array.isArray(activeExplorer.openTabPaths)
    ? activeExplorer.openTabPaths
    : [];
  const activeFilePath = activeExplorer.activeFilePath || "";
  const activeFile = activeFilePath
    ? activeExplorer.filesByPath?.[activeFilePath]
    : null;
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [newFileSubmitting, setNewFileSubmitting] = useState(false);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderSubmitting, setNewFolderSubmitting] = useState(false);

  const selectedPath = activeExplorer.selectedPath || "";
  const canRename = Boolean(selectedPath);
  const canDelete = Boolean(selectedPath);

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
  }, [
    activePane,
    activeFilePath,
    activeFile?.binary,
    activeFile?.saving,
    saveExplorerFile,
    tabId,
  ]);

  const getFileLabel = (path) => {
    if (!path) {
      return "";
    }
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
  };

  const subtitle = useMemo(() => {
    if (isInWorktree) {
      return activeWorktree?.branchName || activeWorktree?.name || "";
    }
    return repoName || "";
  }, [isInWorktree, activeWorktree?.branchName, activeWorktree?.name, repoName]);

  return (
    <div
      className={`explorer-panel ${activePane === "explorer" ? "" : "is-hidden"}`}
    >
      <div className="explorer-header">
        <div>
          <div className="explorer-title">{t("Explorer")}</div>
          {subtitle ? <div className="explorer-subtitle">{subtitle}</div> : null}
        </div>
      </div>
      <div className="explorer-body">
        <div className="explorer-tree-wrap">
          <div className="explorer-tree-header">
            <button
              type="button"
              className="explorer-tree-icon-btn"
              title={t("New file")}
              aria-label={t("New file")}
              onClick={() => {
                setNewFileName("");
                setNewFileDialogOpen(true);
              }}
              disabled={!attachmentSession?.sessionId}
            >
              <FontAwesomeIcon icon={faFileCirclePlus} />
            </button>
            <button
              type="button"
              className="explorer-tree-icon-btn"
              title={t("New folder")}
              aria-label={t("New folder")}
              onClick={() => {
                setNewFolderName("");
                setNewFolderDialogOpen(true);
              }}
              disabled={!attachmentSession?.sessionId}
            >
              <FontAwesomeIcon icon={faFolderPlus} />
            </button>
            <button
              type="button"
              className="explorer-tree-icon-btn"
              title={t("Rename")}
              aria-label={t("Rename")}
              onClick={() => startExplorerRename(tabId)}
              disabled={!attachmentSession?.sessionId || !canRename}
            >
              <FontAwesomeIcon icon={faPenToSquare} />
            </button>
            <button
              type="button"
              className="explorer-tree-icon-btn"
              title={t("Delete")}
              aria-label={t("Delete")}
              onClick={() => {
                void deleteExplorerSelection(tabId);
              }}
              disabled={!attachmentSession?.sessionId || !canDelete || Boolean(activeExplorer.deletingPath)}
            >
              <FontAwesomeIcon icon={faTrashCan} />
            </button>
            <button
              type="button"
              className="explorer-tree-icon-btn"
              title={t("Refresh")}
              aria-label={t("Refresh")}
              onClick={() => {
                requestExplorerTree(tabId, true);
                requestExplorerStatus(tabId, true);
              }}
              disabled={!attachmentSession?.sessionId}
            >
              <FontAwesomeIcon icon={faArrowsRotate} />
            </button>
          </div>

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
                  activeExplorer.selectedPath || activeFilePath,
                  activeExplorer.selectedType || null,
                  activeExplorer.renamingPath || null,
                  activeExplorer.renameDraft || "",
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
        </div>

        <div className="explorer-editor">
          <div className="explorer-editor-tabs">
            <div className="explorer-editor-tabs-list">
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
            <div className="explorer-editor-tabs-actions">
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
            <div className="explorer-editor-empty">{activeFile.error}</div>
          ) : activeFile?.binary ? (
            <div className="explorer-editor-empty">
              {t("Binary file not displayed.")}
            </div>
          ) : activeFilePath ? (
            <>
              <div className="explorer-editor-input">
                <Editor
                  path={activeFilePath}
                  defaultValue={activeFile?.draftContent || ""}
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
                <div className="explorer-truncated">{activeFile.saveError}</div>
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

      {newFileDialogOpen && (
        <div
          className="explorer-file-dialog-overlay"
          onClick={() => {
            if (!newFileSubmitting) {
              setNewFileDialogOpen(false);
            }
          }}
        >
          <div
            className="explorer-file-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{t("New file")}</h3>
            <div className="explorer-file-dialog-field">
              <label htmlFor="explorer-new-file-input">{t("File path")}</label>
              <input
                id="explorer-new-file-input"
                type="text"
                value={newFileName}
                onChange={(event) => setNewFileName(event.target.value)}
                placeholder={t("e.g. src/new-file.ts")}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !newFileSubmitting) {
                    event.preventDefault();
                    setNewFileSubmitting(true);
                    createExplorerFile(tabId, newFileName)
                      .then((ok) => {
                        if (ok) {
                          setNewFileDialogOpen(false);
                          setNewFileName("");
                        }
                      })
                      .finally(() => setNewFileSubmitting(false));
                  }
                }}
              />
            </div>
            <div className="explorer-file-dialog-actions">
              <button
                type="button"
                className="session-button secondary"
                onClick={() => setNewFileDialogOpen(false)}
                disabled={newFileSubmitting}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="session-button primary"
                disabled={newFileSubmitting || !newFileName.trim()}
                onClick={() => {
                  setNewFileSubmitting(true);
                  createExplorerFile(tabId, newFileName)
                    .then((ok) => {
                      if (ok) {
                        setNewFileDialogOpen(false);
                        setNewFileName("");
                      }
                    })
                    .finally(() => setNewFileSubmitting(false));
                }}
              >
                {newFileSubmitting ? t("Creating") : t("Create")}
              </button>
            </div>
          </div>
        </div>
      )}

      {newFolderDialogOpen && (
        <div
          className="explorer-file-dialog-overlay"
          onClick={() => {
            if (!newFolderSubmitting) {
              setNewFolderDialogOpen(false);
            }
          }}
        >
          <div
            className="explorer-file-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <h3>{t("New folder")}</h3>
            <div className="explorer-file-dialog-field">
              <label htmlFor="explorer-new-folder-input">{t("Folder path")}</label>
              <input
                id="explorer-new-folder-input"
                type="text"
                value={newFolderName}
                onChange={(event) => setNewFolderName(event.target.value)}
                placeholder={t("e.g. src/new-folder")}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !newFolderSubmitting) {
                    event.preventDefault();
                    setNewFolderSubmitting(true);
                    createExplorerFolder(tabId, newFolderName)
                      .then((ok) => {
                        if (ok) {
                          setNewFolderDialogOpen(false);
                          setNewFolderName("");
                        }
                      })
                      .finally(() => setNewFolderSubmitting(false));
                  }
                }}
              />
            </div>
            <div className="explorer-file-dialog-actions">
              <button
                type="button"
                className="session-button secondary"
                onClick={() => setNewFolderDialogOpen(false)}
                disabled={newFolderSubmitting}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="session-button primary"
                disabled={newFolderSubmitting || !newFolderName.trim()}
                onClick={() => {
                  setNewFolderSubmitting(true);
                  createExplorerFolder(tabId, newFolderName)
                    .then((ok) => {
                      if (ok) {
                        setNewFolderDialogOpen(false);
                        setNewFolderName("");
                      }
                    })
                    .finally(() => setNewFolderSubmitting(false));
                }}
              >
                {newFolderSubmitting ? t("Creating") : t("Create")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
