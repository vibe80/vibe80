import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBroom,
  faCodeCompare,
  faComments,
  faFolderTree,
  faTerminal,
} from "@fortawesome/free-solid-svg-icons";

export default function ChatToolbar({
  t,
  activePane,
  handleViewSelect,
  handleDiffSelect,
  terminalEnabled,
  hasMessages,
  handleClearChat,
}) {
  if (activePane === "settings") {
    return null;
  }

  return (
    <div className="chat-toolbar" role="toolbar" aria-label={t("Chat tools")}>
      <div className="chat-toolbar-group">
        <button
          type="button"
          className={`chat-toolbar-button ${activePane === "chat" ? "is-active" : ""}`}
          onClick={() => handleViewSelect("chat")}
          aria-pressed={activePane === "chat"}
          aria-label={t("Messages")}
          title={t("Messages")}
        >
          <span className="chat-toolbar-icon-wrap" aria-hidden="true">
            <span className="chat-toolbar-icon">
              <FontAwesomeIcon icon={faComments} />
            </span>
          </span>
          <span className="chat-toolbar-label">{t("Messages")}</span>
        </button>
        <button
          type="button"
          className={`chat-toolbar-button ${activePane === "diff" ? "is-active" : ""}`}
          onClick={handleDiffSelect}
          aria-pressed={activePane === "diff"}
          aria-label={t("Diff")}
          title={t("Diff")}
        >
          <span className="chat-toolbar-icon-wrap" aria-hidden="true">
            <span className="chat-toolbar-icon">
              <FontAwesomeIcon icon={faCodeCompare} />
            </span>
          </span>
          <span className="chat-toolbar-label">{t("Diff")}</span>
        </button>
        <button
          type="button"
          className={`chat-toolbar-button ${activePane === "explorer" ? "is-active" : ""}`}
          onClick={() => handleViewSelect("explorer")}
          aria-pressed={activePane === "explorer"}
          aria-label={t("Explorer")}
          title={t("Explorer")}
        >
          <span className="chat-toolbar-icon-wrap" aria-hidden="true">
            <span className="chat-toolbar-icon">
              <FontAwesomeIcon icon={faFolderTree} />
            </span>
          </span>
          <span className="chat-toolbar-label">{t("Explorer")}</span>
        </button>
        <button
          type="button"
          className={`chat-toolbar-button ${activePane === "terminal" ? "is-active" : ""}`}
          onClick={() => handleViewSelect("terminal")}
          aria-pressed={activePane === "terminal"}
          aria-label={t("Terminal")}
          title={t("Terminal")}
          disabled={!terminalEnabled}
        >
          <span className="chat-toolbar-icon-wrap" aria-hidden="true">
            <span className="chat-toolbar-icon">
              <FontAwesomeIcon icon={faTerminal} />
            </span>
          </span>
          <span className="chat-toolbar-label">{t("Terminal")}</span>
        </button>
      </div>
      <div className="chat-toolbar-divider" />
      <div className="chat-toolbar-group">
        <button
          type="button"
          className="chat-toolbar-button is-danger"
          onClick={() => handleClearChat()}
          aria-label={t("Clear")}
          title={t("Clear")}
          disabled={!hasMessages}
        >
          <span className="chat-toolbar-icon-wrap" aria-hidden="true">
            <span className="chat-toolbar-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faBroom} />
            </span>
          </span>
          <span className="chat-toolbar-label">{t("Clear")}</span>
        </button>
      </div>
    </div>
  );
}
