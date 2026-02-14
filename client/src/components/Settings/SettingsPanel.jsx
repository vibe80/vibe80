import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowLeft } from "@fortawesome/free-solid-svg-icons";

export default function SettingsPanel({
  t,
  activePane,
  handleSettingsBack,
  language,
  setLanguage,
  showChatCommands,
  setShowChatCommands,
  showToolResults,
  setShowToolResults,
  notificationsEnabled,
  setNotificationsEnabled,
  themeMode,
  setThemeMode,
  debugMode,
  setDebugMode,
  gitIdentityName,
  setGitIdentityName,
  gitIdentityEmail,
  setGitIdentityEmail,
  gitIdentityGlobal,
  gitIdentityRepo,
  gitIdentityLoading,
  gitIdentitySaving,
  gitIdentityError,
  gitIdentityMessage,
  handleSaveGitIdentity,
  attachmentSession,
}) {
  return (
    <div className={`settings-panel ${activePane === "settings" ? "" : "is-hidden"}`}>
      <div className="settings-header">
        <button
          type="button"
          className="settings-back icon-button"
          onClick={handleSettingsBack}
          aria-label={t("Back to previous view")}
          title={t("Back")}
        >
          <span aria-hidden="true">
            <FontAwesomeIcon icon={faArrowLeft} />
          </span>
        </button>
        <div className="settings-heading">
          <div className="settings-title">{t("User settings")}</div>
          <div className="settings-subtitle">
            {t("These settings are stored in your browser.")}
          </div>
        </div>
      </div>
      <div className="settings-group">
        <label className="settings-item">
          <span className="settings-text">
            <span className="settings-name">{t("Language")}</span>
            <span className="settings-hint">{t("Select a language")}</span>
          </span>
          <select
            className="settings-select"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
          >
            <option value="fr">{t("French")}</option>
            <option value="en">{t("English")}</option>
          </select>
        </label>
        <label className="settings-item">
          <span className="settings-text">
            <span className="settings-name">{t("Show commands in chat")}</span>
            <span className="settings-hint">
              {t("Show executed command blocks in the conversation.")}
            </span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={showChatCommands}
            onChange={(event) => setShowChatCommands(event.target.checked)}
          />
        </label>
        <label className="settings-item">
          <span className="settings-text">
            <span className="settings-name">{t("Show tool results in chat")}</span>
            <span className="settings-hint">
              {t("Show tool_result blocks in the conversation.")}
            </span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={showToolResults}
            onChange={(event) => setShowToolResults(event.target.checked)}
          />
        </label>
        <label className="settings-item">
          <span className="settings-text">
            <span className="settings-name">{t("Notifications")}</span>
            <span className="settings-hint">
              {t("Show a notification and sound when a new message arrives.")}
            </span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={notificationsEnabled}
            onChange={(event) => setNotificationsEnabled(event.target.checked)}
          />
        </label>
        <label className="settings-item">
          <span className="settings-text">
            <span className="settings-name">{t("Dark mode")}</span>
            <span className="settings-hint">
              {t("Enable the dark theme for the interface.")}
            </span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={themeMode === "dark"}
            onChange={(event) =>
              setThemeMode(event.target.checked ? "dark" : "light")
            }
          />
        </label>
        <label className="settings-item">
          <span className="settings-text">
            <span className="settings-name">{t("Debug mode")}</span>
            <span className="settings-hint">
              {t("Enable access to logs and Markdown/JSON export.")}
            </span>
          </span>
          <input
            type="checkbox"
            className="settings-toggle"
            checked={debugMode}
            onChange={(event) => setDebugMode(event.target.checked)}
          />
        </label>
      </div>
      <div className="settings-group">
        <div className="settings-item settings-item--stacked">
          <div className="settings-text">
            <span className="settings-name">
              {t("Git identity for this repository")}
            </span>
            <span className="settings-hint">
              {t("Provide user.name and user.email for repository commits.")}
            </span>
            <span className="settings-hint">
              {t("Global values: {{name}} / {{email}}.", {
                name: gitIdentityGlobal.name || t("Not set"),
                email: gitIdentityGlobal.email || t("Not set"),
              })}
            </span>
            <span className="settings-hint">
              {gitIdentityRepo.name || gitIdentityRepo.email
                ? t("Repository values: {{name}} / {{email}}.", {
                    name: gitIdentityRepo.name || t("Not set"),
                    email: gitIdentityRepo.email || t("Not set"),
                  })
                : t("No repository-specific values.")}
            </span>
          </div>
          <div className="settings-fields">
            <label className="settings-field">
              <span className="settings-field-label">{t("user.name")}</span>
              <input
                type="text"
                className="settings-input"
                value={gitIdentityName}
                onChange={(event) => setGitIdentityName(event.target.value)}
                placeholder={gitIdentityGlobal.name || t("Full name")}
                disabled={
                  gitIdentityLoading ||
                  gitIdentitySaving ||
                  !attachmentSession?.sessionId
                }
              />
            </label>
            <label className="settings-field">
              <span className="settings-field-label">{t("user.email")}</span>
              <input
                type="email"
                className="settings-input"
                value={gitIdentityEmail}
                onChange={(event) => setGitIdentityEmail(event.target.value)}
                placeholder={
                  gitIdentityGlobal.email || t("your.email@example.com")
                }
                disabled={
                  gitIdentityLoading ||
                  gitIdentitySaving ||
                  !attachmentSession?.sessionId
                }
              />
            </label>
          </div>
          <div className="settings-actions">
            <button
              type="button"
              className="settings-button"
              onClick={handleSaveGitIdentity}
              disabled={
                gitIdentityLoading ||
                gitIdentitySaving ||
                !attachmentSession?.sessionId
              }
            >
              {gitIdentitySaving ? t("Saving...") : t("Save")}
            </button>
            {gitIdentityLoading ? (
              <span className="settings-status">{t("Loading...")}</span>
            ) : null}
            {gitIdentityError ? (
              <span className="settings-status is-error">{gitIdentityError}</span>
            ) : null}
            {gitIdentityMessage ? (
              <span className="settings-status">{gitIdentityMessage}</span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
