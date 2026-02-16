import { useCallback, useEffect } from "react";

const getSessionIdFromUrl = () =>
  new URLSearchParams(window.location.search).get("session");

export default function useSessionLifecycle({
  t,
  apiFetch,
  workspaceToken,
  handleLeaveWorkspace,
  repoUrl,
  setRepoUrl,
  repoInput,
  sessionNameInput,
  repoAuth,
  setRepoAuth,
  authMode,
  sshKeyInput,
  httpUsername,
  httpPassword,
  sessionMode,
  sessionRequested,
  setSessionRequested,
  defaultInternetAccess,
  defaultDenyGitCredentialsAccess,
  attachmentSession,
  setAttachmentSession,
  setAttachmentsLoading,
  setAttachmentsError,
  setWorkspaceToken,
  setWorkspaceMode,
  setWorkspaceError,
  setOpenAiLoginPending,
  setOpenAiLoginRequest,
}) {
  useEffect(() => {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId || !workspaceToken || attachmentSession?.sessionId) {
      return;
    }
    const resumeSession = async () => {
      try {
        setSessionRequested(true);
        setAttachmentsError("");
        const response = await apiFetch(
          `/api/v1/sessions/${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          throw new Error(t("Session not found."));
        }
        const data = await response.json();
        setAttachmentSession(data);
      } catch (error) {
        setAttachmentsError(
          error.message || t("Unable to resume the session.")
        );
        setSessionRequested(false);
      }
    };

    resumeSession();
  }, [
    workspaceToken,
    attachmentSession?.sessionId,
    apiFetch,
    handleLeaveWorkspace,
    setAttachmentSession,
    setAttachmentsError,
    setSessionRequested,
    t,
  ]);

  useEffect(() => {
    if (!repoUrl || attachmentSession?.sessionId || sessionMode !== "new") {
      return;
    }
    const createAttachmentSession = async () => {
      try {
        setAttachmentsLoading(true);
        setAttachmentsError("");
        const payload = {
          repoUrl,
          defaultInternetAccess,
          defaultDenyGitCredentialsAccess,
        };
        const trimmedName = sessionNameInput.trim();
        if (trimmedName) {
          payload.name = trimmedName;
        }
        if (repoAuth) {
          payload.auth = repoAuth;
        }
        const response = await apiFetch("/api/v1/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          let details = "";
          let errorType = "";
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              details = errorPayload.error;
            } else if (typeof errorPayload?.message === "string") {
              details = errorPayload.message;
            } else if (typeof errorPayload === "string") {
              details = errorPayload;
            }
            if (typeof errorPayload?.error_type === "string") {
              errorType = errorPayload.error_type;
            }
          } catch (parseError) {
            try {
              details = await response.text();
            } catch (readError) {
              details = "";
            }
          }
          const isInvalidToken =
            response.status === 401 &&
            (errorType === "WORKSPACE_TOKEN_INVALID" ||
              (typeof details === "string" &&
                details.toLowerCase().includes("invalid workspace token")));
          if (isInvalidToken) {
            setWorkspaceToken("");
            setWorkspaceMode("existing");
            setWorkspaceError(
              t("Invalid workspace token. Please sign in again.")
            );
            setAttachmentsError("");
            return;
          }
          const suffix = details ? `: ${details}` : "";
          if (response.status === 401 || response.status === 403) {
            throw new Error(
              t("Git authentication failed{{suffix}}.", { suffix })
            );
          }
          if (response.status === 404) {
            throw new Error(
              t("Git repository not found{{suffix}}.", { suffix })
            );
          }
          throw new Error(
            t(
              "Impossible de creer la session de pieces jointes (HTTP {{status}}{{statusText}}){{suffix}}.",
              {
                status: response.status,
                statusText: response.statusText ? ` ${response.statusText}` : "",
                suffix,
              }
            )
          );
        }
        const data = await response.json();
        setAttachmentSession(data);
      } catch (error) {
        setAttachmentsError(
          error.message || t("Unable to create the attachment session.")
        );
        setOpenAiLoginPending(false);
        setOpenAiLoginRequest(null);
      } finally {
        setAttachmentsLoading(false);
        setSessionRequested(false);
      }
    };

    createAttachmentSession();
  }, [
    repoUrl,
    repoAuth,
    attachmentSession?.sessionId,
    apiFetch,
    sessionMode,
    defaultInternetAccess,
    defaultDenyGitCredentialsAccess,
    sessionNameInput,
    setAttachmentSession,
    setAttachmentsError,
    setAttachmentsLoading,
    setOpenAiLoginPending,
    setOpenAiLoginRequest,
    setSessionRequested,
    setWorkspaceError,
    setWorkspaceMode,
    setWorkspaceToken,
    t,
  ]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("session", attachmentSession.sessionId);
    window.history.replaceState({}, "", url);
  }, [attachmentSession?.sessionId]);

  const handleResumeSession = useCallback(
    async (sessionId) => {
      if (!sessionId) {
        return;
      }
      try {
        setSessionRequested(true);
        setAttachmentsError("");
        const response = await apiFetch(
          `/api/v1/sessions/${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          throw new Error(t("Session not found."));
        }
        const data = await response.json();
        setAttachmentSession(data);
      } catch (error) {
        setAttachmentsError(
          error.message || t("Unable to resume the session.")
        );
        setSessionRequested(false);
      }
    },
    [
      apiFetch,
      setAttachmentSession,
      setAttachmentsError,
      setSessionRequested,
      t,
    ]
  );

  const onRepoSubmit = useCallback(
    (event) => {
      event.preventDefault();
      const hasSession = Boolean(attachmentSession?.sessionId);
      const trimmed = repoInput.trim();
      if (!hasSession && !trimmed) {
        setAttachmentsError("URL de depot git requise pour demarrer.");
        return;
      }
      let auth = null;
      if (!hasSession) {
        if (authMode === "ssh") {
          const trimmedKey = sshKeyInput.trim();
          if (!trimmedKey) {
            setAttachmentsError("Cle SSH privee requise pour demarrer.");
            return;
          }
          auth = { type: "ssh", privateKey: trimmedKey };
        }
        if (authMode === "http") {
          const user = httpUsername.trim();
          if (!user || !httpPassword) {
            setAttachmentsError(t("Username and password required."));
            return;
          }
          auth = { type: "http", username: user, password: httpPassword };
        }
      }
      setAttachmentsError("");
      if (!hasSession) {
        setSessionRequested(true);
        setRepoAuth(auth);
        setRepoUrl(trimmed);
      }
    },
    [
      attachmentSession?.sessionId,
      authMode,
      httpPassword,
      httpUsername,
      repoInput,
      setAttachmentsError,
      setRepoAuth,
      setRepoUrl,
      setSessionRequested,
      sshKeyInput,
      t,
    ]
  );

  return {
    handleResumeSession,
    onRepoSubmit,
  };
}
