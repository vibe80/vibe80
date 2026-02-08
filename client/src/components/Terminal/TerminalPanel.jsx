import React from "react";

export default function TerminalPanel({
  t,
  terminalEnabled,
  activePane,
  repoName,
  activeWorktree,
  isInWorktree,
  terminalContainerRef,
  attachmentSession,
}) {
  if (!terminalEnabled) {
    return null;
  }

  return (
    <div
      className={`terminal-panel ${activePane === "terminal" ? "" : "is-hidden"}`}
    >
      <div className="terminal-header">
        <div className="terminal-title">{t("Terminal")}</div>
        {(repoName || activeWorktree?.branchName || activeWorktree?.name) && (
          <div className="terminal-meta">
            {isInWorktree
              ? activeWorktree?.branchName || activeWorktree?.name
              : repoName}
          </div>
        )}
      </div>
      <div className="terminal-body" ref={terminalContainerRef} />
      {!attachmentSession?.sessionId && (
        <div className="terminal-empty">
          {t("Start a session to open the terminal.")}
        </div>
      )}
    </div>
  );
}
