import React from "react";
import { Diff, Hunk } from "react-diff-view";

export default function DiffPanel({
  t,
  activePane,
  isInWorktree,
  diffStatusLines,
  connected,
  currentProcessing,
  hasCurrentChanges,
  sendCommitMessage,
  diffFiles,
  currentDiff,
  untrackedFilePanels,
  untrackedLoading,
}) {
  const hasUntrackedPanels = Array.isArray(untrackedFilePanels) && untrackedFilePanels.length > 0;

  return (
    <div className={`diff-panel ${activePane === "diff" ? "" : "is-hidden"}`}>
      <div className="diff-header">
        <div className="diff-title">
          {isInWorktree ? t("Worktree diff") : t("Repository diff")}
        </div>
        {diffStatusLines.length > 0 && (
          <div className="diff-count">
            {t("{{count}} files modified", {
              count: diffStatusLines.length,
            })}
          </div>
        )}
        <div className="diff-actions">
          <button
            type="button"
            className="diff-action-button"
            onClick={() => sendCommitMessage("Commit")}
            disabled={!connected || currentProcessing || !hasCurrentChanges}
            title={t("Send 'Commit' in chat")}
          >
            {t("Commit")}
          </button>
          <button
            type="button"
            className="diff-action-button primary"
            onClick={() => sendCommitMessage("Commit & Push")}
            disabled={!connected || currentProcessing || !hasCurrentChanges}
            title={t("Send 'Commit & Push' in chat")}
          >
            {t("Commit & Push")}
          </button>
        </div>
      </div>
      {diffStatusLines.length > 0 && (
        <div className="diff-status">
          {diffStatusLines.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      )}
      {diffFiles.length > 0 || hasUntrackedPanels ? (
        <div className="diff-body">
          {diffFiles.map((file) => {
            const fileLabel = file.newPath || file.oldPath || t("Diff");
            return (
              <div
                key={`${file.oldPath}-${file.newPath}-${file.type}`}
                className="diff-file"
              >
                <div className="diff-file-header">{fileLabel}</div>
                <Diff viewType="unified" diffType={file.type} hunks={file.hunks}>
                  {(hunks) =>
                    hunks.map((hunk) => (
                      <Hunk key={hunk.content} hunk={hunk} />
                    ))
                  }
                </Diff>
              </div>
            );
          })}
          {hasUntrackedPanels &&
            untrackedFilePanels.map((panel) => (
              <div key={`untracked-${panel.path}`} className="diff-file">
                <div className="diff-file-header">{`?? ${panel.path}`}</div>
                {panel.error ? (
                  <pre className="diff-fallback">{t("Unable to load file.")}</pre>
                ) : panel.binary ? (
                  <pre className="diff-fallback">{t("binary data")}</pre>
                ) : (
                  <>
                    <pre className="diff-fallback">{panel.content || ""}</pre>
                    {panel.truncated && (
                      <div className="diff-file-note">{t("File truncated for display.")}</div>
                    )}
                  </>
                )}
              </div>
            ))}
          {untrackedLoading && (
            <div className="diff-file-note">{t("Loading untracked files...")}</div>
          )}
        </div>
      ) : currentDiff.diff ? (
        <pre className="diff-fallback">{currentDiff.diff}</pre>
      ) : (
        <div className="diff-empty">{t("No changes detected.")}</div>
      )}
    </div>
  );
}
