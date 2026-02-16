import { useCallback, useEffect, useRef, useState } from "react";

const WORKSPACE_TOKEN_KEY = "workspaceToken";
const WORKSPACE_REFRESH_TOKEN_KEY = "workspaceRefreshToken";
const WORKSPACE_ID_KEY = "workspaceId";
const WORKSPACE_AUTH_CHANNEL = "workspace-auth";
const WORKSPACE_REFRESH_LOCK_KEY = "workspaceRefreshLock";
const REFRESH_LOCK_TTL_MS = 15000;
const REFRESH_WAIT_TIMEOUT_MS = 5000;
const REFRESH_RETRY_WAIT_MS = 1500;
const MONO_AUTH_GRANT_TYPE = "mono_auth_token";

const readWorkspaceToken = () => {
  try {
    return localStorage.getItem(WORKSPACE_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

const readWorkspaceRefreshToken = () => {
  try {
    return localStorage.getItem(WORKSPACE_REFRESH_TOKEN_KEY) || "";
  } catch {
    return "";
  }
};

const readWorkspaceId = () => {
  try {
    return localStorage.getItem(WORKSPACE_ID_KEY) || "";
  } catch {
    return "";
  }
};

const readMonoAuthTokenFromHash = () => {
  const hash = String(window.location.hash || "");
  if (!hash || !hash.startsWith("#")) {
    return "";
  }
  const raw = hash.slice(1);
  const params = new URLSearchParams(raw);
  return (params.get("mono_auth") || "").trim();
};

const defaultProvidersState = () => ({
  codex: {
    enabled: false,
    authType: "api_key",
    authValue: "",
    previousAuthType: "api_key",
  },
  claude: {
    enabled: false,
    authType: "api_key",
    authValue: "",
    previousAuthType: "api_key",
  },
});

const defaultAuthExpanded = () => ({
  codex: false,
  claude: false,
});

const defaultAuthFiles = () => ({
  codex: "",
  claude: "",
});

export default function useWorkspaceAuth({
  t,
  encodeBase64,
  copyTextToClipboard,
  extractRepoName,
  setSessionMode,
  showToast,
  getProviderAuthType,
}) {
  const [workspaceStep, setWorkspaceStep] = useState(1);
  const [workspaceMode, setWorkspaceMode] = useState("existing");
  const [workspaceIdInput, setWorkspaceIdInput] = useState(readWorkspaceId());
  const [workspaceSecretInput, setWorkspaceSecretInput] = useState("");
  const [workspaceToken, setWorkspaceToken] = useState(readWorkspaceToken());
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(
    readWorkspaceRefreshToken()
  );
  const [workspaceId, setWorkspaceId] = useState(readWorkspaceId());
  const [workspaceCreated, setWorkspaceCreated] = useState(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceSessions, setWorkspaceSessions] = useState([]);
  const [workspaceSessionsLoading, setWorkspaceSessionsLoading] = useState(false);
  const [workspaceSessionsError, setWorkspaceSessionsError] = useState("");
  const [workspaceSessionDeletingId, setWorkspaceSessionDeletingId] = useState(null);
  const [workspaceCopied, setWorkspaceCopied] = useState({
    id: false,
    secret: false,
  });
  const [workspaceProvidersEditing, setWorkspaceProvidersEditing] = useState(false);
  const [providersBackStep, setProvidersBackStep] = useState(1);
  const [workspaceAuthExpanded, setWorkspaceAuthExpanded] = useState(
    defaultAuthExpanded
  );
  const [workspaceAuthFiles, setWorkspaceAuthFiles] = useState(
    defaultAuthFiles
  );
  const [workspaceProviders, setWorkspaceProviders] = useState(
    defaultProvidersState
  );
  const [deploymentMode, setDeploymentMode] = useState(null);

  const tabIdRef = useRef(`tab-${Math.random().toString(36).slice(2)}-${Date.now()}`);
  const workspaceTokenRef = useRef(workspaceToken);
  const workspaceRefreshTokenRef = useRef(workspaceRefreshToken);
  const refreshInFlightRef = useRef(null);
  const refreshBroadcastChannelRef = useRef(null);
  const refreshBroadcastWaitersRef = useRef([]);
  const workspaceCopyTimersRef = useRef({ id: null, secret: null });

  const applyWorkspaceTokens = useCallback(
    ({ token = "", refreshToken = "" } = {}) => {
      if (typeof token === "string") {
        workspaceTokenRef.current = token;
        setWorkspaceToken(token);
      }
      if (typeof refreshToken === "string") {
        workspaceRefreshTokenRef.current = refreshToken;
        setWorkspaceRefreshToken(refreshToken);
      }
    },
    []
  );

  const notifyRefreshWaiters = useCallback((token) => {
    const waiters = refreshBroadcastWaitersRef.current.splice(0);
    waiters.forEach((resolve) => {
      try {
        resolve(token || null);
      } catch {
        // Ignore waiter errors.
      }
    });
  }, []);

  const waitForTokenBroadcast = useCallback((timeoutMs = REFRESH_WAIT_TIMEOUT_MS) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        const index = refreshBroadcastWaitersRef.current.indexOf(onResolve);
        if (index >= 0) {
          refreshBroadcastWaitersRef.current.splice(index, 1);
        }
        resolve(null);
      }, timeoutMs);
      const onResolve = (token) => {
        clearTimeout(timeout);
        resolve(token || null);
      };
      refreshBroadcastWaitersRef.current.push(onResolve);
    });
  }, []);

  const broadcastAuthEvent = useCallback((type, payload = {}) => {
    const channel = refreshBroadcastChannelRef.current;
    if (!channel) {
      return;
    }
    try {
      channel.postMessage({
        type,
        sourceTabId: tabIdRef.current,
        ...payload,
      });
    } catch {
      // Ignore broadcast failures.
    }
  }, []);

  const getLatestWorkspaceTokens = useCallback(() => {
    const token = readWorkspaceToken();
    const refreshToken = readWorkspaceRefreshToken();
    return {
      token: token || workspaceTokenRef.current || "",
      refreshToken: refreshToken || workspaceRefreshTokenRef.current || "",
    };
  }, []);

  const acquireRefreshLock = useCallback(() => {
    const now = Date.now();
    const nextPayload = {
      owner: tabIdRef.current,
      expiresAt: now + REFRESH_LOCK_TTL_MS,
    };
    try {
      const raw = localStorage.getItem(WORKSPACE_REFRESH_LOCK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed.expiresAt === "number" &&
          parsed.expiresAt > now &&
          parsed.owner !== tabIdRef.current
        ) {
          return false;
        }
      }
      localStorage.setItem(WORKSPACE_REFRESH_LOCK_KEY, JSON.stringify(nextPayload));
      const confirmedRaw = localStorage.getItem(WORKSPACE_REFRESH_LOCK_KEY);
      if (!confirmedRaw) {
        return false;
      }
      const confirmed = JSON.parse(confirmedRaw);
      return confirmed?.owner === tabIdRef.current;
    } catch {
      return true;
    }
  }, []);

  const releaseRefreshLock = useCallback(() => {
    try {
      const raw = localStorage.getItem(WORKSPACE_REFRESH_LOCK_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (parsed?.owner === tabIdRef.current) {
        localStorage.removeItem(WORKSPACE_REFRESH_LOCK_KEY);
      }
    } catch {
      // Ignore release errors.
    }
  }, []);

  const handleLeaveWorkspace = useCallback(() => {
    applyWorkspaceTokens({ token: "", refreshToken: "" });
    setWorkspaceId("");
    setWorkspaceIdInput("");
    setWorkspaceSecretInput("");
    setWorkspaceCreated(null);
    setWorkspaceError("");
    setWorkspaceMode("existing");
    setWorkspaceSessions([]);
    setWorkspaceSessionsError("");
    setWorkspaceSessionsLoading(false);
    setWorkspaceStep(1);
    setWorkspaceProvidersEditing(false);
    if (setSessionMode) {
      setSessionMode("new");
    }
    broadcastAuthEvent("workspace_left", {});
    notifyRefreshWaiters(null);
  }, [applyWorkspaceTokens, broadcastAuthEvent, notifyRefreshWaiters, setSessionMode]);

  const refreshWorkspaceToken = useCallback(async () => {
    const activeRefreshToken =
      workspaceRefreshTokenRef.current || getLatestWorkspaceTokens().refreshToken;
    if (!activeRefreshToken) {
      return null;
    }
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    const promise = (async () => {
      let lockAcquired = false;
      try {
        lockAcquired = acquireRefreshLock();
        if (!lockAcquired) {
          const syncedToken = await waitForTokenBroadcast();
          if (syncedToken) {
            return syncedToken;
          }
          const latest = getLatestWorkspaceTokens();
          if (latest.token && latest.token !== workspaceTokenRef.current) {
            applyWorkspaceTokens({
              token: latest.token,
              refreshToken: latest.refreshToken || workspaceRefreshTokenRef.current,
            });
            return latest.token;
          }
          lockAcquired = acquireRefreshLock();
          if (!lockAcquired) {
            return null;
          }
        }

        broadcastAuthEvent("refresh_started", { at: Date.now() });
        const latestBeforeRefresh = getLatestWorkspaceTokens();
        const refreshTokenForCall = latestBeforeRefresh.refreshToken || activeRefreshToken;
        if (!refreshTokenForCall) {
          return null;
        }

        const response = await fetch("/api/v1/v1/workspaces/refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken: refreshTokenForCall }),
        });
        if (!response.ok) {
          const syncedToken = await waitForTokenBroadcast(REFRESH_RETRY_WAIT_MS);
          if (syncedToken) {
            return syncedToken;
          }
          const latest = getLatestWorkspaceTokens();
          if (latest.token && latest.token !== workspaceTokenRef.current) {
            applyWorkspaceTokens({
              token: latest.token,
              refreshToken: latest.refreshToken || workspaceRefreshTokenRef.current,
            });
            return latest.token;
          }
          return null;
        }
        const data = await response.json();
        const nextToken = data?.workspaceToken || "";
        const nextRefresh = data?.refreshToken || "";
        if (nextToken && nextRefresh) {
          applyWorkspaceTokens({ token: nextToken, refreshToken: nextRefresh });
          broadcastAuthEvent("refresh_succeeded", {
            at: Date.now(),
            workspaceToken: nextToken,
            refreshToken: nextRefresh,
          });
          notifyRefreshWaiters(nextToken);
          return nextToken;
        }
        return null;
      } catch {
        const syncedToken = await waitForTokenBroadcast(REFRESH_RETRY_WAIT_MS);
        if (syncedToken) {
          return syncedToken;
        }
        return null;
      } finally {
        if (lockAcquired) {
          releaseRefreshLock();
        }
        refreshInFlightRef.current = null;
      }
    })();
    refreshInFlightRef.current = promise;
    return promise;
  }, [
    acquireRefreshLock,
    applyWorkspaceTokens,
    broadcastAuthEvent,
    getLatestWorkspaceTokens,
    notifyRefreshWaiters,
    releaseRefreshLock,
    waitForTokenBroadcast,
  ]);

  useEffect(() => {
    workspaceTokenRef.current = workspaceToken;
  }, [workspaceToken]);

  useEffect(() => {
    workspaceRefreshTokenRef.current = workspaceRefreshToken;
  }, [workspaceRefreshToken]);

  useEffect(() => {
    if (typeof BroadcastChannel !== "function") {
      return undefined;
    }
    const channel = new BroadcastChannel(WORKSPACE_AUTH_CHANNEL);
    refreshBroadcastChannelRef.current = channel;
    const onMessage = (event) => {
      const payload = event?.data;
      if (!payload || payload.sourceTabId === tabIdRef.current) {
        return;
      }
      if (payload.type === "refresh_succeeded") {
        applyWorkspaceTokens({
          token: payload.workspaceToken || "",
          refreshToken: payload.refreshToken || "",
        });
        notifyRefreshWaiters(payload.workspaceToken || null);
      } else if (payload.type === "workspace_left") {
        applyWorkspaceTokens({ token: "", refreshToken: "" });
        setWorkspaceId("");
      }
    };
    channel.addEventListener("message", onMessage);
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
      refreshBroadcastChannelRef.current = null;
    };
  }, [applyWorkspaceTokens, notifyRefreshWaiters]);

  useEffect(() => {
    const onStorage = (event) => {
      if (!event || !event.key) {
        return;
      }
      if (event.key === WORKSPACE_TOKEN_KEY) {
        const nextToken = event.newValue || "";
        workspaceTokenRef.current = nextToken;
        setWorkspaceToken(nextToken);
        if (nextToken) {
          notifyRefreshWaiters(nextToken);
        }
        return;
      }
      if (event.key === WORKSPACE_REFRESH_TOKEN_KEY) {
        const nextRefreshToken = event.newValue || "";
        workspaceRefreshTokenRef.current = nextRefreshToken;
        setWorkspaceRefreshToken(nextRefreshToken);
        return;
      }
      if (event.key === WORKSPACE_ID_KEY) {
        setWorkspaceId(event.newValue || "");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, [notifyRefreshWaiters]);

  const apiFetch = useCallback(
    async (input, init = {}) => {
      const headers = new Headers(init.headers || {});
      const tokenForRequest = workspaceTokenRef.current || workspaceToken;
      if (tokenForRequest) {
        headers.set("Authorization", `Bearer ${tokenForRequest}`);
      }
      const response = await fetch(input, { ...init, headers });
      if (response.status !== 401) {
        return response;
      }
      const refreshedToken = await refreshWorkspaceToken();
      if (!refreshedToken) {
        const latestToken = workspaceTokenRef.current || readWorkspaceToken();
        if (latestToken && latestToken !== tokenForRequest) {
          const retryHeaders = new Headers(init.headers || {});
          retryHeaders.set("Authorization", `Bearer ${latestToken}`);
          return fetch(input, { ...init, headers: retryHeaders });
        }
        handleLeaveWorkspace();
        return response;
      }
      const retryHeaders = new Headers(init.headers || {});
      retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
      return fetch(input, { ...init, headers: retryHeaders });
    },
    [workspaceToken, refreshWorkspaceToken, handleLeaveWorkspace]
  );

  useEffect(() => {
    let cancelled = false;
    const fetchHealth = async () => {
      try {
        const response = await fetch("/api/v1/v1/health");
        if (!response.ok) {
          return;
        }
        const data = await response.json();
        if (!cancelled && data?.deploymentMode) {
          setDeploymentMode(data.deploymentMode);
        }
      } catch {
        // Ignore health errors.
      }
    };
    fetchHealth();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const monoAuthToken = readMonoAuthTokenFromHash();
    if (!monoAuthToken) {
      return;
    }
    let cancelled = false;
    const consumeMonoAuthToken = async () => {
      try {
        const response = await fetch("/api/v1/v1/workspaces/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grantType: MONO_AUTH_GRANT_TYPE,
            monoAuthToken,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          const errorMessage =
            payload?.error || t("Automatic mono-user authentication failed.");
          if (!cancelled) {
            setWorkspaceError(errorMessage);
          }
          return;
        }
        const data = await response.json();
        if (!data?.workspaceToken) {
          return;
        }
        if (!cancelled) {
          setWorkspaceToken(data.workspaceToken || "");
          setWorkspaceRefreshToken(data.refreshToken || "");
          setWorkspaceId("default");
          setWorkspaceIdInput("default");
          setWorkspaceStep(4);
          setWorkspaceError("");
        }
      } catch {
        if (!cancelled) {
          setWorkspaceError(t("Automatic mono-user authentication failed."));
        }
      } finally {
        const url = new URL(window.location.href);
        if (url.hash.includes("mono_auth=")) {
          url.hash = "";
          window.history.replaceState({}, "", url);
        }
      }
    };
    consumeMonoAuthToken();
    return () => {
      cancelled = true;
    };
  }, [
    workspaceToken,
    t,
    setWorkspaceId,
    setWorkspaceIdInput,
    setWorkspaceRefreshToken,
    setWorkspaceStep,
    setWorkspaceToken,
    setWorkspaceError,
  ]);

  useEffect(() => {
    try {
      if (workspaceToken) {
        localStorage.setItem(WORKSPACE_TOKEN_KEY, workspaceToken);
      } else {
        localStorage.removeItem(WORKSPACE_TOKEN_KEY);
      }
    } catch {
      // Ignore storage errors (private mode, quota).
    }
  }, [workspaceToken]);

  useEffect(() => {
    try {
      if (workspaceRefreshToken) {
        localStorage.setItem(WORKSPACE_REFRESH_TOKEN_KEY, workspaceRefreshToken);
      } else {
        localStorage.removeItem(WORKSPACE_REFRESH_TOKEN_KEY);
      }
    } catch {
      // Ignore storage errors (private mode, quota).
    }
  }, [workspaceRefreshToken]);

  useEffect(() => {
    try {
      if (workspaceId) {
        localStorage.setItem(WORKSPACE_ID_KEY, workspaceId);
      } else {
        localStorage.removeItem(WORKSPACE_ID_KEY);
      }
    } catch {
      // Ignore storage errors (private mode, quota).
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceToken) {
      setWorkspaceStep(1);
      return;
    }
    setWorkspaceStep((current) => {
      if (current >= 3) {
        return current;
      }
      return 4;
    });
  }, [workspaceToken]);

  const loadWorkspaceSessions = useCallback(async () => {
    if (!workspaceToken) {
      return;
    }
    setWorkspaceSessionsLoading(true);
    setWorkspaceSessionsError("");
    try {
      const response = await apiFetch("/api/v1/v1/sessions");
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t("Unable to load sessions."));
      }
      const data = await response.json();
      const list = Array.isArray(data?.sessions) ? data.sessions : [];
      setWorkspaceSessions(list);
    } catch (error) {
      setWorkspaceSessionsError(
        error.message || t("Unable to load sessions.")
      );
    } finally {
      setWorkspaceSessionsLoading(false);
    }
  }, [apiFetch, workspaceToken, handleLeaveWorkspace, t]);

  useEffect(() => {
    if (!workspaceToken || workspaceStep !== 4) {
      return;
    }
    loadWorkspaceSessions();
  }, [workspaceStep, workspaceToken, loadWorkspaceSessions]);

  const loadWorkspaceProviders = useCallback(async () => {
    const activeWorkspaceId = (workspaceId || workspaceIdInput || "").trim();
    if (!activeWorkspaceId) {
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const response = await apiFetch(
        `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}`
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || t("Unable to load providers."));
      }
      const data = await response.json();
      const providers = data?.providers || {};
      setWorkspaceProviders((current) => ({
        codex: {
          ...current.codex,
          enabled: Boolean(providers?.codex?.enabled),
          authType: providers?.codex?.auth?.type || "api_key",
          previousAuthType: providers?.codex?.auth?.type || "api_key",
          authValue: "",
        },
        claude: {
          ...current.claude,
          enabled: Boolean(providers?.claude?.enabled),
          authType: providers?.claude?.auth?.type || "api_key",
          previousAuthType: providers?.claude?.auth?.type || "api_key",
          authValue: "",
        },
      }));
      setWorkspaceAuthExpanded((current) => ({
        ...current,
        codex: Boolean(providers?.codex?.enabled),
        claude: Boolean(providers?.claude?.enabled),
      }));
      setWorkspaceAuthFiles(defaultAuthFiles());
    } catch (error) {
      setWorkspaceError(error.message || t("Unable to load providers."));
    } finally {
      setWorkspaceBusy(false);
    }
  }, [apiFetch, handleLeaveWorkspace, t, workspaceId, workspaceIdInput]);

  const handleWorkspaceSubmit = async (event) => {
    event.preventDefault();
    setWorkspaceError("");
    setWorkspaceBusy(true);
    try {
      if (workspaceMode === "existing") {
        const workspaceIdValue = workspaceIdInput.trim();
        const secretValue = workspaceSecretInput.trim();
        if (!workspaceIdValue || !secretValue) {
          throw new Error(t("Workspace ID and secret are required."));
        }
        const response = await apiFetch("/api/v1/v1/workspaces/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspaceIdValue,
            workspaceSecret: secretValue,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || t("Authentication failed."));
        }
        const data = await response.json();
        setWorkspaceToken(data.workspaceToken || "");
        setWorkspaceRefreshToken(data.refreshToken || "");
        setWorkspaceId(workspaceIdValue);
        setWorkspaceStep(4);
        return;
      }
      setWorkspaceProvidersEditing(false);
      setProvidersBackStep(1);
      setWorkspaceStep(2);
    } catch (error) {
      setWorkspaceError(
        error.message || t("Workspace configuration failed.")
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleWorkspaceProvidersSubmit = async (event) => {
    event.preventDefault();
    setWorkspaceError("");
    setWorkspaceBusy(true);
    try {
      const providersPayload = {};
      ["codex", "claude"].forEach((provider) => {
        const config = workspaceProviders[provider];
        if (!config?.enabled) {
          providersPayload[provider] = { enabled: false };
          return;
        }
        const trimmedValue = (config.authValue || "").trim();
        const type = getProviderAuthType(provider, config) || "api_key";
        if (
          workspaceProvidersEditing &&
          config.previousAuthType &&
          type !== config.previousAuthType &&
          !trimmedValue
        ) {
          throw new Error(t("Key required for {{provider}}.", { provider }));
        }
        if (!workspaceProvidersEditing && !trimmedValue) {
          throw new Error(t("Key required for {{provider}}.", { provider }));
        }
        if (trimmedValue) {
          const value =
            type === "auth_json_b64" && encodeBase64
              ? encodeBase64(trimmedValue)
              : trimmedValue;
          providersPayload[provider] = {
            enabled: true,
            auth: { type, value },
          };
        } else {
          providersPayload[provider] = {
            enabled: true,
            auth: { type },
          };
        }
      });
      if (Object.keys(providersPayload).length === 0) {
        throw new Error(t("Select at least one provider."));
      }
      if (workspaceProvidersEditing) {
        const activeWorkspaceId = (workspaceId || workspaceIdInput || "").trim();
        if (!activeWorkspaceId) {
          throw new Error(t("Workspace ID required."));
        }
        const updateResponse = await apiFetch(
          `/api/workspaces/${encodeURIComponent(activeWorkspaceId)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providers: providersPayload }),
          }
        );
        if (!updateResponse.ok) {
          const payload = await updateResponse.json().catch(() => null);
          throw new Error(
            payload?.error || t("Workspace update failed.")
          );
        }
        await updateResponse.json().catch(() => null);
        setWorkspaceProvidersEditing(false);
        setWorkspaceStep(4);
        showToast?.(t("AI providers updated."), "success");
        return;
      }
      const createResponse = await apiFetch("/api/v1/v1/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: providersPayload }),
      });
      if (!createResponse.ok) {
        const payload = await createResponse.json().catch(() => null);
        throw new Error(payload?.error || t("Workspace creation failed."));
      }
      const created = await createResponse.json();
      setWorkspaceCreated(created);
      setWorkspaceId(created.workspaceId);
      setWorkspaceIdInput(created.workspaceId);
      const loginResponse = await apiFetch("/api/v1/v1/workspaces/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: created.workspaceId,
          workspaceSecret: created.workspaceSecret,
        }),
      });
      if (!loginResponse.ok) {
        const payload = await loginResponse.json().catch(() => null);
        throw new Error(payload?.error || t("Authentication failed."));
      }
      const loginData = await loginResponse.json();
      setWorkspaceToken(loginData.workspaceToken || "");
      setWorkspaceRefreshToken(loginData.refreshToken || "");
      setWorkspaceStep(3);
    } catch (error) {
      setWorkspaceError(
        error.message || t("Workspace configuration failed.")
      );
    } finally {
      setWorkspaceBusy(false);
    }
  };

  const handleWorkspaceCopy = useCallback((key, value) => {
    if (!value) {
      return;
    }
    if (copyTextToClipboard) {
      copyTextToClipboard(value);
    }
    setWorkspaceCopied((current) => ({ ...current, [key]: true }));
    const timers = workspaceCopyTimersRef.current;
    if (timers[key]) {
      clearTimeout(timers[key]);
    }
    timers[key] = setTimeout(() => {
      setWorkspaceCopied((current) => ({ ...current, [key]: false }));
      timers[key] = null;
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      Object.values(workspaceCopyTimersRef.current || {}).forEach((timer) => {
        if (timer) {
          clearTimeout(timer);
        }
      });
    };
  }, []);

  const handleDeleteSession = async (session) => {
    const sessionId = session?.sessionId;
    if (!sessionId) {
      return;
    }
    const repoName = extractRepoName?.(session?.repoUrl || "");
    const title = session?.name || repoName || sessionId;
    const shouldDelete = window.confirm(
      t("Supprimer la session \"{{title}}\" ? Cette action est irreversible.", {
        title,
      })
    );
    if (!shouldDelete) {
      return;
    }
    try {
      setWorkspaceSessionDeletingId(sessionId);
      setWorkspaceSessionsError("");
      const response = await apiFetch(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        { method: "DELETE" }
      );
      if (!response.ok) {
        let details = "";
        try {
          const payload = await response.json();
          if (typeof payload?.error === "string") {
            details = payload.error;
          }
        } catch {
          // Ignore parse errors.
        }
        const suffix = details ? `: ${details}` : "";
        throw new Error(
          t("Unable to delete the session{{suffix}}.", { suffix })
        );
      }
      await loadWorkspaceSessions();
      showToast?.(t("Session \"{{title}}\" supprimee.", { title }), "success");
    } catch (error) {
      setWorkspaceSessionsError(
        error.message || t("Unable to delete the session.")
      );
    } finally {
      setWorkspaceSessionDeletingId(null);
    }
  };

  return {
    apiFetch,
    deploymentMode,
    handleDeleteSession,
    handleLeaveWorkspace,
    handleWorkspaceCopy,
    handleWorkspaceProvidersSubmit,
    handleWorkspaceSubmit,
    loadWorkspaceProviders,
    loadWorkspaceSessions,
    providersBackStep,
    refreshWorkspaceToken,
    setProvidersBackStep,
    setWorkspaceAuthExpanded,
    setWorkspaceAuthFiles,
    setWorkspaceError,
    setWorkspaceId,
    setWorkspaceIdInput,
    setWorkspaceMode,
    setWorkspaceProviders,
    setWorkspaceProvidersEditing,
    setWorkspaceRefreshToken,
    setWorkspaceSecretInput,
    setWorkspaceStep,
    setWorkspaceToken,
    workspaceAuthExpanded,
    workspaceAuthFiles,
    workspaceBusy,
    workspaceCopied,
    workspaceCreated,
    workspaceError,
    workspaceId,
    workspaceIdInput,
    workspaceMode,
    workspaceProviders,
    workspaceProvidersEditing,
    workspaceSecretInput,
    workspaceSessionDeletingId,
    workspaceSessions,
    workspaceSessionsError,
    workspaceSessionsLoading,
    workspaceStep,
    workspaceToken,
  };
}
