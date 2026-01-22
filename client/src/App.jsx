import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "@uiw/react-markdown-preview/markdown.css";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import WorktreeTabs from "./components/WorktreeTabs.jsx";

const getSessionIdFromUrl = () =>
  new URLSearchParams(window.location.search).get("session");

const getRepositoryFromUrl = () =>
  new URLSearchParams(window.location.search).get("repository");

const getInitialRepoUrl = () => {
  const sessionId = getSessionIdFromUrl();
  if (sessionId) {
    return "";
  }
  const repoFromQuery = getRepositoryFromUrl();
  const trimmed = repoFromQuery ? repoFromQuery.trim() : "";
  return trimmed || "";
};

const wsUrl = (sessionId) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  return `${protocol}://${window.location.host}/ws${query}`;
};

const terminalWsUrl = (sessionId) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  return `${protocol}://${window.location.host}/terminal${query}`;
};

const extractChoices = (text) => {
  const pattern =
    /<!--\s*vibecoder:choices\s*([^>]*)-->([\s\S]*?)<!--\s*\/vibecoder:choices\s*-->/g;
  const blocks = [];
  let cleaned = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    cleaned += text.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const question = match[1]?.trim();
    const choices = match[2]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (choices.length) {
      blocks.push({ question, choices });
    }
  }

  if (!blocks.length) {
    return { cleanedText: text, blocks: [] };
  }

  cleaned += text.slice(lastIndex);
  return { cleanedText: cleaned.trim(), blocks };
};

const MAX_USER_DISPLAY_LENGTH = 1024;
const REPO_HISTORY_KEY = "repoHistory";
const AUTH_MODE_KEY = "authMode";
const OPENAI_AUTH_MODE_KEY = "openAiAuthMode";
const LLM_PROVIDER_KEY = "llmProvider";
const CHAT_COMMANDS_VISIBLE_KEY = "chatCommandsVisible";
const NOTIFICATIONS_ENABLED_KEY = "notificationsEnabled";
const MAX_REPO_HISTORY = 10;
const SOCKET_PING_INTERVAL_MS = 25000;
const SOCKET_PONG_GRACE_MS = 8000;

const getTruncatedText = (text, limit) => {
  if (!text) {
    return "";
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}…`;
};

const readRepoHistory = () => {
  try {
    const raw = localStorage.getItem(REPO_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch (error) {
    return [];
  }
};

const readAuthMode = () => {
  try {
    const stored = localStorage.getItem(AUTH_MODE_KEY);
    if (stored === "ssh" || stored === "http" || stored === "none") {
      return stored;
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return "none";
};

const readOpenAiAuthMode = () => {
  try {
    const stored = localStorage.getItem(OPENAI_AUTH_MODE_KEY);
    if (stored === "apiKey" || stored === "authFile") {
      return stored;
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return "apiKey";
};

const readChatCommandsVisible = () => {
  try {
    const stored = localStorage.getItem(CHAT_COMMANDS_VISIBLE_KEY);
    if (stored === "true" || stored === "false") {
      return stored === "true";
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return true;
};

const readNotificationsEnabled = () => {
  try {
    const stored = localStorage.getItem(NOTIFICATIONS_ENABLED_KEY);
    if (stored === "true" || stored === "false") {
      return stored === "true";
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return true;
};

const readLlmProvider = () => {
  try {
    const stored = localStorage.getItem(LLM_PROVIDER_KEY);
    if (stored === "codex" || stored === "claude") {
      return stored;
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return "codex";
};

const mergeRepoHistory = (history, url) => {
  const trimmed = url.trim();
  if (!trimmed) {
    return history;
  }
  const next = [trimmed, ...history.filter((entry) => entry !== trimmed)].slice(
    0,
    MAX_REPO_HISTORY
  );
  if (
    next.length === history.length &&
    next.every((entry, index) => entry === history[index])
  ) {
    return history;
  }
  return next;
};

const downloadTextFile = (filename, content, type) => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

const formatExportName = (base, extension) => {
  const safeBase = base || "chat";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${safeBase}-${stamp}.${extension}`;
};

