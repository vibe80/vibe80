import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCheck, faCopy, faPlus, faRightFromBracket, faUser } from "@fortawesome/free-solid-svg-icons";

export default function SessionGate({
  t,
  brandLogo,
  showStep1,
  showStep2,
  showStep3,
  showStep4,
  headerHint,
  workspaceMode,
  setWorkspaceMode,
  formDisabled,
  handleWorkspaceSubmit,
  workspaceIdInput,
  setWorkspaceIdInput,
  workspaceSecretInput,
  setWorkspaceSecretInput,
  workspaceError,
  handleWorkspaceProvidersSubmit,
  workspaceProvider,
  workspaceAuthExpanded,
  setWorkspaceAuthExpanded,
  setWorkspaceProviders,
  providerAuthOptions,
  getProviderAuthType,
  workspaceAuthFiles,
  setWorkspaceAuthFiles,
  sessionMode,
  setSessionMode,
  setSessionRequested,
  setAttachmentsError,
  loadWorkspaceSessions,
  deploymentMode,
  handleLeaveWorkspace,
  workspaceSessionsLoading,
  workspaceSessions,
  workspaceSessionsError,
  workspaceSessionDeletingId,
  handleResumeSession,
  handleDeleteSession,
  locale,
  extractRepoName,
  getTruncatedText,
  isCloning,
  repoDisplay,
  onRepoSubmit,
  sessionNameInput,
  setSessionNameInput,
  repoInput,
  setRepoInput,
  repoHistory,
  authMode,
  setAuthMode,
  sshKeyInput,
  setSshKeyInput,
  httpUsername,
  setHttpUsername,
  httpPassword,
  setHttpPassword,
  defaultInternetAccess,
  setDefaultInternetAccess,
  defaultDenyGitCredentialsAccess,
  setDefaultDenyGitCredentialsAccess,
  attachmentsError,
  sessionRequested,
  workspaceBusy,
  workspaceProvidersEditing,
  providersBackStep,
  setWorkspaceStep,
  setWorkspaceProvidersEditing,
  setWorkspaceError,
  setProvidersBackStep,
  loadWorkspaceProviders,
  workspaceCreated,
  workspaceId,
  workspaceCopied,
  handleWorkspaceCopy,
  infoContent,
  toast,
}) {
  return (
    <div className="session-gate session-fullscreen">
      <div className="session-layout session-layout--fullscreen">
        <div className="session-shell">
          <div className="session-header">
            <img className="brand-logo" src={brandLogo} alt="vibe80" />
            <h1>
              {showStep4
                ? t("Clone a session")
                : showStep3
                  ? t("Workspace created")
                  : showStep2
                    ? t("Configure AI providers")
                    : t("Configure the workspace")}
            </h1>
            {headerHint ? <p className="session-hint">{headerHint}</p> : null}
          </div>
          <div className="session-body">
            {showStep1 && (
              <>
                <form
                  id="workspace-form"
                  className="session-form"
                  onSubmit={handleWorkspaceSubmit}
                >
                  <div className="session-workspace-options">
                    <button
                      type="button"
                      className={`session-workspace-option ${
                        workspaceMode === "existing" ? "is-selected" : ""
                      }`}
                      onClick={() => setWorkspaceMode("existing")}
                      disabled={formDisabled}
                      aria-pressed={workspaceMode === "existing"}
                    >
                      <span
                        className="session-workspace-icon is-join"
                        aria-hidden="true"
                      >
                        <FontAwesomeIcon icon={faUser} />
                      </span>
                      <span className="session-workspace-option-text">
                        <span className="session-workspace-option-title">
                          {t("Join a workspace")}
                        </span>
                        <span className="session-workspace-option-subtitle">
                          {t("Access an existing space with your credentials")}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`session-workspace-option ${
                        workspaceMode === "new" ? "is-selected" : ""
                      }`}
                      onClick={() => setWorkspaceMode("new")}
                      disabled={formDisabled}
                      aria-pressed={workspaceMode === "new"}
                    >
                      <span
                        className="session-workspace-icon is-create"
                        aria-hidden="true"
                      >
                        <FontAwesomeIcon icon={faPlus} />
                      </span>
                      <span className="session-workspace-option-text">
                        <span className="session-workspace-option-title">
                          {t("Create a workspace")}
                        </span>
                        <span className="session-workspace-option-subtitle">
                          {t("Create a new space for you or your team")}
                        </span>
                      </span>
                    </button>
                  </div>
                  <div
                    className={`session-panel ${
                      workspaceMode === "existing" ? "is-visible" : "is-hidden"
                    }`}
                    aria-hidden={workspaceMode !== "existing"}
                  >
                    <div className="session-workspace-form">
                      <div className="session-workspace-form-labels">
                        <span>{t("Workspace name")}</span>
                        <span>{t("Secret")}</span>
                      </div>
                      <div className="session-workspace-form-grid">
                        <input
                          type="text"
                          placeholder={t("workspaceId (e.g. w...)")}
                          value={workspaceIdInput}
                          onChange={(event) =>
                            setWorkspaceIdInput(event.target.value)
                          }
                          disabled={formDisabled}
                          spellCheck={false}
                        />
                        <input
                          type="password"
                          placeholder={t("workspaceSecret")}
                          value={workspaceSecretInput}
                          onChange={(event) =>
                            setWorkspaceSecretInput(event.target.value)
                          }
                          disabled={formDisabled}
                          autoComplete="off"
                        />
                      </div>
                    </div>
                  </div>
                </form>
                {workspaceError && (
                  <div className="attachments-error">{workspaceError}</div>
                )}
              </>
            )}

            {showStep2 && (
              <>
                <form
                  id="providers-form"
                  className="session-form"
                  onSubmit={handleWorkspaceProvidersSubmit}
                >
                  <div className="session-auth-options session-auth-accordion">
                    {["codex", "claude"].map((provider) => {
                      const config = workspaceProvider(provider);
                      const label =
                        provider === "codex" ? t("Codex") : t("Claude");
                      const expanded = Boolean(workspaceAuthExpanded[provider]);
                      const isEnabled = Boolean(config.enabled);
                      return (
                        <div key={provider} className="session-auth-card">
                          <div className="session-auth-header">
                            <label className="session-auth-option">
                              <input
                                type="checkbox"
                                checked={isEnabled}
                                onChange={() => {
                                  const nextEnabled = !isEnabled;
                                  setWorkspaceAuthExpanded((current) => ({
                                    ...current,
                                    [provider]: nextEnabled,
                                  }));
                                  setWorkspaceProviders((current) => ({
                                    ...current,
                                    [provider]: {
                                      ...current[provider],
                                      enabled: nextEnabled,
                                    },
                                  }));
                                }}
                                disabled={formDisabled}
                              />
                              {label}
                            </label>
                          </div>
                          {isEnabled && expanded ? (
                            <div className="session-auth-grid">
                              <select
                                value={getProviderAuthType(provider, config)}
                                onChange={(event) =>
                                  setWorkspaceProviders((current) => ({
                                    ...current,
                                    [provider]: {
                                      ...current[provider],
                                      authType: event.target.value,
                                      authValue: "",
                                    },
                                  }))
                                }
                                disabled={formDisabled}
                              >
                                {(providerAuthOptions[provider] || []).map(
                                  (authType) => (
                                    <option key={authType} value={authType}>
                                      {t(authType)}
                                    </option>
                                  )
                                )}
                              </select>
                              {getProviderAuthType(provider, config) ===
                              "auth_json_b64" ? (
                                <div className="session-auth-file">
                                  <input
                                    type="file"
                                    accept="application/json,.json"
                                    onChange={async (event) => {
                                      const file = event.target.files?.[0];
                                      if (!file) {
                                        return;
                                      }
                                      const content = await file.text();
                                      setWorkspaceProviders((current) => ({
                                        ...current,
                                        [provider]: {
                                          ...current[provider],
                                          authValue: content,
                                        },
                                      }));
                                      setWorkspaceAuthFiles((current) => ({
                                        ...current,
                                        [provider]: file.name,
                                      }));
                                      event.target.value = "";
                                    }}
                                    disabled={formDisabled}
                                  />
                                  {workspaceAuthFiles[provider] ? (
                                    <span className="session-auth-file-name">
                                      {workspaceAuthFiles[provider]}
                                    </span>
                                  ) : null}
                                </div>
                              ) : (
                                <input
                                  type="password"
                                  placeholder={t("Key or token")}
                                  value={config.authValue}
                                  onChange={(event) =>
                                    setWorkspaceProviders((current) => ({
                                      ...current,
                                      [provider]: {
                                        ...current[provider],
                                        authValue: event.target.value,
                                      },
                                    }))
                                  }
                                  disabled={formDisabled}
                                  autoComplete="off"
                                />
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </form>
                {workspaceError && (
                  <div className="attachments-error">{workspaceError}</div>
                )}
              </>
            )}

            {showStep3 && (
              <>
                <div className="workspace-created-card">
                  <div className="workspace-created-row">
                    <span className="workspace-created-label">
                      {t("Workspace ID")}
                    </span>
                    <span className="workspace-created-value">
                      {workspaceCreated?.workspaceId || workspaceId}
                    </span>
                    <button
                      type="button"
                      className="workspace-created-copy"
                      onClick={() =>
                        handleWorkspaceCopy(
                          "id",
                          workspaceCreated?.workspaceId || workspaceId || ""
                        )
                      }
                      aria-label={t("Copy workspace ID")}
                    >
                      <FontAwesomeIcon
                        icon={workspaceCopied.id ? faCheck : faCopy}
                      />
                    </button>
                  </div>
                  <div className="workspace-created-row">
                    <span className="workspace-created-label">
                      {t("Workspace Secret")}
                    </span>
                    <span className="workspace-created-value">
                      {workspaceCreated?.workspaceSecret || ""}
                    </span>
                    <button
                      type="button"
                      className="workspace-created-copy"
                      onClick={() =>
                        handleWorkspaceCopy(
                          "secret",
                          workspaceCreated?.workspaceSecret || ""
                        )
                      }
                      aria-label={t("Copy workspace secret")}
                    >
                      <FontAwesomeIcon
                        icon={workspaceCopied.secret ? faCheck : faCopy}
                      />
                    </button>
                  </div>
                </div>
              </>
            )}

            {showStep4 && (
              <div className="session-step">
                <div className="session-workspace-toggle">
                  <button
                    type="button"
                    className={`session-workspace-option is-compact ${
                      sessionMode === "new" ? "is-selected" : ""
                    }`}
                    onClick={() => {
                      setSessionMode("new");
                      setSessionRequested(false);
                      setAttachmentsError("");
                    }}
                    disabled={formDisabled}
                    aria-pressed={sessionMode === "new"}
                  >
                    <span
                      className="session-workspace-icon is-create"
                      aria-hidden="true"
                    >
                      <FontAwesomeIcon icon={faPlus} />
                    </span>
                    <span className="session-workspace-option-title">
                      {t("New session")}
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`session-workspace-option is-compact ${
                      sessionMode === "existing" ? "is-selected" : ""
                    }`}
                    onClick={() => {
                      setSessionMode("existing");
                      setSessionRequested(false);
                      setAttachmentsError("");
                      loadWorkspaceSessions();
                    }}
                    disabled={formDisabled}
                    aria-pressed={sessionMode === "existing"}
                  >
                    <span
                      className="session-workspace-icon is-join"
                      aria-hidden="true"
                    >
                      <FontAwesomeIcon icon={faUser} />
                    </span>
                    <span className="session-workspace-option-title">
                      {t("Resume an existing session")}
                    </span>
                  </button>
                  {deploymentMode !== "mono_user" && (
                    <button
                      type="button"
                      className="session-workspace-option is-compact"
                      onClick={handleLeaveWorkspace}
                    >
                      <span
                        className="session-workspace-icon is-leave"
                        aria-hidden="true"
                      >
                        <FontAwesomeIcon icon={faRightFromBracket} />
                      </span>
                      <span className="session-workspace-option-title">
                        {t("Leave workspace")}
                      </span>
                    </button>
                  )}
                </div>
                <div
                  className={`session-panel ${
                    sessionMode === "existing" ? "is-visible" : "is-hidden"
                  }`}
                  aria-hidden={sessionMode !== "existing"}
                >
                  <div className="session-auth">
                    <div className="session-auth-title">
                      {t("Existing sessions")}
                    </div>
                    {workspaceSessionsLoading ? (
                      <div className="session-auth-hint">
                        {t("Loading sessions...")}
                      </div>
                    ) : workspaceSessions.length === 0 ? (
                      <div className="session-auth-hint">
                        {t("No sessions available.")}
                      </div>
                    ) : (
                      <ul className="session-list">
                        {workspaceSessions.map((session) => {
                          const repoName = extractRepoName(session.repoUrl);
                          const title =
                            session.name || repoName || session.sessionId;
                          const subtitle = session.repoUrl
                            ? getTruncatedText(session.repoUrl, 72)
                            : session.sessionId;
                          const lastSeen = session.lastActivityAt
                            ? new Date(session.lastActivityAt).toLocaleString(
                                locale
                              )
                            : session.createdAt
                              ? new Date(
                                  session.createdAt
                                ).toLocaleString(locale)
                              : "";
                          const isDeleting =
                            workspaceSessionDeletingId === session.sessionId;
                          return (
                            <li key={session.sessionId} className="session-item">
                              <div className="session-item-meta">
                                <div className="session-item-title">{title}</div>
                                <div className="session-item-sub">
                                  {subtitle}
                                </div>
                                {lastSeen && (
                                  <div className="session-item-sub">
                                    {t("Last activity: {{date}}", {
                                      date: lastSeen,
                                    })}
                                  </div>
                                )}
                              </div>
                              <div className="session-item-actions">
                                <button
                                  type="button"
                                  className="session-list-button"
                                  onClick={() =>
                                    handleResumeSession(session.sessionId)
                                  }
                                  disabled={formDisabled || isDeleting}
                                >
                                  {t("Resume")}
                                </button>
                                <button
                                  type="button"
                                  className="session-list-button is-danger"
                                  onClick={() => handleDeleteSession(session)}
                                  disabled={formDisabled || isDeleting}
                                >
                                  {isDeleting ? t("Deleting...") : t("Delete")}
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {workspaceSessionsError && (
                      <div className="attachments-error">
                        {workspaceSessionsError}
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className={`session-panel ${
                    sessionMode === "new" ? "is-visible" : "is-hidden"
                  }`}
                  aria-hidden={sessionMode !== "new"}
                >
                  {isCloning ? (
                    <div className="session-hint">
                      {t("Cloning repository...")}
                      {repoDisplay && (
                        <div className="session-meta">{repoDisplay}</div>
                      )}
                    </div>
                  ) : (
                    <form
                      id="repo-form"
                      className="session-form session-form--compact"
                      onSubmit={onRepoSubmit}
                    >
                      <div className="session-form-row is-compact-grid">
                        <input
                          type="text"
                          placeholder={t("Session name (optional)")}
                          value={sessionNameInput}
                          onChange={(event) =>
                            setSessionNameInput(event.target.value)
                          }
                          disabled={formDisabled}
                        />
                        <div className="session-repo-field">
                          <input
                            type="text"
                            placeholder={t(
                              "git@gitea.devops:my-org/my-repo.git"
                            )}
                            value={repoInput}
                            onChange={(event) => {
                              setRepoInput(event.target.value);
                            }}
                            disabled={formDisabled}
                            required
                            list={
                              repoHistory.length > 0
                                ? "repo-history"
                                : undefined
                            }
                          />
                          {repoHistory.length > 0 && (
                            <datalist id="repo-history">
                              {repoHistory.map((url) => (
                                <option key={url} value={url}>
                                  {getTruncatedText(url, 72)}
                                </option>
                              ))}
                            </datalist>
                          )}
                        </div>
                      </div>
                      <div className="session-auth">
                        <div className="session-auth-title">
                          {t("Repository authentication (optional)")}
                        </div>
                        <div className="session-auth-options">
                          <select
                            value={authMode}
                            onChange={(event) =>
                              setAuthMode(event.target.value)
                            }
                            disabled={formDisabled}
                          >
                            <option value="none">{t("None")}</option>
                            <option value="ssh">
                              {t("Private SSH key (not recommended)")}
                            </option>
                            <option value="http">
                              {t("Username + password")}
                            </option>
                          </select>
                        </div>
                        {authMode === "ssh" && (
                          <>
                            <textarea
                              className="session-auth-textarea"
                              placeholder={t(
                                "-----BEGIN OPENSSH PRIVATE KEY-----"
                              )}
                              value={sshKeyInput}
                              onChange={(event) =>
                                setSshKeyInput(event.target.value)
                              }
                              disabled={formDisabled}
                              rows={6}
                              spellCheck={false}
                            />
                          </>
                        )}
                        {authMode === "http" && (
                          <>
                            <div className="session-auth-grid">
                              <input
                                type="text"
                                placeholder={t("Username")}
                                value={httpUsername}
                                onChange={(event) =>
                                  setHttpUsername(event.target.value)
                                }
                                disabled={formDisabled}
                                autoComplete="username"
                              />
                              <input
                                type="password"
                                placeholder={t("Password or PAT")}
                                value={httpPassword}
                                onChange={(event) =>
                                  setHttpPassword(event.target.value)
                                }
                                disabled={formDisabled}
                                autoComplete="current-password"
                              />
                            </div>
                          </>
                        )}
                      </div>
                      <div className="session-auth session-auth-compact">
                        <div className="session-auth-title">
                          {t("Permissions")}
                        </div>
                        <div className="session-auth-options session-auth-options--compact">
                          <label className="session-auth-option">
                            <input
                              type="checkbox"
                              checked={defaultInternetAccess}
                              onChange={(event) => {
                                const checked = event.target.checked;
                                setDefaultInternetAccess(checked);
                                if (!checked) {
                                  setDefaultDenyGitCredentialsAccess(false);
                                }
                              }}
                              disabled={formDisabled}
                            />
                            {t("Internet access")}
                          </label>
                          {defaultInternetAccess && (
                            <label className="session-auth-option">
                              <input
                                type="checkbox"
                                checked={defaultDenyGitCredentialsAccess}
                                onChange={(event) =>
                                  setDefaultDenyGitCredentialsAccess(
                                    event.target.checked
                                  )
                                }
                                disabled={formDisabled}
                              />
                              {t("Deny git credentials access")}
                            </label>
                          )}
                        </div>
                      </div>
                    </form>
                  )}
                </div>
                {attachmentsError && (
                  <div className="attachments-error">{attachmentsError}</div>
                )}
              </div>
            )}
          </div>
          <div className="session-footer">
            {showStep1 ? (
              <button
                type="submit"
                form="workspace-form"
                className="session-button primary"
                disabled={formDisabled}
              >
                {workspaceBusy ? t("Validating...") : t("Continue")}
              </button>
            ) : showStep2 ? (
              <>
                <button
                  type="button"
                  className="session-button secondary"
                  onClick={() => {
                    if (providersBackStep === 4) {
                      setWorkspaceProvidersEditing(false);
                      setWorkspaceStep(4);
                      return;
                    }
                    setWorkspaceStep(1);
                  }}
                  disabled={formDisabled}
                >
                  {t("Back")}
                </button>
                <button
                  type="submit"
                  form="providers-form"
                  className="session-button primary"
                  disabled={formDisabled}
                >
                  {workspaceBusy
                    ? t("Validating...")
                    : workspaceProvidersEditing
                      ? t("Save")
                      : t("Continue")}
                </button>
              </>
            ) : showStep3 ? (
              <button
                type="button"
                className="session-button primary"
                onClick={() => setWorkspaceStep(4)}
                disabled={formDisabled}
              >
                {t("Continue")}
              </button>
            ) : showStep4 ? (
              sessionMode === "existing" ? (
                <button
                  type="button"
                  className="session-button secondary session-footer-full"
                  disabled={formDisabled}
                  onClick={() => {
                    setWorkspaceProvidersEditing(true);
                    setWorkspaceError("");
                    setProvidersBackStep(4);
                    loadWorkspaceProviders();
                    setWorkspaceStep(2);
                  }}
                >
                  {t("AI providers")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="session-button secondary"
                    disabled={formDisabled}
                    onClick={() => {
                      setWorkspaceProvidersEditing(true);
                      setWorkspaceError("");
                      setProvidersBackStep(4);
                      loadWorkspaceProviders();
                      setWorkspaceStep(2);
                    }}
                  >
                    {t("AI providers")}
                  </button>
                  <button
                    type="submit"
                    form="repo-form"
                    className="session-button primary"
                    disabled={formDisabled}
                  >
                    {sessionRequested ? t("Loading...") : t("Clone")}
                  </button>
                </>
              )
            ) : null}
          </div>
        </div>
        <aside className="session-info">
          <div className="session-info-card">
            <div className="session-info-title">
              <span className="session-info-icon" aria-hidden="true">
                ℹ️
              </span>
              {infoContent.title}
            </div>
            {infoContent.paragraphs?.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
            {infoContent.securityLink ? (
              <p>
                {t(
                  "Vibe80 strictly controls access to resources (Git credentials and internet) using sandboxing. "
                )}
                <a
                  className="session-info-link"
                  href="https://vibe80.ai/security"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("Click here to learn more.")}
                </a>
              </p>
            ) : null}
          </div>
        </aside>
      </div>
      {toast && (
        <div className="toast-container">
          <div className={`toast is-${toast.type || "success"}`}>
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}