const extractRepoName = (url) => {
  if (!url) {
    return "";
  }
  const trimmed = url.trim().replace(/\/+$/, "");
  const withoutQuery = trimmed.split(/[?#]/)[0];
  const match = withoutQuery.match(/([^/:]+)$/);
  return match ? match[1] : "";
};

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("Connexion...");
  const [processing, setProcessing] = useState(false);
  const [activity, setActivity] = useState("");
  const [connected, setConnected] = useState(false);
  const [attachmentSession, setAttachmentSession] = useState(null);
  const [attachments, setAttachments] = useState([]);
  const [selectedAttachments, setSelectedAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState("");
  const [repoUrl, setRepoUrl] = useState(getInitialRepoUrl);
  const [repoInput, setRepoInput] = useState(getInitialRepoUrl);
  const [repoAuth, setRepoAuth] = useState(null);
  const [authMode, setAuthMode] = useState(readAuthMode);
  const [sshKeyInput, setSshKeyInput] = useState("");
  const [httpUsername, setHttpUsername] = useState("");
  const [httpPassword, setHttpPassword] = useState("");
  const [llmProvider, setLlmProvider] = useState(readLlmProvider);
  const [providerSwitching, setProviderSwitching] = useState(false);
  const [openAiAuthMode, setOpenAiAuthMode] = useState(readOpenAiAuthMode);
  const [openAiAuthFile, setOpenAiAuthFile] = useState(null);
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [openAiLoginError, setOpenAiLoginError] = useState("");
  const [openAiLoginPending, setOpenAiLoginPending] = useState(false);
  const [openAiLoginRequest, setOpenAiLoginRequest] = useState(null);
  const [openAiReady, setOpenAiReady] = useState(() =>
    Boolean(getSessionIdFromUrl())
  );
  const [claudeAuthFile, setClaudeAuthFile] = useState(null);
  const [claudeLoginError, setClaudeLoginError] = useState("");
  const [claudeLoginPending, setClaudeLoginPending] = useState(false);
  const [claudeReady, setClaudeReady] = useState(() =>
    Boolean(getSessionIdFromUrl())
  );
  const [appServerReady, setAppServerReady] = useState(false);
  const [sessionRequested, setSessionRequested] = useState(() =>
    Boolean(getInitialRepoUrl())
  );
  const [showChatCommands, setShowChatCommands] = useState(
    readChatCommandsVisible
  );
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    readNotificationsEnabled
  );
  const soundEnabled = notificationsEnabled;
  const [choiceSelections, setChoiceSelections] = useState({});
  const [activePane, setActivePane] = useState("chat");
  const [repoDiff, setRepoDiff] = useState({ status: "", diff: "" });
  const [backlog, setBacklog] = useState([]);
  const [currentTurnId, setCurrentTurnId] = useState(null);
  const [rpcLogs, setRpcLogs] = useState([]);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState("");
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const [sideTab, setSideTab] = useState("attachments");
  const [sideOpen, setSideOpen] = useState(false);
  // Worktree states for parallel LLM requests
  const [worktrees, setWorktrees] = useState(new Map());
  const [activeWorktreeId, setActiveWorktreeId] = useState("main"); // "main" = legacy mode, other = worktree mode
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    window.matchMedia("(max-width: 1024px)").matches
  );
  const [commandPanelOpen, setCommandPanelOpen] = useState({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [repoHistory, setRepoHistory] = useState(() => readRepoHistory());
  const socketRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const settingsRef = useRef(null);
  const moreMenuRef = useRef(null);
  const branchRef = useRef(null);
  const terminalContainerRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalFitRef = useRef(null);
  const terminalDisposableRef = useRef(null);
  const terminalSocketRef = useRef(null);
  const terminalSessionRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const closingRef = useRef(false);
  const lastNotifiedIdRef = useRef(null);
  const audioContextRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const lastPongRef = useRef(0);
  const messagesRef = useRef([]);

  const messageIndex = useMemo(() => new Map(), []);
  const commandIndex = useMemo(() => new Map(), []);
  const repoName = useMemo(
    () => extractRepoName(attachmentSession?.repoUrl),
    [attachmentSession?.repoUrl]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const choicesKey = useMemo(
    () =>
      attachmentSession?.sessionId
        ? `choices:${attachmentSession.sessionId}`
        : null,
    [attachmentSession?.sessionId]
  );
  const backlogKey = useMemo(
    () =>
      attachmentSession?.sessionId
        ? `backlog:${attachmentSession.sessionId}`
        : null,
    [attachmentSession?.sessionId]
  );
  const selectedAttachmentNames = useMemo(() => {
    const byPath = new Map((attachments || []).map((file) => [file.path, file]));
    return (selectedAttachments || [])
      .map((path) => byPath.get(path)?.name || path)
      .filter(Boolean);
  }, [attachments, selectedAttachments]);
  const diffFiles = useMemo(() => {
    if (!repoDiff.diff) {
      return [];
    }
    try {
      return parseDiff(repoDiff.diff);
    } catch (error) {
      return [];
    }
  }, [repoDiff.diff]);
  const diffStatusLines = useMemo(
    () =>
      (repoDiff.status || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [repoDiff.status]
  );
  const groupedMessages = useMemo(() => {
    const grouped = [];
    (messages || []).forEach((message) => {
      if (message?.role === "commandExecution") {
        const last = grouped[grouped.length - 1];
        if (last?.groupType === "commandExecution") {
          last.items.push(message);
        } else {
          grouped.push({
            groupType: "commandExecution",
            id: `command-group-${message.id}`,
            items: [message],
          });
        }
        return;
      }
      grouped.push(message);
    });
    return grouped;
  }, [messages]);
  const [logFilter, setLogFilter] = useState("all");
  const formattedRpcLogs = useMemo(
    () =>
      (rpcLogs || []).map((entry) => ({
        ...entry,
        timeLabel: entry?.timestamp
          ? new Date(entry.timestamp).toLocaleTimeString("fr-FR")
          : "",
      })),
    [rpcLogs]
  );
  const filteredRpcLogs = useMemo(() => {
    if (logFilter === "stdin") {
      return formattedRpcLogs.filter((entry) => entry.direction === "stdin");
    }
    if (logFilter === "stdout") {
      return formattedRpcLogs.filter((entry) => entry.direction === "stdout");
    }
    return formattedRpcLogs;
  }, [formattedRpcLogs, logFilter]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1024px)");
    const update = () => setIsMobileLayout(query.matches);
    update();
    if (query.addEventListener) {
      query.addEventListener("change", update);
      return () => query.removeEventListener("change", update);
    }
    query.addListener(update);
    return () => query.removeListener(update);
  }, []);

  useEffect(() => {
    if (!settingsOpen && !moreMenuOpen && !branchMenuOpen) {
      return;
    }
    const handlePointerDown = (event) => {
      const target = event.target;
      if (settingsOpen && settingsRef.current?.contains(target)) {
        return;
      }
      if (moreMenuOpen && moreMenuRef.current?.contains(target)) {
        return;
      }
      if (branchMenuOpen && branchRef.current?.contains(target)) {
        return;
      }
      setSettingsOpen(false);
      setMoreMenuOpen(false);
      setBranchMenuOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [settingsOpen, moreMenuOpen, branchMenuOpen]);

  useEffect(() => {
    if (!choicesKey) {
      setChoiceSelections({});
      return;
    }
    try {
      const stored = JSON.parse(localStorage.getItem(choicesKey) || "{}");
      setChoiceSelections(
        stored && typeof stored === "object" && !Array.isArray(stored)
          ? stored
          : {}
      );
    } catch (error) {
      setChoiceSelections({});
    }
  }, [choicesKey]);

  useEffect(() => {
    if (!choicesKey) {
      return;
    }
    localStorage.setItem(choicesKey, JSON.stringify(choiceSelections));
  }, [choiceSelections, choicesKey]);

  useEffect(() => {
    try {
      localStorage.setItem(AUTH_MODE_KEY, authMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [authMode]);

  useEffect(() => {
    try {
      localStorage.setItem(LLM_PROVIDER_KEY, llmProvider);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [llmProvider]);

  useEffect(() => {
    setOpenAiLoginError("");
    setClaudeLoginError("");
    setOpenAiLoginPending(false);
    setClaudeLoginPending(false);
  }, [llmProvider]);

  useEffect(() => {
    try {
      localStorage.setItem(OPENAI_AUTH_MODE_KEY, openAiAuthMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [openAiAuthMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_COMMANDS_VISIBLE_KEY,
        showChatCommands ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [showChatCommands]);

  useEffect(() => {
    try {
      localStorage.setItem(
        NOTIFICATIONS_ENABLED_KEY,
        notificationsEnabled ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [notificationsEnabled]);

  const loadBranches = useCallback(async () => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    setBranchLoading(true);
    setBranchError("");
    try {
      const response = await fetch(
        `/api/branches?session=${encodeURIComponent(attachmentSession.sessionId)}`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Impossible de charger les branches.");
      }
      setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      setCurrentBranch(payload.current || "");
    } catch (error) {
      setBranchError(error.message || "Impossible de charger les branches.");
    } finally {
      setBranchLoading(false);
    }
  }, [attachmentSession?.sessionId]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      setBranches([]);
      setCurrentBranch("");
      setBranchError("");
      setBranchMenuOpen(false);
      return;
    }
    loadBranches();
  }, [attachmentSession?.sessionId, loadBranches]);

  useEffect(() => {
    if (isMobileLayout) {
      setSideOpen(false);
    }
  }, [isMobileLayout]);

  const applyMessages = useCallback(
    (items = []) => {
      const normalized = items.map((item, index) => ({
        id: item.id || `history-${index}`,
        role: item.role,
        text: item.text,
      }));
      messageIndex.clear();
      commandIndex.clear();
      normalized.forEach((item, index) => {
        if (item.role === "assistant") {
          messageIndex.set(item.id, index);
        }
      });
      setMessages(normalized);
      setCommandPanelOpen({});
    },
    [messageIndex, commandIndex]
  );

  const mergeAndApplyMessages = useCallback(
    (incoming = []) => {
      if (!Array.isArray(incoming) || incoming.length === 0) {
        return;
      }
      const current = Array.isArray(messagesRef.current)
        ? messagesRef.current
        : [];
      const seen = new Set(
        current.map((item) => item?.id).filter(Boolean)
      );
      const merged = [...current];
      for (const item of incoming) {
        const id = item?.id;
        if (id && seen.has(id)) {
          continue;
        }
        if (id) {
          seen.add(id);
        }
        merged.push(item);
      }
      applyMessages(merged);
    },
    [applyMessages]
  );

  const resyncSession = useCallback(async () => {
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    try {
      const response = await fetch(
        `/api/session/${encodeURIComponent(sessionId)}`
      );
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data?.provider && data.provider !== llmProvider) {
        setLlmProvider(data.provider);
      }
      if (Array.isArray(data?.messages)) {
        applyMessages(data.messages);
      }
      if (data?.repoDiff) {
        setRepoDiff(data.repoDiff);
      }
      if (Array.isArray(data?.rpcLogs)) {
        setRpcLogs(data.rpcLogs);
      }
    } catch (error) {
      // Ignore resync failures; reconnect loop will retry.
    }
  }, [attachmentSession?.sessionId, applyMessages, llmProvider]);

  const requestMessageSync = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const current = Array.isArray(messagesRef.current)
      ? messagesRef.current
      : [];
    let lastSeenMessageId = null;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      if (current[i]?.id) {
        lastSeenMessageId = current[i].id;
        break;
      }
    }
    socket.send(
      JSON.stringify({
        type: "sync_messages",
        provider: llmProvider,
        lastSeenMessageId,
      })
    );
  }, [llmProvider]);

  const connectTerminal = useCallback(() => {
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    if (
      terminalSocketRef.current &&
      terminalSocketRef.current.readyState <= WebSocket.OPEN &&
      terminalSessionRef.current === sessionId
    ) {
      return;
    }
    if (terminalSocketRef.current) {
      terminalSocketRef.current.close();
    }
    const socket = new WebSocket(terminalWsUrl(sessionId));
    terminalSocketRef.current = socket;
    terminalSessionRef.current = sessionId;

    socket.addEventListener("open", () => {
      const term = terminalRef.current;
      const fitAddon = terminalFitRef.current;
      if (term && fitAddon) {
        fitAddon.fit();
        socket.send(
          JSON.stringify({ type: "init", cols: term.cols, rows: term.rows })
        );
      }
    });

    socket.addEventListener("message", (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!payload?.type) {
        return;
      }
      const term = terminalRef.current;
      if (!term) {
        return;
      }
      if (payload.type === "output" && typeof payload.data === "string") {
        term.write(payload.data);
        return;
      }
      if (payload.type === "exit") {
        term.write(`\r\n[terminal exited ${payload.code}]\r\n`);
      }
    });

    socket.addEventListener("close", () => {
      const term = terminalRef.current;
      if (term) {
        term.write("\r\n[terminal disconnected]\r\n");
      }
    });
  }, [attachmentSession?.sessionId]);

  const ensureNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      return "unsupported";
    }
    if (Notification.permission === "default") {
      try {
        return await Notification.requestPermission();
      } catch (error) {
        return Notification.permission;
      }
    }
    return Notification.permission;
  }, []);

  const primeAudioContext = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    let ctx = audioContextRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioContextRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }, []);

  const playNotificationSound = useCallback(() => {
    if (!soundEnabled) {
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    let ctx = audioContextRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioContextRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 740;
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.26);
  }, [soundEnabled]);

  const maybeNotify = useCallback((message) => {
    if (!notificationsEnabled) {
      return;
    }
    if (!("Notification" in window)) {
      return;
    }
    if (Notification.permission !== "granted") {
      return;
    }
    if (!message?.id || lastNotifiedIdRef.current === message.id) {
      return;
    }
    if (!document.hidden) {
      return;
    }
    lastNotifiedIdRef.current = message.id;
    const body = (message.text || "").slice(0, 180);
    try {
      new Notification("Nouveau message", { body });
    } catch (error) {
      // Ignore notification failures (permissions or browser quirks).
    }
    playNotificationSound();
  }, [notificationsEnabled, playNotificationSound]);

  useEffect(() => {
    if (!notificationsEnabled) {
      return;
    }
    void ensureNotificationPermission();
    primeAudioContext();
  }, [ensureNotificationPermission, primeAudioContext, notificationsEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(repoHistory));
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [repoHistory]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    let isMounted = true;

    const clearReconnectTimer = () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const clearPingInterval = () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
    };

    const startPingInterval = () => {
      clearPingInterval();
      lastPongRef.current = Date.now();
      pingIntervalRef.current = setInterval(() => {
        const socket = socketRef.current;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return;
        }
        const elapsed = Date.now() - lastPongRef.current;
        if (elapsed > SOCKET_PING_INTERVAL_MS + SOCKET_PONG_GRACE_MS) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ type: "ping" }));
      }, SOCKET_PING_INTERVAL_MS);
    };

    const scheduleReconnect = () => {
      if (!isMounted) {
        return;
      }
      const attempt = Math.min(reconnectAttemptRef.current + 1, 6);
      reconnectAttemptRef.current = attempt;
      const baseDelay = 500;
      const maxDelay = 10000;
      const delay = Math.min(baseDelay * 2 ** (attempt - 1), maxDelay);
      const jitter = Math.floor(Math.random() * 250);
      clearReconnectTimer();
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, delay + jitter);
    };

    const connect = () => {
      if (!isMounted) {
        return;
      }
      setStatus("Connexion...");
      const socket = new WebSocket(wsUrl(attachmentSession.sessionId));
      socketRef.current = socket;

      const isCurrent = () => socketRef.current === socket;

      socket.addEventListener("open", () => {
        if (!isCurrent()) {
          return;
        }
        reconnectAttemptRef.current = 0;
        clearReconnectTimer();
        setConnected(true);
        setStatus("Connecte");
        startPingInterval();
        void resyncSession();
        requestMessageSync();
      });

      socket.addEventListener("close", () => {
        if (!isCurrent()) {
          return;
        }
        setConnected(false);
        setStatus("Deconnecte");
        setAppServerReady(false);
        clearPingInterval();
        if (!closingRef.current) {
          scheduleReconnect();
        }
      });

      socket.addEventListener("error", () => {
        if (!isCurrent()) {
          return;
        }
        socket.close();
      });

      socket.addEventListener("message", (event) => {
        if (!isCurrent()) {
          return;
        }
        let payload;
        try {
          payload = JSON.parse(event.data);
        } catch (error) {
          return;
        }

        const isWorktreeScoped = Boolean(payload.worktreeId);

        if (payload.type === "pong") {
          lastPongRef.current = Date.now();
        }

        if (payload.type === "status") {
          setStatus(payload.message);
        }

        if (payload.type === "ready") {
          setStatus("Pret");
          setAppServerReady(true);
        }

        if (!isWorktreeScoped && payload.type === "assistant_delta") {
          if (typeof payload.delta !== "string") {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = messageIndex.get(payload.itemId);
            if (existingIndex === undefined) {
              const entry = {
                id: payload.itemId,
                role: "assistant",
                text: payload.delta,
              };
              messageIndex.set(payload.itemId, next.length);
              next.push(entry);
              return next;
            }

            const updated = { ...next[existingIndex] };
            updated.text += payload.delta;
            next[existingIndex] = updated;
            return next;
          });
        }

        if (!isWorktreeScoped && payload.type === "assistant_message") {
          if (typeof payload.text !== "string") {
            return;
          }
          maybeNotify({ id: payload.itemId, text: payload.text });
          setMessages((current) => {
            const next = [...current];
            const existingIndex = messageIndex.get(payload.itemId);
            if (existingIndex === undefined) {
              messageIndex.set(payload.itemId, next.length);
              next.push({
                id: payload.itemId,
                role: "assistant",
                text: payload.text,
              });
              return next;
            }

            next[existingIndex] = {
              ...next[existingIndex],
              text: payload.text,
            };
            return next;
          });
        }

        if (!isWorktreeScoped && payload.type === "command_execution_delta") {
          if (typeof payload.delta !== "string") {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = commandIndex.get(payload.itemId);
            if (existingIndex === undefined) {
              const entry = {
                id: payload.itemId,
                role: "commandExecution",
                command: "Commande",
                output: payload.delta,
                isExpandable: true,
                status: "running",
              };
              commandIndex.set(payload.itemId, next.length);
              next.push(entry);
              return next;
            }
            const updated = { ...next[existingIndex] };
            updated.output = `${updated.output || ""}${payload.delta}`;
            updated.isExpandable = true;
            next[existingIndex] = updated;
            return next;
          });
        }

        if (!isWorktreeScoped && payload.type === "command_execution_completed") {
          const item = payload.item;
          const itemId = payload.itemId || item?.id;
          if (!itemId) {
            return;
          }
          setMessages((current) => {
            const next = [...current];
            const existingIndex = commandIndex.get(itemId);
            const command =
              item?.commandActions?.command || item?.command || "Commande";
            if (existingIndex === undefined) {
              const entry = {
                id: itemId,
                role: "commandExecution",
                command,
                output: item?.aggregatedOutput || "",
                isExpandable: true,
                status: "completed",
              };
              commandIndex.set(itemId, next.length);
              next.push(entry);
              return next;
            }
            const updated = { ...next[existingIndex] };
            updated.command = command;
            updated.output = item?.aggregatedOutput || updated.output || "";
            updated.isExpandable = true;
            updated.status = "completed";
            next[existingIndex] = updated;
            return next;
          });
        }

        if (!isWorktreeScoped && payload.type === "turn_error") {
          setStatus(`Erreur: ${payload.message}`);
          setProcessing(false);
          setActivity("");
          setCurrentTurnId(null);
        }

        if (!isWorktreeScoped && payload.type === "error") {
          setStatus(payload.message || "Erreur inattendue");
          setProcessing(false);
          setActivity("");
          setModelLoading(false);
          setModelError(payload.message || "Erreur inattendue");
        }

        if (!isWorktreeScoped && payload.type === "turn_started") {
          setProcessing(true);
          setActivity("Traitement en cours...");
          setCurrentTurnId(payload.turnId || null);
        }

        if (!isWorktreeScoped && payload.type === "turn_completed") {
          setProcessing(false);
          setActivity("");
          setCurrentTurnId(null);
        }

        if (!isWorktreeScoped && payload.type === "repo_diff") {
          setRepoDiff({
            status: payload.status || "",
            diff: payload.diff || "",
          });
        }

        if (!isWorktreeScoped && payload.type === "model_list") {
          const list = Array.isArray(payload.models) ? payload.models : [];
          setModels(list);
          const defaultModel = list.find((model) => model.isDefault);
          if (defaultModel?.model) {
            setSelectedModel(defaultModel.model);
          }
          if (defaultModel?.defaultReasoningEffort) {
            setSelectedReasoningEffort(defaultModel.defaultReasoningEffort);
          }
          setModelLoading(false);
          setModelError("");
        }

        if (!isWorktreeScoped && payload.type === "model_set") {
          setSelectedModel(payload.model || "");
          if (payload.reasoningEffort !== undefined) {
            setSelectedReasoningEffort(payload.reasoningEffort || "");
          }
          setModelLoading(false);
          setModelError("");
        }

        if (!isWorktreeScoped && payload.type === "rpc_log") {
          if (payload.entry) {
            setRpcLogs((current) => [payload.entry, ...current].slice(0, 500));
          }
        }

        if (!isWorktreeScoped && payload.type === "account_login_completed") {
          if (payload.success) {
            setOpenAiReady(true);
            setOpenAiLoginPending(false);
            setOpenAiLoginError("");
          } else {
            setOpenAiReady(false);
            setOpenAiLoginPending(false);
            setOpenAiLoginError(
              payload.error || "Echec de l'authentification OpenAI."
            );
          }
        }

        if (!isWorktreeScoped && payload.type === "account_login_error") {
          setOpenAiReady(false);
          setOpenAiLoginPending(false);
          setOpenAiLoginError(
            payload.message || "Echec de l'authentification OpenAI."
          );
        }

        if (!isWorktreeScoped && payload.type === "item_started") {
          const { item } = payload;
          if (!item?.type) {
            return;
          }
          if (item.type === "commandExecution") {
            const command =
              item.commandActions?.command || item.command || "Commande";
            setActivity(`Commande: ${command}`);
            if (!item.id) {
              return;
            }
            setMessages((current) => {
              const next = [...current];
              const existingIndex = commandIndex.get(item.id);
              if (existingIndex !== undefined) {
                const updated = { ...next[existingIndex] };
                updated.command = command;
                updated.status = "running";
                next[existingIndex] = updated;
                return next;
              }
              const entry = {
                id: item.id,
                role: "commandExecution",
                command,
                output: "",
                isExpandable: false,
                status: "running",
              };
              commandIndex.set(item.id, next.length);
              next.push(entry);
              return next;
            });
            return;
          }
          if (item.type === "fileChange") {
            setActivity("Application de modifications...");
            return;
          }
          if (item.type === "mcpToolCall") {
            setActivity(`Outil: ${item.tool}`);
            return;
          }
          if (item.type === "reasoning") {
            setActivity("Raisonnement...");
            return;
          }
          if (item.type === "agentMessage") {
            setActivity("Generation de reponse...");
          }
        }

        if (!isWorktreeScoped && payload.type === "provider_switched") {
          setLlmProvider(payload.provider);
          setStatus("Pret");
          if (Array.isArray(payload.messages)) {
            applyMessages(payload.messages);
          } else {
            applyMessages([]);
          }
          setProviderSwitching(false);
          if (Array.isArray(payload.models)) {
            setModels(payload.models);
            const defaultModel = payload.models.find((m) => m.isDefault);
            if (defaultModel?.model) {
              setSelectedModel(defaultModel.model);
            }
            if (defaultModel?.defaultReasoningEffort) {
              setSelectedReasoningEffort(defaultModel.defaultReasoningEffort);
            }
          }
        }

        if (!isWorktreeScoped && payload.type === "messages_sync") {
          mergeAndApplyMessages(payload.messages || []);
        }

        // ============== Worktree WebSocket Handlers ==============

        if (payload.type === "worktree_created") {
          setWorktrees((current) => {
            const next = new Map(current);
            next.set(payload.worktreeId, {
              id: payload.worktreeId,
              name: payload.name,
              branchName: payload.branchName,
              provider: payload.provider,
              status: payload.status || "creating",
              color: payload.color,
              messages: [],
            });
            return next;
          });
          // Auto-select the new worktree
          setActiveWorktreeId(payload.worktreeId);
        }

        if (payload.type === "worktree_ready") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, { ...wt, status: "ready" });
            }
            return next;
          });
        }

        if (payload.type === "worktree_status") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, {
                ...wt,
                status: payload.status,
                error: payload.error || null,
              });
            }
            return next;
          });
        }

        if (payload.type === "worktree_removed") {
          setWorktrees((current) => {
            const next = new Map(current);
            next.delete(payload.worktreeId);
            return next;
          });
          // If active worktree was removed, switch back to main
          if (activeWorktreeId === payload.worktreeId) {
            setActiveWorktreeId("main");
          }
        }

        if (payload.type === "worktree_renamed") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, { ...wt, name: payload.name });
            }
            return next;
          });
        }

        if (payload.type === "worktrees_list") {
          if (Array.isArray(payload.worktrees)) {
            const newMap = new Map();
            payload.worktrees.forEach((wt) => {
              newMap.set(wt.id, { ...wt, messages: [] });
            });
            setWorktrees(newMap);
            // Keep activeWorktreeId as is, don't auto-switch
          }
        }

        if (payload.type === "worktree_messages_sync") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, {
                ...wt,
                messages: payload.messages || [],
                status: payload.status || wt.status,
              });
            }
            return next;
          });
        }

        if (payload.type === "worktree_diff") {
          // Store diff per worktree if needed (for future use)
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              next.set(payload.worktreeId, {
                ...wt,
                diff: { status: payload.status, diff: payload.diff },
              });
            }
            return next;
          });
        }

        // Handle messages with worktreeId (parallel mode)
        if (payload.worktreeId && (
          payload.type === "assistant_delta" ||
          payload.type === "assistant_message" ||
          payload.type === "command_execution_delta" ||
          payload.type === "command_execution_completed" ||
          payload.type === "turn_started" ||
          payload.type === "turn_completed" ||
          payload.type === "turn_error"
        )) {
          const wtId = payload.worktreeId;

          if (payload.type === "turn_started") {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt) {
                next.set(wtId, { ...wt, status: "processing", currentTurnId: payload.turnId });
              }
              return next;
            });
          }

          if (payload.type === "turn_completed" || payload.type === "turn_error") {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt) {
                next.set(wtId, { ...wt, status: "ready", currentTurnId: null });
              }
              return next;
            });
          }

          if (payload.type === "assistant_delta" || payload.type === "assistant_message") {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (!wt) return current;

              const messages = [...wt.messages];
              const existingIdx = messages.findIndex((m) => m.id === payload.itemId);

              if (payload.type === "assistant_delta") {
                if (existingIdx === -1) {
                  messages.push({
                    id: payload.itemId,
                    role: "assistant",
                    text: payload.delta || "",
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    text: (messages[existingIdx].text || "") + (payload.delta || ""),
                  };
                }
              } else {
                if (existingIdx === -1) {
                  messages.push({
                    id: payload.itemId,
                    role: "assistant",
                    text: payload.text || "",
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    text: payload.text || "",
                  };
                }
              }

              next.set(wtId, { ...wt, messages });
              return next;
            });
          }

          if (payload.type === "command_execution_delta" || payload.type === "command_execution_completed") {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (!wt) return current;

              const messages = [...wt.messages];
              const itemId = payload.itemId || payload.item?.id;
              const existingIdx = messages.findIndex((m) => m.id === itemId);

              if (payload.type === "command_execution_delta") {
                if (existingIdx === -1) {
                  messages.push({
                    id: itemId,
                    role: "commandExecution",
                    command: "Commande",
                    output: payload.delta || "",
                    status: "running",
                    isExpandable: true,
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    output: (messages[existingIdx].output || "") + (payload.delta || ""),
                  };
                }
              } else {
                const item = payload.item;
                const command = item?.commandActions?.command || item?.command || "Commande";
                if (existingIdx === -1) {
                  messages.push({
                    id: itemId,
                    role: "commandExecution",
                    command,
                    output: item?.aggregatedOutput || "",
                    status: "completed",
                    isExpandable: true,
                  });
                } else {
                  messages[existingIdx] = {
                    ...messages[existingIdx],
                    command,
                    output: item?.aggregatedOutput || messages[existingIdx].output || "",
                    status: "completed",
                  };
                }
              }

              next.set(wtId, { ...wt, messages });
              return next;
            });
          }
        }

        // ============== End Worktree WebSocket Handlers ==============
      });
    };

    connect();

    return () => {
      isMounted = false;
      closingRef.current = true;
      clearReconnectTimer();
      clearPingInterval();
      if (socketRef.current) {
        socketRef.current.close();
      }
      closingRef.current = false;
    };
  }, [
    attachmentSession?.sessionId,
    messageIndex,
    commandIndex,
    mergeAndApplyMessages,
    requestMessageSync,
    resyncSession,
  ]);

  useEffect(() => {
    if (
      !attachmentSession?.sessionId ||
      !openAiLoginRequest ||
      !appServerReady ||
      !connected ||
      llmProvider !== "codex"
    ) {
      return;
    }
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(
      JSON.stringify({
        type: "account_login_start",
        params: openAiLoginRequest,
      })
    );
    setOpenAiLoginRequest(null);
  }, [
    attachmentSession?.sessionId,
    appServerReady,
    connected,
    openAiLoginRequest,
    llmProvider,
  ]);

  useEffect(() => {
    if (activePane !== "terminal") {
      return;
    }
    if (!terminalContainerRef.current || terminalRef.current) {
      return;
    }
    const term = new Terminal({
      fontFamily:
        '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: "#fbf6ee",
        foreground: "#2a2418",
        cursor: "#2a2418",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalContainerRef.current);
    fitAddon.fit();
    term.focus();
    terminalRef.current = term;
    terminalFitRef.current = fitAddon;
    terminalDisposableRef.current = term.onData((data) => {
      const socket = terminalSocketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "input", data }));
      }
    });
  }, [activePane]);

  useEffect(() => {
    return () => {
      if (terminalDisposableRef.current) {
        terminalDisposableRef.current.dispose();
        terminalDisposableRef.current = null;
      }
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      terminalFitRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (activePane !== "terminal") {
      return;
    }
    if (terminalFitRef.current) {
      requestAnimationFrame(() => {
        const fitAddon = terminalFitRef.current;
        const term = terminalRef.current;
        if (!fitAddon || !term) {
          return;
        }
        fitAddon.fit();
        term.focus();
        const socket = terminalSocketRef.current;
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
          );
        }
      });
    }
    connectTerminal();
  }, [activePane, connectTerminal]);

  useEffect(() => {
    const handleResize = () => {
      const term = terminalRef.current;
      const fitAddon = terminalFitRef.current;
      const socket = terminalSocketRef.current;
      if (!term || !fitAddon) {
        return;
      }
      fitAddon.fit();
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(
          JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows })
        );
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!attachmentSession?.sessionId && terminalSocketRef.current) {
      terminalSocketRef.current.close();
      terminalSocketRef.current = null;
      terminalSessionRef.current = null;
    }
  }, [attachmentSession?.sessionId]);

  useEffect(() => {
    const sessionId = getSessionIdFromUrl();
    if (!sessionId) {
      return;
    }
    const resumeSession = async () => {
      try {
        setSessionRequested(true);
        setAttachmentsError("");
        const response = await fetch(
          `/api/session/${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          throw new Error("Session introuvable.");
        }
        const data = await response.json();
        setAttachmentSession(data);
      } catch (error) {
        setAttachmentsError(
          error.message || "Impossible de reprendre la session."
        );
        setSessionRequested(false);
      }
    };

    resumeSession();
  }, []);

  useEffect(() => {
    if (!repoUrl) {
      return;
    }
    const createAttachmentSession = async () => {
      try {
        setAttachmentsLoading(true);
        setAttachmentsError("");
        const payload = { repoUrl, provider: llmProvider };
        if (repoAuth) {
          payload.auth = repoAuth;
        }
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          let details = "";
          try {
            const errorPayload = await response.json();
            if (typeof errorPayload?.error === "string") {
              details = errorPayload.error;
            } else if (typeof errorPayload?.message === "string") {
              details = errorPayload.message;
            } else if (typeof errorPayload === "string") {
              details = errorPayload;
            }
          } catch (parseError) {
            try {
              details = await response.text();
            } catch (readError) {
              details = "";
            }
          }
          const suffix = details ? `: ${details}` : "";
          throw new Error(
            `Impossible de creer la session de pieces jointes (HTTP ${response.status}${
              response.statusText ? ` ${response.statusText}` : ""
            })${suffix}.`
          );
        }
        const data = await response.json();
        setAttachmentSession(data);
      } catch (error) {
        setAttachmentsError(
          error.message || "Impossible de creer la session de pieces jointes."
        );
        setOpenAiLoginPending(false);
        setOpenAiLoginRequest(null);
      } finally {
        setAttachmentsLoading(false);
        setSessionRequested(false);
      }
    };

    createAttachmentSession();
  }, [repoUrl, repoAuth, llmProvider]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("session", attachmentSession.sessionId);
    window.history.replaceState({}, "", url);
  }, [attachmentSession?.sessionId]);

  useEffect(() => {
    setAppServerReady(false);
  }, [attachmentSession?.sessionId]);

  const onRepoSubmit = async (event) => {
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
          setAttachmentsError("Identifiant et mot de passe requis.");
          return;
        }
        auth = { type: "http", username: user, password: httpPassword };
      }
    }
    let openAiParams = null;
    if (llmProvider === "codex") {
      if (openAiAuthMode === "apiKey") {
        const key = openAiApiKey.trim();
        if (!key) {
          setOpenAiLoginError("API Key OpenAI requise pour demarrer.");
          return;
        }
        openAiParams = { type: "apiKey", apiKey: key };
      } else if (openAiAuthMode === "authFile") {
        if (!openAiAuthFile) {
          setOpenAiLoginError("Fichier auth.json requis pour demarrer.");
          return;
        }
      }
    } else {
      if (!claudeAuthFile) {
        setClaudeLoginError("Fichier credentials.json requis pour demarrer.");
        return;
      }
    }
    setAttachmentsError("");
    setOpenAiLoginError("");
    setClaudeLoginError("");
    if (llmProvider === "codex") {
      setClaudeLoginPending(false);
      if (openAiAuthMode === "apiKey") {
        setOpenAiReady(false);
        setOpenAiLoginPending(true);
        setOpenAiLoginRequest(openAiParams);
      } else if (openAiAuthMode === "authFile") {
        setOpenAiLoginRequest(null);
        setOpenAiLoginPending(true);
        try {
          const formData = new FormData();
          formData.append(
            "file",
            openAiAuthFile,
            openAiAuthFile.name || "auth.json"
          );
          const response = await fetch("/api/auth-file", {
            method: "POST",
            body: formData,
          });
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(
              payload?.error || "Echec de l'envoi du fichier auth.json."
            );
          }
          setOpenAiReady(true);
        } catch (error) {
          setOpenAiReady(false);
          setOpenAiLoginError(
            error.message || "Echec de l'envoi du fichier auth.json."
          );
          setOpenAiLoginPending(false);
          return;
        } finally {
          setOpenAiLoginPending(false);
        }
      }
    } else {
      setOpenAiLoginRequest(null);
      setOpenAiLoginPending(false);
      setClaudeReady(false);
      setClaudeLoginPending(true);
      try {
        const formData = new FormData();
        formData.append(
          "file",
          claudeAuthFile,
          claudeAuthFile.name || "credentials.json"
        );
        const response = await fetch("/api/claude-auth-file", {
          method: "POST",
          body: formData,
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.error ||
              "Echec de l'envoi du fichier credentials.json."
          );
        }
        setClaudeReady(true);
      } catch (error) {
        setClaudeReady(false);
        setClaudeLoginError(
          error.message || "Echec de l'envoi du fichier credentials.json."
        );
        setClaudeLoginPending(false);
        return;
      } finally {
        setClaudeLoginPending(false);
      }
    }
    if (!hasSession) {
      setSessionRequested(true);
      setRepoAuth(auth);
      setRepoUrl(trimmed);
    }
  };

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    applyMessages(attachmentSession.messages || []);
    setRepoDiff(attachmentSession.repoDiff || { status: "", diff: "" });
    setRpcLogs(attachmentSession.rpcLogs || []);
    setStatus("Connexion...");
    setConnected(false);
  }, [attachmentSession?.sessionId, applyMessages, messageIndex]);

  useEffect(() => {
    if (!attachmentSession?.provider) {
      return;
    }
    // Sync local state with session provider on initial load
    if (attachmentSession.provider !== llmProvider) {
      setLlmProvider(attachmentSession.provider);
    }
  }, [attachmentSession?.provider]);

  useEffect(() => {
    if (!attachmentSession?.repoUrl) {
      return;
    }
    setRepoHistory((current) =>
      mergeRepoHistory(current, attachmentSession.repoUrl)
    );
  }, [attachmentSession?.repoUrl]);

  const handleProviderSwitch = useCallback(
    (newProvider) => {
      if (
        !socketRef.current ||
        socketRef.current.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      if (newProvider === llmProvider || providerSwitching || processing) {
        return;
      }
      setProviderSwitching(true);
      setStatus(`Basculement vers ${newProvider}...`);
      socketRef.current.send(
        JSON.stringify({ type: "switch_provider", provider: newProvider })
      );
    },
    [llmProvider, providerSwitching, processing]
  );

  const requestModelList = () => {
    if (!socketRef.current || llmProvider !== "codex") {
      return;
    }
    setModelLoading(true);
    setModelError("");
    socketRef.current.send(JSON.stringify({ type: "model_list" }));
  };

  const handleModelChange = (event) => {
    const value = event.target.value;
    setSelectedModel(value);
    if (!socketRef.current) {
      return;
    }
    setModelLoading(true);
    setModelError("");
    socketRef.current.send(
      JSON.stringify({
        type: "model_set",
        model: value,
        reasoningEffort: selectedReasoningEffort || null,
      })
    );
  };

  const handleReasoningEffortChange = (event) => {
    const value = event.target.value;
    setSelectedReasoningEffort(value);
    if (!socketRef.current) {
      return;
    }
    setModelLoading(true);
    setModelError("");
    socketRef.current.send(
      JSON.stringify({
        type: "model_set",
        model: selectedModel || null,
        reasoningEffort: value || null,
      })
    );
  };

  const handleBranchSelect = async (branch) => {
    if (!attachmentSession?.sessionId || processing) {
      return;
    }
    setBranchLoading(true);
    setBranchError("");
    try {
      const response = await fetch("/api/branches/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session: attachmentSession.sessionId,
          branch,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Impossible de changer de branche.");
      }
      setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      setCurrentBranch(payload.current || "");
      setBranchMenuOpen(false);
    } catch (error) {
      setBranchError(error.message || "Impossible de changer de branche.");
    } finally {
      setBranchLoading(false);
    }
  };

  const selectedModelDetails = useMemo(
    () => models.find((model) => model.model === selectedModel) || null,
    [models, selectedModel]
  );

  useEffect(() => {
    if (!backlogKey) {
      return;
    }
    try {
      const stored = JSON.parse(localStorage.getItem(backlogKey) || "[]");
      setBacklog(Array.isArray(stored) ? stored : []);
    } catch {
      setBacklog([]);
    }
  }, [backlogKey]);

  useEffect(() => {
    if (!backlogKey) {
      return;
    }
    localStorage.setItem(backlogKey, JSON.stringify(backlog));
  }, [backlog, backlogKey]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }

    const loadAttachments = async () => {
      try {
        setAttachmentsLoading(true);
        setAttachmentsError("");
        const response = await fetch(
          `/api/attachments?session=${encodeURIComponent(
            attachmentSession.sessionId
          )}`
        );
        if (!response.ok) {
          throw new Error("Failed to list attachments.");
        }
        const data = await response.json();
        setAttachments(data.files || []);
      } catch (error) {
        setAttachmentsError(
          error.message || "Impossible de charger les pieces jointes."
        );
      } finally {
        setAttachmentsLoading(false);
      }
    };

    loadAttachments();
  }, [attachmentSession]);

  useEffect(() => {
    if (!attachments.length) {
      setSelectedAttachments([]);
      return;
    }
    setSelectedAttachments((current) =>
      current.filter((path) => attachments.some((file) => file.path === path))
    );
  }, [attachments]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, processing]);

  const uploadFiles = async (files) => {
    if (!files.length || !attachmentSession?.sessionId) {
      return;
    }
    try {
      setAttachmentsLoading(true);
      setAttachmentsError("");
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const response = await fetch(
        `/api/attachments/upload?session=${encodeURIComponent(
          attachmentSession.sessionId
        )}`,
        {
          method: "POST",
          body: formData,
        }
      );
      if (!response.ok) {
        throw new Error("Upload failed.");
      }
      const data = await response.json();
      setAttachments((current) => [...current, ...(data.files || [])]);
    } catch (error) {
      setAttachmentsError(
        error.message || "Impossible d'uploader les pieces jointes."
      );
    } finally {
      setAttachmentsLoading(false);
    }
  };

  const onUploadAttachments = async (event) => {
    const files = Array.from(event.target.files || []);
    await uploadFiles(files);
    event.target.value = "";
  };

  const onPasteAttachments = async (event) => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    const items = Array.from(event.clipboardData?.items || []);
    const files = items
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter(Boolean);
    if (!files.length) {
      return;
    }
    event.preventDefault();
    await uploadFiles(files);
  };

  const toggleAttachment = (path) => {
    setSelectedAttachments((current) => {
      if (current.includes(path)) {
        return current.filter((item) => item !== path);
      }
      return [...current, path];
    });
  };

  const sendMessage = (textOverride, attachmentsOverride) => {
    const rawText = (textOverride ?? input).trim();
    if (!rawText || !socketRef.current || !connected) {
      return;
    }

    void ensureNotificationPermission();
    const selectedPaths = attachmentsOverride ?? selectedAttachments;
    const suffix =
      selectedPaths.length > 0
        ? `;; attachments: ${JSON.stringify(selectedPaths)}`
        : "";
    const displayText = rawText;
    const text = `${displayText}${suffix}`;
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text: displayText },
    ]);
    socketRef.current.send(
      JSON.stringify({ type: "user_message", text, displayText })
    );
    setInput("");
  };

  const sendCommitMessage = (text) => {
    sendMessage(text, []);
  };

  // ============== Worktree Functions ==============

  const createWorktree = useCallback(
    ({ name, provider: wtProvider }) => {
      if (!socketRef.current || !connected) return;

      socketRef.current.send(
        JSON.stringify({
          type: "create_parallel_request",
          provider: wtProvider || llmProvider,
          name: name || null,
        })
      );
    },
    [connected, llmProvider]
  );

  const sendWorktreeMessage = useCallback(
    (worktreeId, textOverride, attachmentsOverride) => {
      const rawText = (textOverride ?? input).trim();
      if (!rawText || !socketRef.current || !connected || !worktreeId) return;

      const selectedPaths = attachmentsOverride ?? selectedAttachments;
      const suffix =
        selectedPaths.length > 0
          ? `;; attachments: ${JSON.stringify(selectedPaths)}`
          : "";
      const displayText = rawText;
      const text = `${displayText}${suffix}`;

      // Add user message to worktree locally
      setWorktrees((current) => {
        const next = new Map(current);
        const wt = next.get(worktreeId);
        if (wt) {
          const messages = [
            ...wt.messages,
            { id: `user-${Date.now()}`, role: "user", text: displayText },
          ];
          next.set(worktreeId, { ...wt, messages });
        }
        return next;
      });

      socketRef.current.send(
        JSON.stringify({
          type: "worktree_message",
          worktreeId,
          text,
          displayText,
        })
      );
      setInput("");
    },
    [connected, input, selectedAttachments]
  );

  const closeWorktree = useCallback(
    async (worktreeId) => {
      if (!attachmentSession?.sessionId) return;

      try {
        const response = await fetch(
          `/api/worktree/${worktreeId}?session=${encodeURIComponent(
            attachmentSession.sessionId
          )}`,
          { method: "DELETE" }
        );
        if (!response.ok) {
          console.error("Failed to close worktree");
        }
      } catch (error) {
        console.error("Error closing worktree:", error);
      }
    },
    [attachmentSession?.sessionId]
  );

  const renameWorktreeHandler = useCallback(
    async (worktreeId, newName) => {
      if (!attachmentSession?.sessionId) return;

      try {
        const response = await fetch(
          `/api/worktree/${worktreeId}?session=${encodeURIComponent(
            attachmentSession.sessionId
          )}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName }),
          }
        );
        if (!response.ok) {
          console.error("Failed to rename worktree");
        }
      } catch (error) {
        console.error("Error renaming worktree:", error);
      }
    },
    [attachmentSession?.sessionId]
  );

  // Check if we're in a real worktree (not "main")
  const isInWorktree = activeWorktreeId && activeWorktreeId !== "main";
  const activeWorktree = isInWorktree ? worktrees.get(activeWorktreeId) : null;

  // Get current messages based on active tab
  const currentMessages = activeWorktree ? activeWorktree.messages : messages;

  // Combined list for tabs: "main" + all worktrees
  const allTabs = useMemo(() => {
    const mainTab = {
      id: "main",
      name: currentBranch || "Main",
      branchName: currentBranch || "main",
      provider: llmProvider,
      status: processing ? "processing" : (connected ? "ready" : "creating"),
      color: "#6b7280",
      messages: messages,
    };
    const wtList = Array.from(worktrees.values());
    return [mainTab, ...wtList];
  }, [currentBranch, llmProvider, processing, connected, messages, worktrees]);

  // Group messages for display (works with both legacy and worktree modes)
  const displayedGroupedMessages = useMemo(() => {
    const grouped = [];
    (currentMessages || []).forEach((message) => {
      if (message?.role === "commandExecution") {
        if (!showChatCommands) {
          return;
        }
        const last = grouped[grouped.length - 1];
        if (last?.groupType === "commandExecution") {
          last.items.push(message);
        } else {
          grouped.push({
            groupType: "commandExecution",
            id: `command-group-${message.id}`,
            items: [message],
          });
        }
        return;
      }
      grouped.push(message);
    });
    return grouped;
  }, [currentMessages, showChatCommands]);

  const isWorktreeProcessing = activeWorktree?.status === "processing";
  const currentProcessing = isInWorktree ? isWorktreeProcessing : processing;

  // Handle send message - route to worktree or legacy
  const handleSendMessage = useCallback(
    (textOverride, attachmentsOverride) => {
      if (isInWorktree && activeWorktreeId) {
        sendWorktreeMessage(activeWorktreeId, textOverride, attachmentsOverride);
      } else {
        sendMessage(textOverride, attachmentsOverride);
      }
    },
    [isInWorktree, activeWorktreeId, sendWorktreeMessage]
  );

  // ============== End Worktree Functions ==============

  const addToBacklog = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    const entry = {
      id: `backlog-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: trimmed,
      createdAt: Date.now(),
      attachments: selectedAttachments,
    };
    setBacklog((current) => [entry, ...current]);
    setInput("");
  };

  const removeFromBacklog = (id) => {
    setBacklog((current) => current.filter((item) => item.id !== id));
  };

  const editBacklogItem = (item) => {
    setInput(item.text || "");
    setSelectedAttachments(item.attachments || []);
    inputRef.current?.focus();
  };

  const launchBacklogItem = (item) => {
    sendMessage(item.text || "", item.attachments || []);
    removeFromBacklog(item.id);
  };

  const onSubmit = (event) => {
    event.preventDefault();
    handleSendMessage();
  };

  const interruptTurn = () => {
    if (!currentTurnId || !socketRef.current) {
      return;
    }
    socketRef.current.send(
      JSON.stringify({ type: "turn_interrupt", turnId: currentTurnId })
    );
    setActivity("Interruption...");
  };

  const openSidePanel = useCallback((nextTab) => {
    if (nextTab) {
      setSideTab(nextTab);
    }
    setSideOpen(true);
  }, []);

  const triggerAttachmentPicker = useCallback(() => {
    openSidePanel("attachments");
    if (!attachmentSession || attachmentsLoading) {
      return;
    }
    requestAnimationFrame(() => {
      uploadInputRef.current?.click();
    });
  }, [attachmentSession, attachmentsLoading, openSidePanel]);

  const handleViewSelect = useCallback((nextPane) => {
    setActivePane(nextPane);
    setMoreMenuOpen(false);
  }, []);

  const handleExportChat = useCallback(
    (format) => {
      if (!messages.length) {
        return;
      }
      setMoreMenuOpen(false);
      const baseName = extractRepoName(
        attachmentSession?.repoUrl || repoUrl || ""
      );
      if (format === "markdown") {
        const lines = [
          "# Historique du chat",
          "",
          `Export: ${new Date().toISOString()}`,
          "",
        ];
        messages.forEach((message) => {
          if (message.role === "commandExecution") {
            lines.push("## Commande");
            lines.push(`\`${message.command || "Commande"}\``);
            if (message.output) {
              lines.push("```");
              lines.push(message.output);
              lines.push("```");
            }
            lines.push("");
            return;
          }
          const roleLabel = message.role === "user" ? "Utilisateur" : "Assistant";
          lines.push(`## ${roleLabel}`);
          lines.push(message.text || "");
          lines.push("");
        });
        const content = lines.join("\n").trim() + "\n";
        downloadTextFile(
          formatExportName(baseName, "md"),
          content,
          "text/markdown"
        );
        return;
      }
      const payload = {
        exportedAt: new Date().toISOString(),
        repoUrl: attachmentSession?.repoUrl || repoUrl || "",
        messages: messages.map((message) => {
          if (message.role === "commandExecution") {
            return {
              id: message.id,
              role: message.role,
              command: message.command || "",
              output: message.output || "",
              status: message.status || "",
            };
          }
          return {
            id: message.id,
            role: message.role,
            text: message.text || "",
          };
        }),
      };
      downloadTextFile(
        formatExportName(baseName, "json"),
        JSON.stringify(payload, null, 2),
        "application/json"
      );
    },
    [messages, attachmentSession?.repoUrl, repoUrl]
  );

  const handleInputChange = (event) => {
    const { value } = event.target;
    setInput(value);
    if (!inputRef.current) {
      return;
    }
    if (isMobileLayout) {
      inputRef.current.style.height = "42px";
      return;
    }
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  };

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    if (isMobileLayout) {
      inputRef.current.style.height = "42px";
      return;
    }
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  }, [input, isMobileLayout]);

  const handleChoiceClick = (choice, blockKey, choiceIndex) => {
    setChoiceSelections((prev) => ({
      ...prev,
      [blockKey]: choiceIndex,
    }));
    setInput(choice);
    sendMessage(choice);
  };

  const handleClearChat = () => {
    setMessages([]);
    messageIndex.clear();
    commandIndex.clear();
    setChoiceSelections({});
    if (choicesKey) {
      localStorage.removeItem(choicesKey);
    }
    setCommandPanelOpen({});
    lastNotifiedIdRef.current = null;
  };

  const llmReady = llmProvider === "claude" ? claudeReady : openAiReady;
  const supportsModels = llmProvider === "codex";
  const llmAuthPending =
    llmProvider === "claude" ? claudeLoginPending : openAiLoginPending;
  const llmAuthError =
    llmProvider === "claude" ? claudeLoginError : openAiLoginError;
  const hasSession = Boolean(attachmentSession?.sessionId);

  if (!attachmentSession?.sessionId || !llmReady) {
    const isRepoProvided = Boolean(repoUrl);
    const isCloning = !hasSession && isRepoProvided;
    const repoDisplay = getTruncatedText(
      attachmentSession?.repoUrl || repoUrl,
      72
    );
    const formDisabled = sessionRequested || openAiLoginPending || claudeLoginPending;
    const buttonLabel = "Go";
    return (
      <div className="session-gate">
        <div className="session-card">
          <p className="eyebrow">m5chat</p>
          <h1>Demarrer une session</h1>
          {isCloning ? (
            <div className="session-hint">
              Clonage du depot...
              {repoDisplay && (
                <div className="session-meta">{repoDisplay}</div>
              )}
            </div>
          ) : (
            <>
              <p className="session-hint">
                {hasSession
                  ? llmProvider === "claude"
                    ? "Authentification Claude requise pour continuer."
                    : "Authentification OpenAI requise pour continuer."
                  : "Indique l'URL du depot git a cloner pour cette session."}
              </p>
              {hasSession && repoDisplay && (
                <div className="session-meta">{repoDisplay}</div>
              )}
              <form className="session-form" onSubmit={onRepoSubmit}>
                {!hasSession && (
                  <>
                    <div className="session-form-row">
                      <input
                        type="text"
                        placeholder="git@gitea.devops:mon-org/mon-repo.git"
                        value={repoInput}
                        onChange={(event) => {
                          setRepoInput(event.target.value);
                        }}
                        disabled={formDisabled}
                        required
                        list={repoHistory.length > 0 ? "repo-history" : undefined}
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
                    <div className="session-auth">
                      <div className="session-auth-title">
                        Authentification (optionnelle)
                      </div>
                      <div className="session-auth-options">
                        <label className="session-auth-option">
                          <input
                            type="radio"
                            name="authMode"
                            value="none"
                            checked={authMode === "none"}
                            onChange={() => setAuthMode("none")}
                            disabled={formDisabled}
                          />
                          Aucune
                        </label>
                        <label className="session-auth-option">
                          <input
                            type="radio"
                            name="authMode"
                            value="ssh"
                            checked={authMode === "ssh"}
                            onChange={() => setAuthMode("ssh")}
                            disabled={formDisabled}
                          />
                          Cle SSH privee
                        </label>
                        <label className="session-auth-option">
                          <input
                            type="radio"
                            name="authMode"
                            value="http"
                            checked={authMode === "http"}
                            onChange={() => setAuthMode("http")}
                            disabled={formDisabled}
                          />
                          Identifiant + mot de passe
                        </label>
                      </div>
                      {authMode === "ssh" && (
                        <>
                          <textarea
                            className="session-auth-textarea"
                            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                            value={sshKeyInput}
                            onChange={(event) =>
                              setSshKeyInput(event.target.value)
                            }
                            disabled={formDisabled}
                            rows={6}
                            spellCheck={false}
                          />
                          <div className="session-auth-hint">
                            La cle est stockee dans ~/.ssh pour le clonage.
                          </div>
                        </>
                      )}
                      {authMode === "http" && (
                        <>
                          <div className="session-auth-grid">
                            <input
                              type="text"
                              placeholder="Utilisateur"
                              value={httpUsername}
                              onChange={(event) =>
                                setHttpUsername(event.target.value)
                              }
                              disabled={formDisabled}
                              autoComplete="username"
                            />
                            <input
                              type="password"
                              placeholder="Mot de passe ou PAT"
                              value={httpPassword}
                              onChange={(event) =>
                                setHttpPassword(event.target.value)
                              }
                              disabled={formDisabled}
                              autoComplete="current-password"
                            />
                          </div>
                          <div className="session-auth-hint">
                            Le mot de passe peut etre remplace par un PAT.
                          </div>
                        </>
                      )}
                    </div>
                  </>
                )}
                <div className="session-auth">
                  <div className="session-auth-title">Agent LLM</div>
                  <div className="session-auth-options">
                    <label className="session-auth-option">
                      <input
                        type="radio"
                        name="llmProvider"
                        value="codex"
                        checked={llmProvider === "codex"}
                        onChange={() =>
                          hasSession
                            ? handleProviderSwitch("codex")
                            : setLlmProvider("codex")
                        }
                        disabled={formDisabled || providerSwitching || processing}
                      />
                      Codex
                    </label>
                    <label className="session-auth-option">
                      <input
                        type="radio"
                        name="llmProvider"
                        value="claude"
                        checked={llmProvider === "claude"}
                        onChange={() =>
                          hasSession
                            ? handleProviderSwitch("claude")
                            : setLlmProvider("claude")
                        }
                        disabled={formDisabled || providerSwitching || processing}
                      />
                      Claude
                    </label>
                  </div>
                  <div className="session-auth-hint">
                    {hasSession
                      ? "Vous pouvez changer de provider en cours de session."
                      : "Le provider peut etre change apres la creation de la session."}
                  </div>
                </div>
                <div className="session-auth">
                  <div className="session-auth-title">
                    {llmProvider === "claude"
                      ? "Authentification Claude"
                      : "Authentification OpenAI"}
                  </div>
                  {llmProvider === "codex" ? (
                    <>
                      <div className="session-auth-options">
                        <label className="session-auth-option">
                          <input
                            type="radio"
                            name="openAiAuthMode"
                            value="apiKey"
                            checked={openAiAuthMode === "apiKey"}
                            onChange={() => setOpenAiAuthMode("apiKey")}
                            disabled={formDisabled}
                          />
                          API Key
                        </label>
                        <label className="session-auth-option">
                          <input
                            type="radio"
                            name="openAiAuthMode"
                            value="authFile"
                            checked={openAiAuthMode === "authFile"}
                            onChange={() => setOpenAiAuthMode("authFile")}
                            disabled={formDisabled}
                          />
                          Fichier d'authentification (auth.json)
                        </label>
                      </div>
                      {openAiAuthMode === "apiKey" && (
                        <>
                          <input
                            type="password"
                            placeholder="sk-..."
                            value={openAiApiKey}
                            onChange={(event) =>
                              setOpenAiApiKey(event.target.value)
                            }
                            disabled={formDisabled}
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <div className="session-auth-hint">
                            La cle est utilisee pour connecter l'agent OpenAI.
                          </div>
                        </>
                      )}
                      {openAiAuthMode === "authFile" && (
                        <>
                          <input
                            type="file"
                            accept="application/json,.json"
                            onChange={(event) =>
                              setOpenAiAuthFile(event.target.files?.[0] || null)
                            }
                            disabled={formDisabled}
                          />
                          <div className="session-auth-hint">
                            Le fichier est copie dans ~/.codex/auth.json.
                          </div>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <input
                        type="file"
                        accept="application/json,.json"
                        onChange={(event) =>
                          setClaudeAuthFile(event.target.files?.[0] || null)
                        }
                        disabled={formDisabled}
                      />
                      <div className="session-auth-hint">
                        Le fichier est copie dans ~/.claude/.credentials.json.
                      </div>
                    </>
                  )}
                </div>
                <div className="session-form-row">
                  <div />
                  <button type="submit" disabled={formDisabled}>
                    {llmAuthPending
                      ? "Connexion..."
                      : sessionRequested
                      ? "Chargement..."
                      : buttonLabel}
                  </button>
                </div>
              </form>
            </>
          )}
          {llmAuthPending && hasSession && (
            <div className="session-hint">
              {llmProvider === "claude"
                ? "Authentification Claude en cours..."
                : "Authentification OpenAI en cours..."}
            </div>
          )}
          {attachmentsError && (
            <div className="attachments-error">{attachmentsError}</div>
          )}
          {llmAuthError && (
            <div className="attachments-error">{llmAuthError}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="topbar-left">
          <button
            type="button"
            className="icon-button"
            aria-label={sideOpen ? "Fermer le panneau" : "Ouvrir le panneau"}
            onClick={() => setSideOpen((current) => !current)}
          >
            ☰
          </button>
          <div className="topbar-brand">
            <p className="eyebrow">m5chat</p>
            <div className="topbar-subtitle">
              {repoName || attachmentSession?.sessionId || "Session"}
            </div>
          </div>
          <div
            className={`status-pill ${
              processing ? "busy" : connected ? "ok" : "down"
            }`}
          >
            {processing ? "Génération…" : connected ? "Connecté" : status}
          </div>
        </div>

        <div className="topbar-right">
          {branchError && <div className="status-pill down">{branchError}</div>}
          {modelError && <div className="status-pill down">{modelError}</div>}
          {!isMobileLayout && hasSession && (
            <button
              type="button"
              className={`status-pill ${providerSwitching ? "busy" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() =>
                handleProviderSwitch(
                  llmProvider === "codex" ? "claude" : "codex"
                )
              }
              disabled={providerSwitching || processing}
              title="Cliquez pour changer de provider"
            >
              {providerSwitching
                ? "Basculement..."
                : `LLM: ${llmProvider}`}
            </button>
          )}

          {!isMobileLayout && (
            <div className="dropdown" ref={branchRef}>
              <button
                type="button"
                className="pill-button"
                onClick={() => {
                  setBranchMenuOpen((current) => {
                    const next = !current;
                    if (next && !branches.length && !branchLoading) {
                      loadBranches();
                    }
                    return next;
                  });
                  setSettingsOpen(false);
                  setMoreMenuOpen(false);
                }}
                disabled={
                  !attachmentSession?.sessionId || branchLoading || processing
                }
              >
                Branche: {currentBranch || "detachee"} ▾
              </button>
              {branchMenuOpen && (
                <div className="dropdown-menu">
                  <div className="dropdown-title">Branches</div>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={loadBranches}
                    disabled={
                      !attachmentSession?.sessionId ||
                      branchLoading ||
                      processing
                    }
                  >
                    {branchLoading ? "Chargement…" : "Rafraîchir"}
                  </button>
                  <div className="dropdown-divider" />
                  {branches.length ? (
                    branches.map((branch) => (
                      <button
                        key={branch}
                        type="button"
                        className={`menu-item ${
                          branch === currentBranch ? "is-active" : ""
                        }`}
                        onClick={() => handleBranchSelect(branch)}
                        disabled={branchLoading || processing}
                      >
                        {branch}
                      </button>
                    ))
                  ) : (
                    <div className="menu-label">Aucune branche distante</div>
                  )}
                </div>
              )}
            </div>
          )}

          {!isMobileLayout && supportsModels && (
            <div className="dropdown" ref={settingsRef}>
              <button
                type="button"
                className="pill-button"
                onClick={() => {
                  setSettingsOpen((current) => !current);
                  setMoreMenuOpen(false);
                }}
                disabled={!connected}
              >
                Modèle:{" "}
                {selectedModelDetails?.displayName ||
                  selectedModelDetails?.model ||
                  "par défaut"}{" "}
                ▾
              </button>
              {settingsOpen && (
                <div className="dropdown-menu">
                  <div className="dropdown-title">Paramètres</div>
                  <button
                    type="button"
                    className="menu-item"
                    onClick={requestModelList}
                    disabled={!connected || modelLoading}
                  >
                    {modelLoading ? "Chargement…" : "Rafraîchir la liste"}
                  </button>
                  <label className="menu-label">
                    Modèle
                    <select
                      className="model-select"
                      value={selectedModel}
                      onChange={handleModelChange}
                      disabled={
                        !connected || models.length === 0 || modelLoading
                      }
                    >
                      <option value="">Modele par defaut</option>
                      {models.map((model) => (
                        <option key={model.id} value={model.model}>
                          {model.displayName || model.model}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="menu-label">
                    Reasoning
                    <select
                      className="model-select"
                      value={selectedReasoningEffort}
                      onChange={handleReasoningEffortChange}
                      disabled={
                        !connected ||
                        !selectedModelDetails ||
                        !selectedModelDetails.supportedReasoningEfforts?.length ||
                        modelLoading
                      }
                    >
                      <option value="">Reasoning par defaut</option>
                      {(selectedModelDetails?.supportedReasoningEfforts || []).map(
                        (effort) => (
                          <option
                            key={effort.reasoningEffort}
                            value={effort.reasoningEffort}
                          >
                            {effort.reasoningEffort}
                          </option>
                        )
                      )}
                    </select>
                  </label>
                </div>
              )}
            </div>
          )}

          <div className="dropdown" ref={moreMenuRef}>
            <button
              type="button"
              className="pill-button"
              onClick={() => {
                setMoreMenuOpen((current) => {
                  const next = !current;
                  if (next && isMobileLayout && !branches.length && !branchLoading) {
                    loadBranches();
                  }
                  return next;
                });
                setSettingsOpen(false);
                setBranchMenuOpen(false);
              }}
            >
              ⋯
            </button>
            {moreMenuOpen && (
              <div className="dropdown-menu">
                {isMobileLayout && (
                  <>
                    <div className="dropdown-title">Session</div>
                    {hasSession && (
                      <button
                        type="button"
                        className={`menu-item ${
                          providerSwitching ? "is-active" : ""
                        }`}
                        onClick={() =>
                          handleProviderSwitch(
                            llmProvider === "codex" ? "claude" : "codex"
                          )
                        }
                        disabled={providerSwitching || processing}
                      >
                        {providerSwitching
                          ? "Basculement..."
                          : `LLM: ${llmProvider}`}
                      </button>
                    )}
                    <div className="menu-label">
                      Branche
                      <span>
                        {currentBranch ? currentBranch : "detachee"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="menu-item"
                      onClick={loadBranches}
                      disabled={
                        !attachmentSession?.sessionId ||
                        branchLoading ||
                        processing
                      }
                    >
                      {branchLoading ? "Chargement…" : "Rafraîchir les branches"}
                    </button>
                    {branches.length ? (
                      branches.map((branch) => (
                        <button
                          key={`mobile-branch-${branch}`}
                          type="button"
                          className={`menu-item ${
                            branch === currentBranch ? "is-active" : ""
                          }`}
                          onClick={() => handleBranchSelect(branch)}
                          disabled={branchLoading || processing}
                        >
                          {branch}
                        </button>
                      ))
                    ) : (
                      <div className="menu-label">Aucune branche distante</div>
                    )}
                    {supportsModels && (
                      <>
                        <div className="dropdown-divider" />
                        <div className="dropdown-title">Modèle</div>
                        <button
                          type="button"
                          className="menu-item"
                          onClick={requestModelList}
                          disabled={!connected || modelLoading}
                        >
                          {modelLoading
                            ? "Chargement…"
                            : "Rafraîchir la liste"}
                        </button>
                        <label className="menu-label">
                          Modèle
                          <select
                            className="model-select"
                            value={selectedModel}
                            onChange={handleModelChange}
                            disabled={
                              !connected || models.length === 0 || modelLoading
                            }
                          >
                            <option value="">Modele par defaut</option>
                            {models.map((model) => (
                              <option key={model.id} value={model.model}>
                                {model.displayName || model.model}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="menu-label">
                          Reasoning
                          <select
                            className="model-select"
                            value={selectedReasoningEffort}
                            onChange={handleReasoningEffortChange}
                            disabled={
                              !connected ||
                              !selectedModelDetails ||
                              !selectedModelDetails.supportedReasoningEfforts
                                ?.length ||
                              modelLoading
                            }
                          >
                            <option value="">Reasoning par defaut</option>
                            {(
                              selectedModelDetails?.supportedReasoningEfforts ||
                              []
                            ).map((effort) => (
                              <option
                                key={effort.reasoningEffort}
                                value={effort.reasoningEffort}
                              >
                                {effort.reasoningEffort}
                              </option>
                            ))}
                          </select>
                        </label>
                      </>
                    )}
                    <div className="dropdown-divider" />
                  </>
                )}
                <div className="dropdown-title">Vue</div>
                <button
                  type="button"
                  className={`menu-item ${
                    activePane === "chat" ? "is-active" : ""
                  }`}
                  onClick={() => handleViewSelect("chat")}
                >
                  Messages
                </button>
                <button
                  type="button"
                  className={`menu-item ${
                    activePane === "diff" ? "is-active" : ""
                  }`}
                  onClick={() => handleViewSelect("diff")}
                >
                  Diff
                </button>
                <button
                  type="button"
                  className={`menu-item ${
                    activePane === "terminal" ? "is-active" : ""
                  }`}
                  onClick={() => handleViewSelect("terminal")}
                >
                  Terminal
                </button>
                <button
                  type="button"
                  className={`menu-item ${
                    activePane === "logs" ? "is-active" : ""
                  }`}
                  onClick={() => handleViewSelect("logs")}
                >
                  Logs
                </button>
                <button
                  type="button"
                  className={`menu-item ${
                    activePane === "settings" ? "is-active" : ""
                  }`}
                  onClick={() => handleViewSelect("settings")}
                >
                  Paramètres
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => handleExportChat("markdown")}
                  disabled={messages.length === 0}
                >
                  Export markdown
                </button>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => handleExportChat("json")}
                  disabled={messages.length === 0}
                >
                  Export JSON
                </button>
                <div className="dropdown-divider" />
                <button
                  type="button"
                  className="menu-item danger"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleClearChat();
                  }}
                  disabled={messages.length === 0}
                >
                  Clear chat
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div
        className={`layout ${sideOpen ? "is-side-open" : "is-side-collapsed"} ${
          isMobileLayout ? "is-mobile" : ""
        }`}
      >
        {isMobileLayout && sideOpen ? (
          <button
            type="button"
            className="side-backdrop"
            aria-label="Fermer le panneau"
            onClick={() => setSideOpen(false)}
          />
        ) : null}

        <aside className="side">
          <div className="side-tabs">
            <button
              type="button"
              className={`side-tab ${
                sideTab === "attachments" ? "is-active" : ""
              }`}
              onClick={() => openSidePanel("attachments")}
            >
              Pièces <span className="badge">{attachments.length}</span>
            </button>
            <button
              type="button"
              className={`side-tab ${sideTab === "backlog" ? "is-active" : ""}`}
              onClick={() => openSidePanel("backlog")}
            >
              Backlog <span className="badge">{backlog.length}</span>
            </button>
          </div>

          <div className="side-body">
            {sideTab === "attachments" ? (
              <div className="attachments">
                <div className="panel-header">
                  <div className="panel-title">Pièces jointes</div>
                  <div className="panel-subtitle">
                    {repoName || "Session en cours…"}
                  </div>
                </div>

                <label
                  className={`upload ${
                    !attachmentSession || attachmentsLoading ? "disabled" : ""
                  }`}
                >
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    onChange={onUploadAttachments}
                    disabled={!attachmentSession || attachmentsLoading}
                  />
                  <span>Ajouter des fichiers</span>
                </label>

                <div className="attachments-meta">
                  <span>
                    Sélectionnées: {selectedAttachments.length}/
                    {attachments.length}
                  </span>
                  {attachmentsLoading && <span>Chargement…</span>}
                </div>

                {attachmentsError && (
                  <div className="attachments-error">{attachmentsError}</div>
                )}

                {attachments.length === 0 ? (
                  <div className="attachments-empty">
                    Aucune pièce jointe pour cette session.
                  </div>
                ) : (
                  <ul className="attachments-list">
                    {attachments.map((file) => {
                      const isSelected = selectedAttachments.includes(file.path);
                      return (
                        <li key={file.path}>
                          <label className="attachments-item">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleAttachment(file.path)}
                            />
                            <span className="attachments-name">{file.name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <section className="backlog">
                <div className="panel-header">
                  <div className="panel-title">Backlog</div>
                  <div className="panel-subtitle">
                    {backlog.length === 0
                      ? "Aucune tâche"
                      : `${backlog.length} élément(s)`}
                  </div>
                </div>
                {backlog.length === 0 ? (
                  <div className="backlog-empty">
                    Aucune tâche en attente pour le moment.
                  </div>
                ) : (
                  <ul className="backlog-list">
                    {backlog.map((item) => (
                      <li key={item.id} className="backlog-item">
                        <div className="backlog-text">
                          {getTruncatedText(item.text, 180)}
                        </div>
                        <div className="backlog-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => editBacklogItem(item)}
                          >
                            Éditer
                          </button>
                          <button
                            type="button"
                            onClick={() => launchBacklogItem(item)}
                            disabled={!connected}
                          >
                            Lancer
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => removeFromBacklog(item.id)}
                          >
                            Supprimer
                          </button>
                        </div>
                        {item.attachments?.length ? (
                          <div className="backlog-meta">
                            {item.attachments.length} pièce(s) jointe(s)
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        </aside>

        <section className="conversation">
          {/* Worktree Tabs - Always visible */}
          <WorktreeTabs
            worktrees={allTabs}
            activeWorktreeId={activeWorktreeId}
            onSelect={setActiveWorktreeId}
            onCreate={createWorktree}
            onClose={closeWorktree}
            onRename={renameWorktreeHandler}
            provider={llmProvider}
            disabled={!connected}
          />

          <div className="pane-stack">
            <main className={`chat ${activePane === "chat" ? "" : "is-hidden"}`}>
              <div className="chat-scroll" ref={listRef}>
                {currentMessages.length === 0 && (
                  <div className="empty">
                    <p>Envoyez un message pour demarrer une session.</p>
                  </div>
                )}
                {displayedGroupedMessages.map((message) => {
                  if (message?.groupType === "commandExecution") {
                    return (
                      <div
                        key={message.id}
                        className="bubble command-execution"
                      >
                        {message.items.map((item) => {
                          const commandTitle = `Commande : ${
                            item.command || "Commande"
                          }`;
                          const showLoader = item.status !== "completed";
                          const isExpandable =
                            item.isExpandable || Boolean(item.output);
                          const summaryContent = (
                            <>
                              {showLoader && (
                                <span
                                  className="loader command-execution-loader"
                                  title="Execution en cours"
                                >
                                  <span className="dot" />
                                  <span className="dot" />
                                  <span className="dot" />
                                </span>
                              )}
                              <span className="command-execution-title">
                                {commandTitle}
                              </span>
                            </>
                          );
                          return (
                            <div key={item.id}>
                              {isExpandable ? (
                                <details
                                  className="command-execution-panel"
                                  open={Boolean(commandPanelOpen[item.id])}
                                  onToggle={(event) => {
                                    const isOpen = event.currentTarget.open;
                                    setCommandPanelOpen((prev) => ({
                                      ...prev,
                                      [item.id]: isOpen,
                                    }));
                                  }}
                                >
                                  <summary className="command-execution-summary">
                                    {summaryContent}
                                  </summary>
                                  <pre className="command-execution-output">
                                    {item.output || ""}
                                  </pre>
                                </details>
                              ) : (
                                <div className="command-execution-summary is-static">
                                  {summaryContent}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    );
                  }
                  const isLongUserMessage =
                    message.role === "user" &&
                    (message.text || "").length > MAX_USER_DISPLAY_LENGTH;
                  if (isLongUserMessage) {
                    const truncatedText = getTruncatedText(
                      message.text,
                      MAX_USER_DISPLAY_LENGTH
                    );
                    return (
                      <div key={message.id} className={`bubble ${message.role}`}>
                        <div className="plain-text">{truncatedText}</div>
                      </div>
                    );
                  }

                  return (
                    <div key={message.id} className={`bubble ${message.role}`}>
                      {(() => {
                        const { cleanedText, blocks } = extractChoices(
                          message.text
                        );
                        return (
                          <>
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                a: ({ node, ...props }) => (
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                ),
                              }}
                            >
                              {cleanedText}
                            </ReactMarkdown>
                            {blocks.map((block, index) => {
                              const blockKey = `${message.id}-${index}`;
                              const selectedIndex = choiceSelections[blockKey];
                              const choicesWithIndex = block.choices.map(
                                (choice, choiceIndex) => ({
                                  choice,
                                  choiceIndex,
                                })
                              );
                              const orderedChoices =
                                selectedIndex === undefined
                                  ? choicesWithIndex
                                  : [
                                      choicesWithIndex.find(
                                        ({ choiceIndex }) =>
                                          choiceIndex === selectedIndex
                                      ),
                                      ...choicesWithIndex.filter(
                                        ({ choiceIndex }) =>
                                          choiceIndex !== selectedIndex
                                      ),
                                    ].filter(Boolean);

                              return (
                                <div className="choices" key={blockKey}>
                                  {block.question && (
                                    <div className="choices-question">
                                      {block.question}
                                    </div>
                                  )}
                                  <div
                                    className={`choices-list ${
                                      selectedIndex !== undefined
                                        ? "is-selected"
                                        : ""
                                    }`}
                                  >
                                    {orderedChoices.map(
                                      ({ choice, choiceIndex }) => {
                                        const isSelected =
                                          selectedIndex === choiceIndex;
                                        return (
                                          <button
                                            type="button"
                                            key={`${blockKey}-${choiceIndex}`}
                                            onClick={() =>
                                              handleChoiceClick(
                                                choice,
                                                blockKey,
                                                choiceIndex
                                              )
                                            }
                                            className={`choice-button ${
                                              isSelected
                                                ? "is-selected"
                                                : selectedIndex !== undefined
                                                  ? "is-muted"
                                                  : ""
                                            }`}
                                          >
                                            <ReactMarkdown
                                              remarkPlugins={[remarkGfm]}
                                              components={{
                                                p: ({ node, ...props }) => (
                                                  <span {...props} />
                                                ),
                                                a: ({ node, ...props }) => (
                                                  <a
                                                    {...props}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                  />
                                                ),
                                              }}
                                            >
                                              {choice}
                                            </ReactMarkdown>
                                          </button>
                                        );
                                      }
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
              {processing && (
                <div className="bubble assistant typing">
                  <div className="typing-indicator">
                    <div
                      className="loader"
                      title={activity || "Traitement en cours..."}
                    >
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                    <span className="typing-text">
                      {activity || "Traitement en cours..."}
                    </span>
                  </div>
                </div>
              )}
            </main>
            <div
              className={`diff-panel ${
                activePane === "diff" ? "" : "is-hidden"
              }`}
            >
              <div className="diff-header">
                <div className="diff-title">Diff du repository</div>
                {diffStatusLines.length > 0 && (
                  <div className="diff-count">
                    {diffStatusLines.length} fichiers modifies
                  </div>
                )}
                <div className="diff-actions">
                  <button
                    type="button"
                    className="diff-action-button"
                    onClick={() => sendCommitMessage("Commit")}
                    disabled={!connected || processing}
                    title="Envoyer 'Commit' dans le chat"
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    className="diff-action-button primary"
                    onClick={() => sendCommitMessage("Commit & Push")}
                    disabled={!connected || processing}
                    title="Envoyer 'Commit & Push' dans le chat"
                  >
                    Commit &amp; Push
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
              {diffFiles.length > 0 ? (
                <div className="diff-body">
                  {diffFiles.map((file) => {
                    const fileLabel = file.newPath || file.oldPath || "Diff";
                    return (
                      <div
                        key={`${file.oldPath}-${file.newPath}-${file.type}`}
                        className="diff-file"
                      >
                        <div className="diff-file-header">{fileLabel}</div>
                        <Diff
                          viewType="unified"
                          diffType={file.type}
                          hunks={file.hunks}
                        >
                          {(hunks) =>
                            hunks.map((hunk) => (
                              <Hunk key={hunk.content} hunk={hunk} />
                            ))
                          }
                        </Diff>
                      </div>
                    );
                  })}
                </div>
              ) : repoDiff.diff ? (
                <pre className="diff-fallback">{repoDiff.diff}</pre>
              ) : (
                <div className="diff-empty">Aucun changement detecte.</div>
              )}
            </div>
            <div
              className={`terminal-panel ${
                activePane === "terminal" ? "" : "is-hidden"
              }`}
            >
            <div className="terminal-header">
              <div className="terminal-title">Terminal</div>
              {repoName && <div className="terminal-meta">{repoName}</div>}
            </div>
            <div className="terminal-body" ref={terminalContainerRef} />
            {!attachmentSession?.sessionId && (
              <div className="terminal-empty">
                Demarrez une session pour ouvrir le terminal.
              </div>
            )}
          </div>
            <div
              className={`logs-panel ${
                activePane === "logs" ? "" : "is-hidden"
              }`}
            >
            <div className="logs-header">
              <div className="logs-title">JSON-RPC</div>
              <div className="logs-controls">
                <div className="logs-count">{filteredRpcLogs.length} events</div>
                <div className="logs-filters">
                  <button
                    type="button"
                    className={`logs-filter ${
                      logFilter === "all" ? "is-active" : ""
                    }`}
                    onClick={() => setLogFilter("all")}
                  >
                    Tout
                  </button>
                  <button
                    type="button"
                    className={`logs-filter ${
                      logFilter === "stdin" ? "is-active" : ""
                    }`}
                    onClick={() => setLogFilter("stdin")}
                  >
                    Stdin
                  </button>
                  <button
                    type="button"
                    className={`logs-filter ${
                      logFilter === "stdout" ? "is-active" : ""
                    }`}
                    onClick={() => setLogFilter("stdout")}
                  >
                    Stdout
                  </button>
                </div>
                <button
                  type="button"
                  className="logs-clear"
                  onClick={() => setRpcLogs([])}
                  disabled={rpcLogs.length === 0}
                >
                  Clear
                </button>
              </div>
            </div>
            {filteredRpcLogs.length === 0 ? (
              <div className="logs-empty">Aucun log pour le moment.</div>
            ) : (
              <div className="logs-list">
                {filteredRpcLogs.map((entry, index) => (
                  <div
                    key={`${entry.timestamp}-${index}`}
                    className={`logs-item logs-${entry.direction}`}
                  >
                    <div className="logs-meta">
                      <span className="logs-direction">
                        {entry.direction === "stdin" ? "stdin" : "stdout"}
                      </span>
                      <span className="logs-time">{entry.timeLabel}</span>
                      {entry.payload?.method && (
                        <span className="logs-method">
                          {entry.payload.method}
                        </span>
                      )}
                    </div>
                    <pre className="logs-payload">
                      {JSON.stringify(entry.payload, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div
            className={`settings-panel ${
              activePane === "settings" ? "" : "is-hidden"
            }`}
          >
            <div className="settings-header">
              <div className="settings-title">Paramètres utilisateur</div>
              <div className="settings-subtitle">
                Ces réglages sont stockés dans votre navigateur.
              </div>
            </div>
            <div className="settings-group">
              <label className="settings-item">
                <span className="settings-text">
                  <span className="settings-name">
                    Afficher les commandes dans le chat
                  </span>
                  <span className="settings-hint">
                    Affiche les blocs de commandes exécutées dans la conversation.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  checked={showChatCommands}
                  onChange={(event) =>
                    setShowChatCommands(event.target.checked)
                  }
                />
              </label>
              <label className="settings-item">
                <span className="settings-text">
                  <span className="settings-name">Notifications</span>
                  <span className="settings-hint">
                    Affiche une notification et un son quand un nouveau message
                    arrive.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  checked={notificationsEnabled}
                  onChange={(event) =>
                    setNotificationsEnabled(event.target.checked)
                  }
                />
              </label>
            </div>
          </div>
          </div>

          <form className="composer composer--sticky" onSubmit={onSubmit}>
            <div className="composer-main">
              <button
                type="button"
                className="icon-button composer-attach-button"
                aria-label="Ajouter une pièce jointe"
                onClick={triggerAttachmentPicker}
                disabled={!attachmentSession || attachmentsLoading}
              >
                ＋
                {isMobileLayout ? (
                  <span className="attachment-badge">
                    {selectedAttachments.length}
                  </span>
                ) : null}
              </button>
              <textarea
                className="composer-input"
                value={input}
                onChange={handleInputChange}
                onPaste={onPasteAttachments}
                placeholder="Écris ton message…"
                rows={isMobileLayout ? 1 : 3}
                ref={inputRef}
              />
              <button
                type="submit"
                className="primary"
                disabled={!connected || !input.trim()}
              >
                <span className="send-text">Envoyer</span>
                <span className="send-icon">➤</span>
              </button>
            </div>

            {(!isMobileLayout || (processing && currentTurnId)) && (
              <div className="composer-meta">
                <button
                  type="button"
                  className="link-button"
                  onClick={() => openSidePanel("attachments")}
                >
                  Pièces: {selectedAttachments.length}
                </button>
                <div className="composer-actions">
                  {processing && currentTurnId ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={interruptTurn}
                    >
                      Stop
                    </button>
                  ) : null}
                  {!isMobileLayout && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={addToBacklog}
                      disabled={!input.trim()}
                    >
                      Ajouter à la backlog
                    </button>
                  )}
                </div>
              </div>
            )}

            {selectedAttachmentNames.length ? (
              <div className="composer-chips" aria-label="Pièces sélectionnées">
                {selectedAttachmentNames.slice(0, 3).map((name) => (
                  <span className="chip" key={name}>
                    {name}
                  </span>
                ))}
                {selectedAttachmentNames.length > 3 ? (
                  <span className="chip chip-muted">
                    +{selectedAttachmentNames.length - 3}
                  </span>
                ) : null}
              </div>
            ) : null}
          </form>
        </section>
      </div>
    </div>
  );
}

export default App;
