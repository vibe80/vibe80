import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "@uiw/react-markdown-preview/markdown.css";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBroom,
  faChevronDown,
  faChevronRight,
  faClipboardList,
  faComments,
  faCodeCompare,
  faCopy,
  faDownload,
  faFileLines,
  faFolderTree,
  faGear,
  faPaperclip,
  faRightFromBracket,
  faTerminal,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
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

const WORKSPACE_TOKEN_KEY = "workspaceToken";
const WORKSPACE_ID_KEY = "workspaceId";

const readWorkspaceToken = () => {
  try {
    return localStorage.getItem(WORKSPACE_TOKEN_KEY) || "";
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

const encodeBase64 = (value) => {
  if (!value) {
    return "";
  }
  try {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  } catch {
    return btoa(value);
  }
};

const wsUrl = (sessionId, token) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("session", sessionId);
  }
  if (token) {
    params.set("token", token);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return `${protocol}://${window.location.host}/ws${suffix}`;
};

const terminalWsUrl = (sessionId, worktreeId, token) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("session", sessionId);
  }
  if (worktreeId) {
    params.set("worktreeId", worktreeId);
  }
  if (token) {
    params.set("token", token);
  }
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return `${protocol}://${window.location.host}/terminal${suffix}`;
};

const normalizeVibecoderQuestion = (rawQuestion) => {
  const trimmed = rawQuestion?.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const parseFormFields = (blockBody) => {
  if (!blockBody) {
    return [];
  }
  return blockBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("::");
      const [rawType, rawId, rawLabel, ...rest] = parts;
      const type = (rawType || "").trim().toLowerCase();
      const id = (rawId || "").trim();
      const label = (rawLabel || "").trim();
      if (!type || !id || !label) {
        return null;
      }
      if (type === "radio" || type === "select") {
        const choices = rest.map((item) => item.trim()).filter(Boolean);
        return { type, id, label, choices };
      }
      if (type === "checkbox") {
        const rawValue = rest.join("::").trim();
        const defaultChecked = rawValue === "1";
        return { type, id, label, defaultChecked };
      }
      if (type === "input" || type === "textarea") {
        const defaultValue = rest.join("::").trim();
        return { type, id, label, defaultValue };
      }
      return null;
    })
    .filter(Boolean);
};

const extractVibecoderBlocks = (text) => {
  const pattern =
    /<!--\s*vibecoder:(choices|form)\s*([^>]*)-->([\s\S]*?)<!--\s*\/vibecoder:\1\s*-->|<!--\s*vibecoder:yesno\s*([^>]*)-->/g;
  const filerefPattern = /<!--\s*vibecoder:fileref\s+([^>]+?)\s*-->/g;
  const blocks = [];
  const filerefs = [];
  const normalizedText = String(text || "").replace(
    filerefPattern,
    (_, filePath) => {
      const trimmed = String(filePath || "").trim();
      if (trimmed) {
        filerefs.push(trimmed);
      }
      return "";
    }
  );
  let cleaned = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(normalizedText)) !== null) {
    cleaned += normalizedText.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const blockType = match[1];
    const question = normalizeVibecoderQuestion(match[2] || match[4]);
    const body = match[3] || "";

    if (!blockType) {
      blocks.push({
        type: "yesno",
        question,
        choices: ["Oui", "Non"],
      });
      continue;
    }

    if (blockType === "choices") {
      const choices = body
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (choices.length) {
        blocks.push({ type: "choices", question, choices });
      }
      continue;
    }

    const fields = parseFormFields(body);
    if (fields.length) {
      blocks.push({ type: "form", question, fields });
    }
  }

  if (!blocks.length) {
    return { cleanedText: normalizedText, blocks: [], filerefs };
  }

  cleaned += normalizedText.slice(lastIndex);
  return { cleanedText: cleaned.trim(), blocks, filerefs };
};

const copyTextToClipboard = async (text) => {
  if (!text) {
    return;
  }
  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to legacy copy behavior.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "absolute";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
};

const MAX_USER_DISPLAY_LENGTH = 1024;
const REPO_HISTORY_KEY = "repoHistory";
const AUTH_MODE_KEY = "authMode";
const OPENAI_AUTH_MODE_KEY = "openAiAuthMode";
const LLM_PROVIDER_KEY = "llmProvider";
const LLM_PROVIDERS_KEY = "llmProviders";
const CHAT_COMMANDS_VISIBLE_KEY = "chatCommandsVisible";
const TOOL_RESULTS_VISIBLE_KEY = "toolResultsVisible";
const CHAT_FULL_WIDTH_KEY = "chatFullWidth";
const NOTIFICATIONS_ENABLED_KEY = "notificationsEnabled";
const THEME_MODE_KEY = "themeMode";
const COMPOSER_INPUT_MODE_KEY = "composerInputMode";
const DEBUG_MODE_KEY = "debugMode";
const MAX_REPO_HISTORY = 10;
const SOCKET_PING_INTERVAL_MS = 25000;
const SOCKET_PONG_GRACE_MS = 8000;
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
]);

const getTruncatedText = (text, limit) => {
  if (!text) {
    return "";
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}…`;
};

const getAttachmentName = (attachment) => {
  if (!attachment) {
    return "";
  }
  if (typeof attachment === "string") {
    const parts = attachment.split("/");
    return parts[parts.length - 1] || attachment;
  }
  if (attachment.name) {
    return attachment.name;
  }
  if (attachment.path) {
    const parts = attachment.path.split("/");
    return parts[parts.length - 1] || attachment.path;
  }
  return "";
};

const getAttachmentExtension = (attachment) => {
  const name = getAttachmentName(attachment);
  if (!name || !name.includes(".")) {
    return "FILE";
  }
  const ext = name.split(".").pop();
  return ext ? ext.toUpperCase() : "FILE";
};

const formatAttachmentSize = (bytes) => {
  if (!Number.isFinite(bytes)) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} o`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${Math.round(kb)} Ko`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} Mo`;
};

const normalizeAttachments = (attachments) => {
  if (!Array.isArray(attachments)) {
    return [];
  }
  return attachments
    .map((item) => {
      if (!item) {
        return null;
      }
      if (typeof item === "string") {
        const name = getAttachmentName(item);
        return { name, path: item };
      }
      if (typeof item === "object") {
        const name = item.name || getAttachmentName(item.path);
        return { ...item, name };
      }
      return null;
    })
    .filter(Boolean);
};

const isImageAttachment = (attachment) => {
  const name = getAttachmentName(attachment);
  if (!name || !name.includes(".")) {
    return false;
  }
  const ext = name.split(".").pop()?.toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
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

const readToolResultsVisible = () => {
  try {
    const stored = localStorage.getItem(TOOL_RESULTS_VISIBLE_KEY);
    if (stored === "true" || stored === "false") {
      return stored === "true";
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return false;
};

const readChatFullWidth = () => {
  try {
    const stored = localStorage.getItem(CHAT_FULL_WIDTH_KEY);
    if (stored === "true" || stored === "false") {
      return stored === "true";
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return false;
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

const readThemeMode = () => {
  try {
    const stored = localStorage.getItem(THEME_MODE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return "light";
};

const readComposerInputMode = () => {
  try {
    const stored = localStorage.getItem(COMPOSER_INPUT_MODE_KEY);
    if (stored === "single" || stored === "multi") {
      return stored;
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return "multi";
};

const readDebugMode = () => {
  try {
    const stored = localStorage.getItem(DEBUG_MODE_KEY);
    if (stored === "true" || stored === "false") {
      return stored === "true";
    }
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return false;
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

const readLlmProviders = () => {
  try {
    const stored = localStorage.getItem(LLM_PROVIDERS_KEY);
    if (!stored) {
      return [readLlmProvider()];
    }
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return [readLlmProvider()];
    }
    const filtered = parsed.filter(
      (entry) => entry === "codex" || entry === "claude"
    );
    return filtered.length ? filtered : [readLlmProvider()];
  } catch (error) {
    // Ignore storage errors (private mode, quota).
  }
  return [readLlmProvider()];
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
  const [draftAttachments, setDraftAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState("");
  const [repoUrl, setRepoUrl] = useState(getInitialRepoUrl);
  const [repoInput, setRepoInput] = useState(getInitialRepoUrl);
  const [repoAuth, setRepoAuth] = useState(null);
  const [authMode, setAuthMode] = useState(readAuthMode);
  const [sshKeyInput, setSshKeyInput] = useState("");
  const [httpUsername, setHttpUsername] = useState("");
  const [httpPassword, setHttpPassword] = useState("");
  const [workspaceStep, setWorkspaceStep] = useState(1);
  const [workspaceMode, setWorkspaceMode] = useState("existing");
  const [workspaceIdInput, setWorkspaceIdInput] = useState(readWorkspaceId());
  const [workspaceSecretInput, setWorkspaceSecretInput] = useState("");
  const [workspaceToken, setWorkspaceToken] = useState(readWorkspaceToken());
  const [workspaceId, setWorkspaceId] = useState(readWorkspaceId());
  const [workspaceCreated, setWorkspaceCreated] = useState(null);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceProviders, setWorkspaceProviders] = useState(() => ({
    codex: { enabled: false, authType: "api_key", authValue: "" },
    claude: { enabled: false, authType: "auth_json_b64", authValue: "" },
  }));
  const [llmProvider, setLlmProvider] = useState(readLlmProvider);
  const [selectedProviders, setSelectedProviders] = useState(readLlmProviders);
  const [providerSwitching, setProviderSwitching] = useState(false);
  const [openAiAuthMode, setOpenAiAuthMode] = useState(readOpenAiAuthMode);
  const [openAiAuthFile, setOpenAiAuthFile] = useState(null);
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [openAiLoginError, setOpenAiLoginError] = useState("");
  const [openAiLoginPending, setOpenAiLoginPending] = useState(false);
  const [openAiLoginRequest, setOpenAiLoginRequest] = useState(null);
  const [openAiReady, setOpenAiReady] = useState(false);
  const [claudeAuthFile, setClaudeAuthFile] = useState(null);
  const [claudeLoginError, setClaudeLoginError] = useState("");
  const [claudeLoginPending, setClaudeLoginPending] = useState(false);
  const [claudeReady, setClaudeReady] = useState(false);
  const [appServerReady, setAppServerReady] = useState(false);
  const [sessionRequested, setSessionRequested] = useState(() =>
    Boolean(getInitialRepoUrl())
  );
  const [showChatCommands, setShowChatCommands] = useState(
    readChatCommandsVisible
  );
  const [showToolResults, setShowToolResults] = useState(
    readToolResultsVisible
  );
  const [chatFullWidth, setChatFullWidth] = useState(readChatFullWidth);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    readNotificationsEnabled
  );
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const [composerInputMode, setComposerInputMode] = useState(
    readComposerInputMode
  );
  const soundEnabled = notificationsEnabled;
  const [gitIdentityName, setGitIdentityName] = useState("");
  const [gitIdentityEmail, setGitIdentityEmail] = useState("");
  const [gitIdentityGlobal, setGitIdentityGlobal] = useState({
    name: "",
    email: "",
  });
  const [gitIdentityRepo, setGitIdentityRepo] = useState({ name: "", email: "" });
  const [gitIdentityLoading, setGitIdentityLoading] = useState(false);
  const [gitIdentitySaving, setGitIdentitySaving] = useState(false);
  const [gitIdentityError, setGitIdentityError] = useState("");
  const [gitIdentityMessage, setGitIdentityMessage] = useState("");
  const [choiceSelections, setChoiceSelections] = useState({});
  const [activeForm, setActiveForm] = useState(null);
  const [activeFormValues, setActiveFormValues] = useState({});
  const [paneByTab, setPaneByTab] = useState({ main: "chat" });
  const explorerDefaultState = useMemo(
    () => ({
      tree: null,
      loading: false,
      error: "",
      treeTruncated: false,
      treeTotal: 0,
      selectedPath: null,
      fileContent: "",
      draftContent: "",
      fileLoading: false,
      fileSaving: false,
      fileError: "",
      fileSaveError: "",
      fileTruncated: false,
      fileBinary: false,
      editMode: false,
      isDirty: false,
      statusByPath: {},
      statusLoading: false,
      statusError: "",
      statusLoaded: false,
      expandedPaths: [],
    }),
    []
  );
  const [explorerByTab, setExplorerByTab] = useState({});
  const [repoDiff, setRepoDiff] = useState({ status: "", diff: "" });
  const [backlog, setBacklog] = useState([]);
  const [currentTurnId, setCurrentTurnId] = useState(null);
  const [rpcLogs, setRpcLogs] = useState([]);
  const [rpcLogsEnabled, setRpcLogsEnabled] = useState(true);
  const [logFilterByTab, setLogFilterByTab] = useState({ main: "all" });
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedReasoningEffort, setSelectedReasoningEffort] = useState("");
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState("");
  const [providerModelState, setProviderModelState] = useState({});
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");
  const [branchLoading, setBranchLoading] = useState(false);
  const [branchError, setBranchError] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [attachmentPreview, setAttachmentPreview] = useState(null);
  const [closeConfirm, setCloseConfirm] = useState(null);
  const [terminalEnabled, setTerminalEnabled] = useState(true);
  const explorerRef = useRef({});
  // Worktree states for parallel LLM requests
  const [worktrees, setWorktrees] = useState(new Map());
  const [activeWorktreeId, setActiveWorktreeId] = useState("main"); // "main" = legacy mode, other = worktree mode
  const activePane = paneByTab[activeWorktreeId] || "chat";
  const activeWorktreeIdRef = useRef("main");
  const lastPaneByTabRef = useRef(new Map());
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    window.matchMedia("(max-width: 1024px)").matches
  );
  const activeExplorer = explorerByTab[activeWorktreeId] || explorerDefaultState;
  const explorerStatusByPath = activeExplorer.statusByPath || {};
  const explorerDirStatus = useMemo(() => {
    const dirStatus = {};
    const setStatus = (dirPath, type) => {
      if (!dirPath) {
        return;
      }
      const existing = dirStatus[dirPath];
      if (existing === "untracked") {
        return;
      }
      if (type === "untracked") {
        dirStatus[dirPath] = "untracked";
        return;
      }
      if (!existing) {
        dirStatus[dirPath] = type;
      }
    };
    Object.entries(explorerStatusByPath).forEach(([path, type]) => {
      if (!path) {
        return;
      }
      const parts = path.split("/").filter(Boolean);
      if (parts.length <= 1) {
        return;
      }
      for (let i = 0; i < parts.length - 1; i += 1) {
        const dirPath = parts.slice(0, i + 1).join("/");
        setStatus(dirPath, type);
      }
    });
    return dirStatus;
  }, [explorerStatusByPath]);
  const getItemActivityLabel = (item) => {
    if (!item?.type) {
      return "";
    }
    if (item.type === "commandExecution") {
      const command = item.commandActions?.command || item.command || "Commande";
      return `Commande: ${command}`;
    }
    if (item.type === "fileChange") {
      return "Application de modifications...";
    }
    if (item.type === "mcpToolCall") {
      return `Outil: ${item.tool}`;
    }
    if (item.type === "reasoning") {
      return "Raisonnement...";
    }
    if (item.type === "agentMessage") {
      return "Generation de reponse...";
    }
    return "";
  };
  const [commandPanelOpen, setCommandPanelOpen] = useState({});
  const [toolResultPanelOpen, setToolResultPanelOpen] = useState({});
  const [toolbarExportOpen, setToolbarExportOpen] = useState(false);
  const [repoHistory, setRepoHistory] = useState(() => readRepoHistory());
  const [debugMode, setDebugMode] = useState(() => readDebugMode());
  const socketRef = useRef(null);
  const rpcLogsEnabledRef = useRef(true);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const toolbarExportRef = useRef(null);
  const conversationRef = useRef(null);
  const composerRef = useRef(null);
  const initialBranchRef = useRef("");
  const terminalContainerRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalFitRef = useRef(null);
  const terminalDisposableRef = useRef(null);
  const terminalSocketRef = useRef(null);
  const terminalSessionRef = useRef(null);
  const terminalWorktreeRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const closingRef = useRef(false);
  const lastNotifiedIdRef = useRef(null);
  const audioContextRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const lastPongRef = useRef(0);
  const messagesRef = useRef([]);

  const apiFetch = useCallback(
    (input, init = {}) => {
      const headers = new Headers(init.headers || {});
      if (workspaceToken) {
        headers.set("Authorization", `Bearer ${workspaceToken}`);
      }
      return fetch(input, { ...init, headers });
    },
    [workspaceToken]
  );

  const loadGitIdentity = useCallback(async () => {
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    setGitIdentityLoading(true);
    setGitIdentityError("");
    setGitIdentityMessage("");
    try {
      const response = await apiFetch(
        `/api/session/${encodeURIComponent(sessionId)}/git-identity`
      );
      if (!response.ok) {
        throw new Error("Impossible de charger l'identité Git.");
      }
      const payload = await response.json();
      const globalName = payload?.global?.name || "";
      const globalEmail = payload?.global?.email || "";
      const repoName = payload?.repo?.name || "";
      const repoEmail = payload?.repo?.email || "";
      setGitIdentityGlobal({ name: globalName, email: globalEmail });
      setGitIdentityRepo({ name: repoName, email: repoEmail });
      setGitIdentityName(repoName || globalName);
      setGitIdentityEmail(repoEmail || globalEmail);
    } catch (error) {
      setGitIdentityError(error?.message || "Erreur lors du chargement.");
    } finally {
      setGitIdentityLoading(false);
    }
  }, [attachmentSession?.sessionId, apiFetch]);

  const handleSaveGitIdentity = useCallback(async () => {
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    const name = gitIdentityName.trim();
    const email = gitIdentityEmail.trim();
    if (!name || !email) {
      setGitIdentityError("Nom et email requis.");
      return;
    }
    setGitIdentitySaving(true);
    setGitIdentityError("");
    setGitIdentityMessage("");
    try {
      const response = await apiFetch(
        `/api/session/${encodeURIComponent(sessionId)}/git-identity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email }),
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Echec de la mise à jour.");
      }
      const payload = await response.json().catch(() => ({}));
      const repoName = payload?.repo?.name || name;
      const repoEmail = payload?.repo?.email || email;
      setGitIdentityRepo({ name: repoName, email: repoEmail });
      setGitIdentityMessage("Identité Git du dépôt mise à jour.");
    } catch (error) {
      setGitIdentityError(error?.message || "Echec de la mise à jour.");
    } finally {
      setGitIdentitySaving(false);
    }
  }, [attachmentSession?.sessionId, apiFetch, gitIdentityEmail, gitIdentityName]);

  const messageIndex = useMemo(() => new Map(), []);
  const commandIndex = useMemo(() => new Map(), []);
  const repoName = useMemo(
    () => extractRepoName(attachmentSession?.repoUrl),
    [attachmentSession?.repoUrl]
  );
  const authenticatedProviders = useMemo(() => {
    const list = [];
    if (openAiReady) {
      list.push("codex");
    }
    if (claudeReady) {
      list.push("claude");
    }
    return list;
  }, [openAiReady, claudeReady]);
  const availableProviders = useMemo(
    () => selectedProviders.filter((provider) => authenticatedProviders.includes(provider)),
    [selectedProviders, authenticatedProviders]
  );
  const getAttachmentUrl = useCallback(
    (attachment) => {
      if (!attachmentSession?.sessionId) {
        return "";
      }
      const url = new URL("/api/attachments/file", window.location.origin);
      url.searchParams.set("session", attachmentSession.sessionId);
      if (workspaceToken) {
        url.searchParams.set("token", workspaceToken);
      }
      if (attachment?.path) {
        url.searchParams.set("path", attachment.path);
      } else if (attachment?.name) {
        url.searchParams.set("name", attachment.name);
      }
      return url.toString();
    },
    [attachmentSession?.sessionId, workspaceToken]
  );
  const renderMessageAttachments = useCallback(
    (attachments = []) => {
      const normalized = normalizeAttachments(attachments);
      if (!normalized.length) {
        return null;
      }
      return (
        <div className="bubble-attachments">
          {normalized.map((attachment) => {
            const name = getAttachmentName(attachment);
            const url = getAttachmentUrl(attachment);
            const key = attachment?.path || attachment?.name || name;
            if (isImageAttachment(attachment)) {
              return (
                <button
                  type="button"
                  key={key}
                  className="attachment-card attachment-card--image"
                  onClick={() =>
                    url ? setAttachmentPreview({ url, name }) : null
                  }
                  disabled={!url}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={name || "Image jointe"}
                      className="attachment-thumb"
                      loading="lazy"
                    />
                  ) : (
                    <div className="attachment-thumb attachment-thumb--empty" />
                  )}
                  <span className="attachment-name">{name}</span>
                </button>
              );
            }
            if (url) {
              return (
                <a
                  key={key}
                  className="attachment-card"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="attachment-icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faPaperclip} />
                  </span>
                  <span className="attachment-name">{name}</span>
                </a>
              );
            }
            return (
              <div key={key} className="attachment-card">
                <span className="attachment-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={faPaperclip} />
                </span>
                <span className="attachment-name">{name}</span>
              </div>
            );
          })}
        </div>
      );
    },
    [getAttachmentUrl]
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    explorerRef.current = explorerByTab;
  }, [explorerByTab]);

  useEffect(() => {
    activeWorktreeIdRef.current = activeWorktreeId;
  }, [activeWorktreeId]);
  const choicesKey = useMemo(
    () =>
      attachmentSession?.sessionId
        ? `choices:${attachmentSession.sessionId}`
        : null,
    [attachmentSession?.sessionId, apiFetch]
  );
  const backlogKey = useMemo(
    () =>
      attachmentSession?.sessionId
        ? `backlog:${attachmentSession.sessionId}`
        : null,
    [attachmentSession?.sessionId]
  );
  const currentDiff = useMemo(() => {
    if (activeWorktreeId && activeWorktreeId !== "main") {
      const wt = worktrees.get(activeWorktreeId);
      return wt?.diff || { status: "", diff: "" };
    }
    return repoDiff;
  }, [activeWorktreeId, worktrees, repoDiff]);
  const diffFiles = useMemo(() => {
    if (!currentDiff.diff) {
      return [];
    }
    try {
      return parseDiff(currentDiff.diff);
    } catch (error) {
      return [];
    }
  }, [currentDiff.diff]);
  const diffStatusLines = useMemo(
    () =>
      (currentDiff.status || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [currentDiff.status]
  );
  const hasCurrentChanges = useMemo(
    () => diffStatusLines.length > 0 || Boolean((currentDiff.diff || "").trim()),
    [diffStatusLines.length, currentDiff.diff]
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
  const logFilter = logFilterByTab[activeWorktreeId] || "all";
  const setLogFilter = useCallback(
    (value) => {
      const key = activeWorktreeId || "main";
      setLogFilterByTab((current) => ({
        ...current,
        [key]: value,
      }));
    },
    [activeWorktreeId]
  );
  const scopedRpcLogs = useMemo(() => {
    if (activeWorktreeId && activeWorktreeId !== "main") {
      return (rpcLogs || []).filter(
        (entry) => entry?.worktreeId === activeWorktreeId
      );
    }
    return (rpcLogs || []).filter((entry) => !entry?.worktreeId);
  }, [rpcLogs, activeWorktreeId]);
  const formattedRpcLogs = useMemo(
    () =>
      scopedRpcLogs.map((entry) => ({
        ...entry,
        timeLabel: entry?.timestamp
          ? new Date(entry.timestamp).toLocaleTimeString("fr-FR")
          : "",
      })),
    [scopedRpcLogs]
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
  }, [workspaceToken, apiFetch]);

  useEffect(() => {
    if (!toolbarExportOpen) {
      return;
    }
    const handlePointerDown = (event) => {
      const target = event.target;
      if (toolbarExportRef.current?.contains(target)) {
        return;
      }
      setToolbarExportOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [toolbarExportOpen]);

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
      if (workspaceToken) {
        localStorage.setItem(WORKSPACE_TOKEN_KEY, workspaceToken);
      } else {
        localStorage.removeItem(WORKSPACE_TOKEN_KEY);
      }
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [workspaceToken]);

  useEffect(() => {
    try {
      if (workspaceId) {
        localStorage.setItem(WORKSPACE_ID_KEY, workspaceId);
      } else {
        localStorage.removeItem(WORKSPACE_ID_KEY);
      }
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [workspaceId]);

  useEffect(() => {
    if (workspaceToken) {
      setWorkspaceStep(3);
    } else {
      setWorkspaceStep(1);
    }
  }, [workspaceToken]);

  useEffect(() => {
    try {
      localStorage.setItem(LLM_PROVIDER_KEY, llmProvider);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [llmProvider]);

  useEffect(() => {
    try {
      localStorage.setItem(LLM_PROVIDERS_KEY, JSON.stringify(selectedProviders));
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [selectedProviders]);

  useEffect(() => {
    setOpenAiLoginError("");
    setClaudeLoginError("");
  }, [llmProvider]);

  useEffect(() => {
    if (selectedProviders.includes(llmProvider)) {
      return;
    }
    const fallback = selectedProviders[0] || "codex";
    if (fallback !== llmProvider) {
      setLlmProvider(fallback);
    }
  }, [selectedProviders, llmProvider]);

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
        TOOL_RESULTS_VISIBLE_KEY,
        showToolResults ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [showToolResults]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_FULL_WIDTH_KEY,
        chatFullWidth ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [chatFullWidth]);

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

  useEffect(() => {
    try {
      localStorage.setItem(THEME_MODE_KEY, themeMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [themeMode]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPOSER_INPUT_MODE_KEY, composerInputMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [composerInputMode]);

  useEffect(() => {
    try {
      localStorage.setItem(DEBUG_MODE_KEY, debugMode ? "true" : "false");
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [debugMode]);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  const loadBranches = useCallback(async () => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    setBranchLoading(true);
    setBranchError("");
    try {
      const response = await apiFetch(
        `/api/branches?session=${encodeURIComponent(attachmentSession.sessionId)}`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || "Impossible de charger les branches.");
      }
      setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      setCurrentBranch(payload.current || "");
      if (!initialBranchRef.current && payload.current) {
        initialBranchRef.current = payload.current;
        setDefaultBranch(payload.current);
      }
    } catch (error) {
      setBranchError(error.message || "Impossible de charger les branches.");
    } finally {
      setBranchLoading(false);
    }
  }, [attachmentSession?.sessionId, apiFetch]);

  const loadProviderModels = useCallback(
    async (provider) => {
      if (!attachmentSession?.sessionId || !provider) {
        return;
      }
      setProviderModelState((current) => ({
        ...current,
        [provider]: {
          ...(current?.[provider] || {}),
          loading: true,
          error: "",
        },
      }));
      try {
        const response = await apiFetch(
          `/api/models?session=${encodeURIComponent(
            attachmentSession.sessionId
          )}&provider=${encodeURIComponent(provider)}`
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Impossible de charger les modeles.");
        }
        setProviderModelState((current) => ({
          ...current,
          [provider]: {
            models: Array.isArray(payload.models) ? payload.models : [],
            loading: false,
            error: "",
          },
        }));
      } catch (error) {
        setProviderModelState((current) => ({
          ...current,
          [provider]: {
            ...(current?.[provider] || {}),
            loading: false,
            error: error.message || "Impossible de charger les modeles.",
          },
        }));
      }
    },
    [attachmentSession?.sessionId, apiFetch]
  );

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      setBranches([]);
      setCurrentBranch("");
      setDefaultBranch("");
      setBranchError("");
      initialBranchRef.current = "";
      setProviderModelState({});
      return;
    }
    initialBranchRef.current = "";
    setDefaultBranch("");
    setProviderModelState({});
    loadBranches();
  }, [attachmentSession?.sessionId, loadBranches]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      setDraftAttachments([]);
    }
  }, [attachmentSession?.sessionId, apiFetch]);

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
        toolResult: item.toolResult,
        attachments: normalizeAttachments(item.attachments || []),
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
      setToolResultPanelOpen({});
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
      const response = await apiFetch(
        `/api/session/${encodeURIComponent(sessionId)}`
      );
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (data?.default_provider && data.default_provider !== llmProvider) {
        setLlmProvider(data.default_provider);
      }
      if (Array.isArray(data?.providers) && data.providers.length) {
        const filtered = data.providers.filter(
          (entry) => entry === "codex" || entry === "claude"
        );
        if (filtered.length) {
          setSelectedProviders(filtered);
          setOpenAiReady(filtered.includes("codex"));
          setClaudeReady(filtered.includes("claude"));
        }
      }
      if (Array.isArray(data?.messages)) {
        applyMessages(data.messages);
      }
      if (data?.repoDiff) {
        setRepoDiff(data.repoDiff);
      }
      if (typeof data?.rpcLogsEnabled === "boolean") {
        setRpcLogsEnabled(data.rpcLogsEnabled);
        if (!data.rpcLogsEnabled) {
          setRpcLogs([]);
        }
      }
      if (Array.isArray(data?.rpcLogs) && data?.rpcLogsEnabled !== false) {
        setRpcLogs(data.rpcLogs);
      }
      if (typeof data?.terminalEnabled === "boolean") {
        setTerminalEnabled(data.terminalEnabled);
      }
    } catch (error) {
      // Ignore resync failures; reconnect loop will retry.
    }
  }, [attachmentSession?.sessionId, applyMessages, llmProvider, apiFetch]);

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

  const requestWorktreesList = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify({ type: "list_worktrees" }));
  }, []);

  const requestWorktreeMessages = useCallback((worktreeId) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!worktreeId) {
      return;
    }
    socket.send(
      JSON.stringify({ type: "sync_worktree_messages", worktreeId })
    );
  }, []);

  const requestWorktreeDiff = useCallback(
    async (worktreeId) => {
      const sessionId = attachmentSession?.sessionId;
      if (!sessionId || !worktreeId) {
        return;
      }
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            worktreeId
          )}/diff?session=${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (!payload) {
          return;
        }
        setWorktrees((current) => {
          const next = new Map(current);
          const wt = next.get(worktreeId);
          if (wt) {
            next.set(worktreeId, {
              ...wt,
              diff: {
                status: payload.status || "",
                diff: payload.diff || "",
              },
            });
          }
          return next;
        });
      } catch (error) {
        // Ignore diff refresh failures.
      }
    },
    [attachmentSession?.sessionId, apiFetch]
  );

  const requestRepoDiff = useCallback(async () => {
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    try {
      const response = await apiFetch(
        `/api/session/${encodeURIComponent(sessionId)}/diff`
      );
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (!payload) {
        return;
      }
      setRepoDiff({
        status: payload.status || "",
        diff: payload.diff || "",
      });
    } catch (error) {
      // Ignore diff refresh failures.
    }
  }, [attachmentSession?.sessionId, apiFetch]);

  const connectTerminal = useCallback(() => {
    if (!terminalEnabled) {
      return;
    }
    if (!workspaceToken) {
      return;
    }
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    const worktreeId =
      activeWorktreeId && activeWorktreeId !== "main"
        ? activeWorktreeId
        : null;
    if (
      terminalSocketRef.current &&
      terminalSocketRef.current.readyState <= WebSocket.OPEN &&
      terminalSessionRef.current === sessionId &&
      terminalWorktreeRef.current === worktreeId
    ) {
      return;
    }
    if (terminalSocketRef.current) {
      terminalSocketRef.current.close();
    }
    const term = terminalRef.current;
    if (term) {
      term.reset();
    }
    const socket = new WebSocket(
      terminalWsUrl(sessionId, worktreeId, workspaceToken)
    );
    terminalSocketRef.current = socket;
    terminalSessionRef.current = sessionId;
    terminalWorktreeRef.current = worktreeId;

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
  }, [attachmentSession?.sessionId, activeWorktreeId, terminalEnabled, workspaceToken]);

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
    if (!attachmentSession?.sessionId) {
      return;
    }
    loadGitIdentity();
  }, [attachmentSession?.sessionId, loadGitIdentity]);

  useEffect(() => {
    try {
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(repoHistory));
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [repoHistory]);

  useEffect(() => {
    rpcLogsEnabledRef.current = rpcLogsEnabled;
  }, [rpcLogsEnabled]);

  useEffect(() => {
    if (!attachmentSession?.sessionId || !workspaceToken) {
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
      const socket = new WebSocket(wsUrl(attachmentSession.sessionId, workspaceToken));
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
        requestWorktreesList();
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
          const errorPayload = payload?.turn?.error || payload?.error || null;
          const turnErrorInfo = errorPayload?.codexErrorInfo;
          if (turnErrorInfo === "usageLimitExceeded") {
            const warningId = `usage-limit-${payload.turnId || payload.turn?.id || Date.now()}`;
            const warningText =
              (typeof errorPayload === "string" ? errorPayload : errorPayload?.message) ||
              "Limite d'usage atteinte. Merci de reessayer plus tard.";
            setMessages((current) => {
              if (current.some((message) => message.id === warningId)) {
                return current;
              }
              return [
                ...current,
                {
                  id: warningId,
                  role: "assistant",
                  text: `⚠️ ${warningText}`,
                },
              ];
            });
          }
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
          if (payload.provider) {
            setProviderModelState((current) => ({
              ...current,
              [payload.provider]: {
                models: list,
                loading: false,
                error: "",
              },
            }));
          }
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
          if (!rpcLogsEnabledRef.current) {
            return;
          }
          if (payload.entry) {
            const entry = payload.entry;
            if (entry?.provider === "codex" && entry.payload?.method === "error") {
              const errorMessage =
                entry.payload?.params?.error?.message ||
                entry.payload?.params?.message ||
                "Erreur";
              const additionalDetails =
                entry.payload?.params?.additionalDetails ||
                entry.payload?.params?.error?.additionalDetails ||
                "";
              const suffix = additionalDetails ? `\n${additionalDetails}` : "";
              const errorText = `⚠️ ${errorMessage}${suffix}`;
              const errorId = `rpc-error-${entry.timestamp || Date.now()}-${entry.payload?.params?.turnId || "unknown"}`;
              setMessages((current) => {
                if (current.some((message) => message.id === errorId)) {
                  return current;
                }
                return [
                  ...current,
                  {
                    id: errorId,
                    role: "assistant",
                    text: errorText,
                  },
                ];
              });
            }
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
            const label = getItemActivityLabel(item);
            setActivity(label);
            if (!item.id) {
              return;
            }
            setMessages((current) => {
              const next = [...current];
              const existingIndex = commandIndex.get(item.id);
              if (existingIndex !== undefined) {
                const updated = { ...next[existingIndex] };
                updated.command =
                  item.commandActions?.command || item.command || "Commande";
                updated.status = "running";
                next[existingIndex] = updated;
                return next;
              }
              const entry = {
                id: item.id,
                role: "commandExecution",
                command:
                  item.commandActions?.command || item.command || "Commande",
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
          const label = getItemActivityLabel(item);
          if (label) {
            setActivity(label);
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
            setProviderModelState((current) => ({
              ...current,
              [payload.provider]: {
                models: payload.models,
                loading: false,
                error: "",
              },
            }));
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
              activity: "",
              currentTurnId: null,
            });
            return next;
          });
          setPaneByTab((current) => ({
            ...current,
            [payload.worktreeId]: current[payload.worktreeId] || "chat",
          }));
          setLogFilterByTab((current) => ({
            ...current,
            [payload.worktreeId]: current[payload.worktreeId] || "all",
          }));
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
          setPaneByTab((current) => {
            const next = { ...current };
            delete next[payload.worktreeId];
            return next;
          });
          setLogFilterByTab((current) => {
            const next = { ...current };
            delete next[payload.worktreeId];
            return next;
          });
          // If active worktree was removed, switch back to main
          if (activeWorktreeIdRef.current === payload.worktreeId) {
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
              newMap.set(wt.id, {
                ...wt,
                messages: [],
                activity: "",
                currentTurnId: null,
              });
            });
            setWorktrees(newMap);
            setPaneByTab((current) => {
              const next = { ...current };
              payload.worktrees.forEach((wt) => {
                if (!next[wt.id]) {
                  next[wt.id] = "chat";
                }
              });
              return next;
            });
            setLogFilterByTab((current) => {
              const next = { ...current };
              payload.worktrees.forEach((wt) => {
                if (!next[wt.id]) {
                  next[wt.id] = "all";
                }
              });
              return next;
            });
            payload.worktrees.forEach((wt) => {
              requestWorktreeMessages(wt.id);
            });
            if (
              activeWorktreeIdRef.current !== "main" &&
              !payload.worktrees.some((wt) => wt.id === activeWorktreeIdRef.current)
            ) {
              setActiveWorktreeId("main");
            }
            // Keep activeWorktreeId as is, don't auto-switch
          }
        }

        if (payload.type === "worktree_messages_sync") {
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(payload.worktreeId);
            if (wt) {
              const normalizedMessages = (payload.messages || []).map(
                (message, index) => ({
                  ...message,
                  id: message?.id || `history-${index}`,
                  attachments: normalizeAttachments(message?.attachments || []),
                  toolResult: message?.toolResult,
                })
              );
              next.set(payload.worktreeId, {
                ...wt,
                messages: normalizedMessages,
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
                next.set(wtId, {
                  ...wt,
                  status: "processing",
                  currentTurnId: payload.turnId,
                  activity: "Traitement en cours...",
                });
              }
              return next;
            });
          }

          if (payload.type === "turn_completed" || payload.type === "turn_error") {
            setWorktrees((current) => {
              const next = new Map(current);
              const wt = next.get(wtId);
              if (wt) {
                next.set(wtId, {
                  ...wt,
                  status: "ready",
                  currentTurnId: null,
                  activity: "",
                });
              }
              return next;
            });
          }

          if (payload.type === "turn_completed") {
            const errorPayload = payload?.turn?.error || payload?.error || null;
            const turnErrorInfo = errorPayload?.codexErrorInfo;
            if (turnErrorInfo === "usageLimitExceeded") {
              const warningId = `usage-limit-${payload.turnId || Date.now()}`;
              const warningText =
                (typeof errorPayload === "string" ? errorPayload : errorPayload?.message) ||
                "Limite d'usage atteinte. Merci de reessayer plus tard.";
              setWorktrees((current) => {
                const next = new Map(current);
                const wt = next.get(wtId);
                if (!wt) return current;
                if (wt.messages.some((message) => message.id === warningId)) {
                  return current;
                }
                next.set(wtId, {
                  ...wt,
                  messages: [
                    ...wt.messages,
                    { id: warningId, role: "assistant", text: `⚠️ ${warningText}` },
                  ],
                });
                return next;
              });
            }
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

        if (payload.worktreeId && payload.type === "item_started") {
          const label = getItemActivityLabel(payload.item);
          if (!label) {
            return;
          }
          const wtId = payload.worktreeId;
          setWorktrees((current) => {
            const next = new Map(current);
            const wt = next.get(wtId);
            if (wt) {
              next.set(wtId, { ...wt, activity: label });
            }
            return next;
          });
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
    workspaceToken,
    messageIndex,
    commandIndex,
    mergeAndApplyMessages,
    requestMessageSync,
    requestWorktreesList,
    requestWorktreeMessages,
    resyncSession,
  ]);

  useEffect(() => {
    if (
      !attachmentSession?.sessionId ||
      !openAiLoginRequest ||
      !connected
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
        provider: "codex",
        params: openAiLoginRequest,
      })
    );
    setOpenAiLoginRequest(null);
  }, [
    attachmentSession?.sessionId,
    connected,
    openAiLoginRequest,
  ]);

  useEffect(() => {
    if (!terminalEnabled) {
      return;
    }
    if (activePane !== "terminal") {
      return;
    }
    if (!terminalContainerRef.current || terminalRef.current) {
      return;
    }
    const isDark = themeMode === "dark";
    const term = new Terminal({
      fontFamily:
        '"SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: isDark ? "#0f1110" : "#fbf6ee",
        foreground: isDark ? "#e6edf3" : "#2a2418",
        cursor: isDark ? "#e6edf3" : "#2a2418",
        selection: isDark
          ? "rgba(255, 255, 255, 0.2)"
          : "rgba(20, 19, 17, 0.15)",
      },
    });
    if (typeof term.setOption !== "function") {
      term.setOption = (key, value) => {
        if (key && typeof key === "object") {
          term.options = key;
          return;
        }
        term.options = { [key]: value };
      };
    }
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
  }, [activePane, terminalEnabled, themeMode]);

  useEffect(() => {
    const term = terminalRef.current;
    if (!term) {
      return;
    }
    const theme =
      themeMode === "dark"
        ? {
            background: "#15120d",
            foreground: "#f2e9dc",
            cursor: "#f2e9dc",
          }
        : {
            background: "#fbf6ee",
            foreground: "#2a2418",
            cursor: "#2a2418",
          };
    if (typeof term.setOption === "function") {
      term.setOption("theme", theme);
    } else {
      term.options = { theme };
    }
  }, [themeMode]);

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
    if (!terminalEnabled) {
      return;
    }
    if (terminalRef.current) {
      const isDark = themeMode === "dark";
      terminalRef.current.setOption("theme", {
        background: isDark ? "#0f1110" : "#fbf6ee",
        foreground: isDark ? "#e6edf3" : "#2a2418",
        cursor: isDark ? "#e6edf3" : "#2a2418",
        selection: isDark
          ? "rgba(255, 255, 255, 0.2)"
          : "rgba(20, 19, 17, 0.15)",
      });
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
  }, [activePane, connectTerminal, terminalEnabled, themeMode]);

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
      terminalWorktreeRef.current = null;
    }
  }, [attachmentSession?.sessionId]);

  useEffect(() => {
    if (terminalEnabled) {
      return;
    }
    if (terminalSocketRef.current) {
      terminalSocketRef.current.close();
      terminalSocketRef.current = null;
    }
    terminalSessionRef.current = null;
    terminalWorktreeRef.current = null;
    if (terminalDisposableRef.current) {
      terminalDisposableRef.current.dispose();
      terminalDisposableRef.current = null;
    }
    if (terminalRef.current) {
      terminalRef.current.dispose();
      terminalRef.current = null;
    }
    terminalFitRef.current = null;
  }, [terminalEnabled]);

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
  }, [workspaceToken, attachmentSession?.sessionId, apiFetch]);

  useEffect(() => {
    if (!repoUrl || attachmentSession?.sessionId) {
      return;
    }
    const createAttachmentSession = async () => {
      try {
        setAttachmentsLoading(true);
        setAttachmentsError("");
        const payload = { repoUrl };
        if (repoAuth) {
          payload.auth = repoAuth;
        }
        const response = await apiFetch("/api/session", {
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
              "Token workspace invalide. Merci de vous reconnecter."
            );
            setAttachmentsError("");
            return;
          }
          const suffix = details ? `: ${details}` : "";
          if (response.status === 401 || response.status === 403) {
            throw new Error(`Echec d'authentification Git${suffix}.`);
          }
          if (response.status === 404) {
            throw new Error(`Depot Git introuvable${suffix}.`);
          }
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
  }, [repoUrl, repoAuth, attachmentSession?.sessionId, apiFetch]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("session", attachmentSession.sessionId);
    window.history.replaceState({}, "", url);
  }, [attachmentSession?.sessionId]);

  useEffect(() => {
    if (typeof attachmentSession?.terminalEnabled === "boolean") {
      setTerminalEnabled(attachmentSession.terminalEnabled);
    }
  }, [attachmentSession?.terminalEnabled]);

  useEffect(() => {
    setAppServerReady(false);
  }, [attachmentSession?.sessionId]);

  const handleWorkspaceSubmit = async (event) => {
    event.preventDefault();
    setWorkspaceError("");
    setWorkspaceBusy(true);
    try {
      if (workspaceMode === "existing") {
        const workspaceIdValue = workspaceIdInput.trim();
        const secretValue = workspaceSecretInput.trim();
        if (!workspaceIdValue || !secretValue) {
          throw new Error("Workspace ID et secret requis.");
        }
        const response = await apiFetch("/api/workspaces/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId: workspaceIdValue,
            workspaceSecret: secretValue,
          }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(payload?.error || "Echec de l'authentification.");
        }
        const data = await response.json();
        setWorkspaceToken(data.workspaceToken || "");
        setWorkspaceId(workspaceIdValue);
        setWorkspaceStep(3);
        return;
      }
      setWorkspaceStep(2);
    } catch (error) {
      setWorkspaceError(error.message || "Echec de la configuration du workspace.");
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
          return;
        }
        const trimmedValue = (config.authValue || "").trim();
        if (!trimmedValue) {
          throw new Error(`Cle requise pour ${provider}.`);
        }
        const type = config.authType || "api_key";
        const value =
          type === "auth_json_b64" ? encodeBase64(trimmedValue) : trimmedValue;
        providersPayload[provider] = {
          enabled: true,
          auth: { type, value },
        };
      });
      if (Object.keys(providersPayload).length === 0) {
        throw new Error("Selectionnez au moins un provider.");
      }
      const createResponse = await apiFetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: providersPayload }),
      });
      if (!createResponse.ok) {
        const payload = await createResponse.json().catch(() => null);
        throw new Error(payload?.error || "Echec de creation du workspace.");
      }
      const created = await createResponse.json();
      setWorkspaceCreated(created);
      setWorkspaceId(created.workspaceId);
      setWorkspaceIdInput(created.workspaceId);
      const loginResponse = await apiFetch("/api/workspaces/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: created.workspaceId,
          workspaceSecret: created.workspaceSecret,
        }),
      });
      if (!loginResponse.ok) {
        const payload = await loginResponse.json().catch(() => null);
        throw new Error(payload?.error || "Echec de l'authentification.");
      }
      const loginData = await loginResponse.json();
      setWorkspaceToken(loginData.workspaceToken || "");
      setWorkspaceStep(3);
    } catch (error) {
      setWorkspaceError(error.message || "Echec de la configuration du workspace.");
    } finally {
      setWorkspaceBusy(false);
    }
  };

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
    setAttachmentsError("");
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
    const logsEnabled =
      typeof attachmentSession.rpcLogsEnabled === "boolean"
        ? attachmentSession.rpcLogsEnabled
        : true;
    setRpcLogsEnabled(logsEnabled);
    setRpcLogs(logsEnabled ? attachmentSession.rpcLogs || [] : []);
    setStatus("Connexion...");
    setConnected(false);
  }, [attachmentSession?.sessionId, applyMessages, messageIndex]);

  useEffect(() => {
    if (!attachmentSession?.default_provider && !attachmentSession?.providers) {
      return;
    }
    const sessionProviders = Array.isArray(attachmentSession.providers)
      ? attachmentSession.providers.filter(
          (entry) => entry === "codex" || entry === "claude"
        )
      : [];
    if (sessionProviders.length) {
      setSelectedProviders(sessionProviders);
      setOpenAiReady(sessionProviders.includes("codex"));
      setClaudeReady(sessionProviders.includes("claude"));
    } else if (attachmentSession.default_provider) {
      setSelectedProviders([attachmentSession.default_provider]);
      setOpenAiReady(attachmentSession.default_provider === "codex");
      setClaudeReady(attachmentSession.default_provider === "claude");
    }
    // Sync local state with session provider on initial load
    if (
      attachmentSession.default_provider &&
      attachmentSession.default_provider !== llmProvider
    ) {
      setLlmProvider(attachmentSession.default_provider);
    }
  }, [attachmentSession?.default_provider, attachmentSession?.providers]);

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
      if (!availableProviders.includes(newProvider)) {
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
    [llmProvider, providerSwitching, processing, availableProviders]
  );

  const toggleProviderSelection = useCallback(
    (provider) => {
      if (attachmentSession?.sessionId) {
        return;
      }
      setSelectedProviders((current) => {
        const exists = current.includes(provider);
        const next = exists
          ? current.filter((item) => item !== provider)
          : [...current, provider];
        if (!exists) {
          setLlmProvider(provider);
        } else if (provider === llmProvider) {
          const fallback = next[0] || provider;
          if (fallback !== llmProvider) {
            setLlmProvider(fallback);
          }
        }
        return next;
      });
    },
    [attachmentSession?.sessionId, llmProvider]
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
      const response = await apiFetch("/api/branches/switch", {
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

  const uploadFiles = async (files) => {
    if (!files.length || !attachmentSession?.sessionId) {
      return;
    }
    try {
      setAttachmentsLoading(true);
      setAttachmentsError("");
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));
      const response = await apiFetch(
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
      const uploaded = normalizeAttachments(data.files || []);
      setDraftAttachments((current) => [...current, ...uploaded]);
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

  const removeDraftAttachment = (identifier) => {
    if (!identifier) {
      return;
    }
    setDraftAttachments((current) =>
      current.filter((item) => {
        const key = item?.path || item?.name;
        return key !== identifier;
      })
    );
  };

  const sendMessage = (textOverride, attachmentsOverride) => {
    const rawText = (textOverride ?? input).trim();
    if (!rawText || !socketRef.current || !connected) {
      return;
    }

    void ensureNotificationPermission();
    const resolvedAttachments = normalizeAttachments(
      attachmentsOverride ?? draftAttachments
    );
    const selectedPaths = resolvedAttachments
      .map((item) => item?.path)
      .filter(Boolean);
    const suffix =
      selectedPaths.length > 0
        ? `;; attachments: ${JSON.stringify(selectedPaths)}`
        : "";
    const displayText = rawText;
    const text = `${displayText}${suffix}`;
    setMessages((current) => [
      ...current,
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: displayText,
        attachments: resolvedAttachments,
      },
    ]);
    socketRef.current.send(
      JSON.stringify({
        type: "user_message",
        text,
        displayText,
        attachments: resolvedAttachments,
      })
    );
    setInput("");
    setDraftAttachments([]);
  };

  const sendCommitMessage = (text) => {
    handleSendMessage(text, []);
  };

  // ============== Worktree Functions ==============

  const createWorktree = useCallback(
    ({ name, provider: wtProvider, startingBranch, model, reasoningEffort }) => {
      if (!socketRef.current || !connected) return;

      socketRef.current.send(
        JSON.stringify({
          type: "create_parallel_request",
          provider: availableProviders.includes(wtProvider)
            ? wtProvider
            : llmProvider,
          name: name || null,
          startingBranch: startingBranch || null,
          model: model || null,
          reasoningEffort: reasoningEffort ?? null,
        })
      );
    },
    [connected, llmProvider, availableProviders]
  );

  const sendWorktreeMessage = useCallback(
    (worktreeId, textOverride, attachmentsOverride) => {
      const rawText = (textOverride ?? input).trim();
      if (!rawText || !socketRef.current || !connected || !worktreeId) return;

      const resolvedAttachments = normalizeAttachments(
        attachmentsOverride ?? draftAttachments
      );
      const selectedPaths = resolvedAttachments
        .map((item) => item?.path)
        .filter(Boolean);
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
            {
              id: `user-${Date.now()}`,
              role: "user",
              text: displayText,
              attachments: resolvedAttachments,
            },
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
          attachments: resolvedAttachments,
        })
      );
      setInput("");
      setDraftAttachments([]);
    },
    [connected, input, draftAttachments]
  );

  const closeWorktree = useCallback(
    async (worktreeId) => {
      if (!attachmentSession?.sessionId) return;

      try {
        const response = await apiFetch(
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

  const mergeTargetBranch = defaultBranch || currentBranch || "main";

  const openCloseConfirm = useCallback((worktreeId) => {
    if (!worktreeId || worktreeId === "main") {
      return;
    }
    setCloseConfirm({ worktreeId });
  }, []);

  const closeCloseConfirm = useCallback(() => {
    setCloseConfirm(null);
  }, []);

  const handleConfirmMerge = useCallback(() => {
    if (!closeConfirm?.worktreeId) {
      return;
    }
    sendWorktreeMessage(
      closeConfirm.worktreeId,
      `Merge vers ${mergeTargetBranch}`,
      []
    );
    setCloseConfirm(null);
  }, [closeConfirm, mergeTargetBranch, sendWorktreeMessage]);

  const handleConfirmDelete = useCallback(async () => {
    if (!closeConfirm?.worktreeId) {
      return;
    }
    if (activeWorktreeIdRef.current === closeConfirm.worktreeId) {
      setActiveWorktreeId("main");
    }
    await closeWorktree(closeConfirm.worktreeId);
    setCloseConfirm(null);
  }, [closeConfirm, closeWorktree]);

  const renameWorktreeHandler = useCallback(
    async (worktreeId, newName) => {
      if (!attachmentSession?.sessionId) return;

      try {
        const response = await apiFetch(
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
  const hasMessages = Array.isArray(currentMessages) && currentMessages.length > 0;
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [currentMessages, processing, activeWorktreeId]);

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
      if (message?.role === "tool_result") {
        if (!showToolResults) {
          return;
        }
        const last = grouped[grouped.length - 1];
        if (last?.groupType === "toolResult") {
          last.items.push(message);
        } else {
          grouped.push({
            groupType: "toolResult",
            id: `tool-result-group-${message.id}`,
            items: [message],
          });
        }
        return;
      }
      grouped.push(message);
    });
    return grouped;
  }, [currentMessages, showChatCommands, showToolResults]);

  const isWorktreeProcessing = activeWorktree?.status === "processing";
  const currentProcessing = isInWorktree ? isWorktreeProcessing : processing;
  const currentActivity = isInWorktree ? activeWorktree?.activity || "" : activity;
  const currentTurnIdForActive = isInWorktree
    ? activeWorktree?.currentTurnId
    : currentTurnId;
  const canInterrupt = currentProcessing && Boolean(currentTurnIdForActive);

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

  const openVibecoderForm = useCallback((block, blockKey) => {
    if (!block?.fields?.length) {
      return;
    }
    const defaults = {};
    block.fields.forEach((field) => {
      if (field.type === "checkbox") {
        defaults[field.id] = Boolean(field.defaultChecked);
      } else if (field.type === "radio" || field.type === "select") {
        defaults[field.id] = field.choices?.[0] || "";
      } else {
        defaults[field.id] = field.defaultValue || "";
      }
    });
    setActiveForm({ ...block, key: blockKey });
    setActiveFormValues(defaults);
  }, []);

  const closeVibecoderForm = useCallback(() => {
    setActiveForm(null);
    setActiveFormValues({});
  }, []);

  const updateActiveFormValue = useCallback((fieldId, value) => {
    setActiveFormValues((current) => ({
      ...current,
      [fieldId]: value,
    }));
  }, []);

  const sendFormMessage = useCallback(
    (text) => {
      const preservedInput = input;
      const preservedAttachments = draftAttachments;
      handleSendMessage(text, []);
      setInput(preservedInput);
      setDraftAttachments(preservedAttachments);
    },
    [handleSendMessage, input, draftAttachments]
  );

  const submitActiveForm = useCallback(
    (event) => {
      event?.preventDefault();
      if (!activeForm) {
        return;
      }
      const lines = activeForm.fields.map((field) => {
        let value = activeFormValues[field.id];
        if (field.type === "checkbox") {
          value = value ? "1" : "0";
        }
        if (value === undefined || value === null) {
          value = "";
        }
        return `${field.id}=${value}`;
      });
      sendFormMessage(lines.join("\n"));
      closeVibecoderForm();
    },
    [activeForm, activeFormValues, sendFormMessage, closeVibecoderForm]
  );

  const addToBacklog = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    const entry = {
      id: `backlog-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      text: trimmed,
      createdAt: Date.now(),
      attachments: draftAttachments,
    };
    setBacklog((current) => [entry, ...current]);
    setInput("");
  };

  const removeFromBacklog = (id) => {
    setBacklog((current) => current.filter((item) => item.id !== id));
  };

  const editBacklogItem = (item) => {
    setInput(item.text || "");
    setDraftAttachments(normalizeAttachments(item.attachments || []));
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
    if (!currentTurnIdForActive || !socketRef.current) {
      return;
    }
    if (isInWorktree && activeWorktreeId) {
      socketRef.current.send(
        JSON.stringify({
          type: "worktree_turn_interrupt",
          worktreeId: activeWorktreeId,
          turnId: currentTurnIdForActive,
        })
      );
      setWorktrees((current) => {
        const next = new Map(current);
        const wt = next.get(activeWorktreeId);
        if (wt) {
          next.set(activeWorktreeId, { ...wt, activity: "Interruption..." });
        }
        return next;
      });
      return;
    }
    socketRef.current.send(
      JSON.stringify({ type: "turn_interrupt", turnId: currentTurnIdForActive })
    );
    setActivity("Interruption...");
  };

  const triggerAttachmentPicker = useCallback(() => {
    if (!attachmentSession || attachmentsLoading) {
      return;
    }
    requestAnimationFrame(() => {
      uploadInputRef.current?.click();
    });
  }, [attachmentSession, attachmentsLoading]);

  const handleViewSelect = useCallback((nextPane) => {
    if ((!debugMode || !rpcLogsEnabled) && nextPane === "logs") {
      return;
    }
    if (!terminalEnabled && nextPane === "terminal") {
      return;
    }
    const key = activeWorktreeId || "main";
    setPaneByTab((current) => ({
      ...current,
      [key]: nextPane,
    }));
    setToolbarExportOpen(false);
  }, [activeWorktreeId, debugMode, rpcLogsEnabled, terminalEnabled]);

  const handleLeaveSession = useCallback(() => {
    setAttachmentSession(null);
    setRepoUrl("");
    setRepoInput("");
    setRepoAuth(null);
    setSessionRequested(false);
    setAttachmentsError("");
    setAttachmentsLoading(false);
    setMessages([]);
    setRepoDiff({ status: "", diff: "" });
    setRpcLogs([]);
    setRpcLogsEnabled(true);
    setCurrentTurnId(null);
    setActivity("");
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    window.history.replaceState({}, "", url);
  }, []);

  const handleLeaveWorkspace = useCallback(() => {
    setWorkspaceToken("");
    setWorkspaceId("");
    setWorkspaceIdInput("");
    setWorkspaceSecretInput("");
    setWorkspaceCreated(null);
    setWorkspaceError("");
    setWorkspaceMode("existing");
    setWorkspaceStep(1);
  }, []);

  const handleDiffSelect = useCallback(() => {
    handleViewSelect("diff");
    if (activeWorktreeId && activeWorktreeId !== "main") {
      requestWorktreeDiff(activeWorktreeId);
    } else {
      requestRepoDiff();
    }
  }, [
    activeWorktreeId,
    handleViewSelect,
    requestRepoDiff,
    requestWorktreeDiff,
  ]);

  const handleOpenSettings = useCallback(() => {
    if (activePane !== "settings") {
      const key = activeWorktreeId || "main";
      lastPaneByTabRef.current.set(key, activePane);
    }
    handleViewSelect("settings");
  }, [activePane, activeWorktreeId, handleViewSelect]);

  const handleSettingsBack = useCallback(() => {
    const key = activeWorktreeId || "main";
    const previousPane = lastPaneByTabRef.current.get(key);
    const fallbackPane =
      previousPane && previousPane !== "settings" ? previousPane : "chat";
    handleViewSelect(fallbackPane);
  }, [activeWorktreeId, handleViewSelect]);

  useEffect(() => {
    if ((!debugMode || !rpcLogsEnabled) && activePane === "logs") {
      handleViewSelect("chat");
    }
  }, [debugMode, rpcLogsEnabled, activePane, handleViewSelect]);

  useEffect(() => {
    if (!terminalEnabled && activePane === "terminal") {
      handleViewSelect("chat");
    }
  }, [terminalEnabled, activePane, handleViewSelect]);

  const updateExplorerState = useCallback((tabId, patch) => {
    setExplorerByTab((current) => {
      const prev = current[tabId] || explorerDefaultState;
      return {
        ...current,
        [tabId]: {
          ...explorerDefaultState,
          ...prev,
          ...patch,
        },
      };
    });
  }, [explorerDefaultState]);

  const requestExplorerTree = useCallback(
    async (tabId, force = false) => {
      const sessionId = attachmentSession?.sessionId;
      if (!sessionId || !tabId) {
        return;
      }
      const existing = explorerRef.current[tabId];
      if (!force && existing?.tree && !existing?.error) {
        return;
      }
      if (existing?.loading) {
        return;
      }
      updateExplorerState(tabId, { loading: true, error: "" });
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            tabId
          )}/tree?session=${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load tree");
        }
        const payload = await response.json();
        updateExplorerState(tabId, {
          tree: Array.isArray(payload?.tree) ? payload.tree : [],
          loading: false,
          error: "",
          treeTruncated: Boolean(payload?.truncated),
          treeTotal: Number.isFinite(Number(payload?.total))
            ? Number(payload.total)
            : 0,
        });
      } catch (error) {
        updateExplorerState(tabId, {
          loading: false,
          error: "Impossible de charger l'explorateur.",
        });
      }
    },
    [attachmentSession?.sessionId, updateExplorerState]
  );

  const requestExplorerStatus = useCallback(
    async (tabId, force = false) => {
      const sessionId = attachmentSession?.sessionId;
      if (!sessionId || !tabId) {
        return;
      }
      const existing = explorerRef.current[tabId];
      if (!force && existing?.statusLoaded && !existing?.statusError) {
        return;
      }
      if (existing?.statusLoading) {
        return;
      }
      updateExplorerState(tabId, { statusLoading: true, statusError: "" });
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            tabId
          )}/status?session=${encodeURIComponent(sessionId)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load status");
        }
        const payload = await response.json();
        const entries = Array.isArray(payload?.entries) ? payload.entries : [];
        const statusByPath = {};
        entries.forEach((entry) => {
          if (!entry?.path || !entry?.type) {
            return;
          }
          statusByPath[entry.path] = entry.type;
        });
        updateExplorerState(tabId, {
          statusByPath,
          statusLoading: false,
          statusError: "",
          statusLoaded: true,
        });
      } catch (error) {
        updateExplorerState(tabId, {
          statusLoading: false,
          statusError: "Impossible de charger le statut Git.",
          statusLoaded: false,
        });
      }
    },
    [attachmentSession?.sessionId, updateExplorerState]
  );

  const loadExplorerFile = useCallback(
    async (tabId, filePath) => {
      const sessionId = attachmentSession?.sessionId;
      if (!sessionId || !tabId || !filePath) {
        return;
      }
      const currentState = explorerByTab[tabId];
      if (
        currentState?.isDirty &&
        currentState?.selectedPath &&
        currentState.selectedPath !== filePath
      ) {
        const shouldContinue = window.confirm(
          "Vous avez des modifications non sauvegardees. Continuer sans sauvegarder ?"
        );
        if (!shouldContinue) {
          return;
        }
      }
      updateExplorerState(tabId, {
        selectedPath: filePath,
        fileLoading: true,
        fileError: "",
        fileBinary: false,
        fileSaveError: "",
        fileSaving: false,
        editMode: false,
        isDirty: false,
      });
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            tabId
          )}/file?session=${encodeURIComponent(
            sessionId
          )}&path=${encodeURIComponent(filePath)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load file");
        }
        const payload = await response.json();
        const content = payload?.content || "";
        updateExplorerState(tabId, {
          fileContent: content,
          draftContent: content,
          fileLoading: false,
          fileError: "",
          fileTruncated: Boolean(payload?.truncated),
          fileBinary: Boolean(payload?.binary),
        });
      } catch (error) {
        updateExplorerState(tabId, {
          fileLoading: false,
          fileError: "Impossible de charger le fichier.",
        });
      }
    },
    [attachmentSession?.sessionId, updateExplorerState]
  );

  const openFileInExplorer = useCallback(
    (filePath) => {
      if (!filePath) {
        return;
      }
      const tabId = activeWorktreeId || "main";
      handleViewSelect("explorer");
      requestExplorerTree(tabId);
      requestExplorerStatus(tabId);
      loadExplorerFile(tabId, filePath);
    },
    [
      activeWorktreeId,
      handleViewSelect,
      loadExplorerFile,
      requestExplorerStatus,
      requestExplorerTree,
    ]
  );

  const toggleExplorerDir = useCallback(
    (tabId, dirPath) => {
      if (!tabId || !dirPath) {
        return;
      }
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const expanded = new Set(prev.expandedPaths || []);
        if (expanded.has(dirPath)) {
          expanded.delete(dirPath);
        } else {
          expanded.add(dirPath);
        }
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            expandedPaths: Array.from(expanded),
          },
        };
      });
    },
    [explorerDefaultState]
  );

  const toggleExplorerEditMode = useCallback(
    (tabId, nextMode) => {
      if (!tabId) {
        return;
      }
      updateExplorerState(tabId, {
        editMode: nextMode,
        fileSaveError: "",
      });
    },
    [updateExplorerState]
  );

  const updateExplorerDraft = useCallback(
    (tabId, value) => {
      if (!tabId) {
        return;
      }
      updateExplorerState(tabId, {
        draftContent: value,
        isDirty: true,
      });
    },
    [updateExplorerState]
  );

  const saveExplorerFile = useCallback(
    async (tabId) => {
      const sessionId = attachmentSession?.sessionId;
      if (!sessionId || !tabId) {
        return;
      }
      const state = explorerByTab[tabId];
      if (!state?.selectedPath || state?.fileBinary) {
        return;
      }
      updateExplorerState(tabId, { fileSaving: true, fileSaveError: "" });
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            tabId
          )}/file?session=${encodeURIComponent(sessionId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: state.selectedPath,
              content: state.draftContent || "",
            }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to save file");
        }
        updateExplorerState(tabId, {
          fileContent: state.draftContent || "",
          fileSaving: false,
          fileSaveError: "",
          isDirty: false,
        });
        requestExplorerStatus(tabId, true);
      } catch (error) {
        updateExplorerState(tabId, {
          fileSaving: false,
          fileSaveError: "Impossible d'enregistrer le fichier.",
        });
      }
    },
    [
      attachmentSession?.sessionId,
      explorerByTab,
      updateExplorerState,
      requestExplorerStatus,
    ]
  );

  const handleClearRpcLogs = useCallback(() => {
    setRpcLogs((current) => {
      if (activeWorktreeId && activeWorktreeId !== "main") {
        return current.filter(
          (entry) => entry?.worktreeId !== activeWorktreeId
        );
      }
      return current.filter((entry) => Boolean(entry?.worktreeId));
    });
  }, [activeWorktreeId]);

  useEffect(() => {
    if (activePane !== "diff") {
      return;
    }
    if (activeWorktreeId && activeWorktreeId !== "main") {
      requestWorktreeDiff(activeWorktreeId);
    } else {
      requestRepoDiff();
    }
  }, [activePane, activeWorktreeId, requestRepoDiff, requestWorktreeDiff]);

  useEffect(() => {
    if (activePane !== "explorer") {
      return;
    }
    const tabId = activeWorktreeId || "main";
    requestExplorerTree(tabId);
    requestExplorerStatus(tabId);
  }, [
    activePane,
    activeWorktreeId,
    requestExplorerTree,
    requestExplorerStatus,
  ]);

  const handleExportChat = useCallback(
    (format) => {
      const exportMessages = Array.isArray(currentMessages)
        ? currentMessages
        : [];
      if (!exportMessages.length) {
        return;
      }
      setToolbarExportOpen(false);
      const baseName = extractRepoName(
        attachmentSession?.repoUrl || repoUrl || ""
      );
      const tabLabel =
        isInWorktree && activeWorktree
          ? `${activeWorktree.name || "Worktree"} (${activeWorktree.branchName || activeWorktree.id})`
          : "Main";
      if (format === "markdown") {
        const lines = [
          "# Historique du chat",
          "",
          `Export: ${new Date().toISOString()}`,
          `Onglet: ${tabLabel}`,
          "",
        ];
        exportMessages.forEach((message) => {
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
          if (message.role === "tool_result") {
            const toolName =
              message.toolResult?.name || message.toolResult?.tool || "Tool";
            const toolOutput = message.toolResult?.output || message.text || "";
            lines.push("## Tool result");
            lines.push(`\`${toolName}\``);
            if (toolOutput) {
              lines.push("```");
              lines.push(toolOutput);
              lines.push("```");
            }
            lines.push("");
            return;
          }
          const roleLabel = message.role === "user" ? "Utilisateur" : "Assistant";
          lines.push(`## ${roleLabel}`);
          lines.push(message.text || "");
          const attachmentNames = normalizeAttachments(
            message.attachments || []
          )
            .map((item) => item?.name || item?.path)
            .filter(Boolean);
          if (attachmentNames.length) {
            lines.push(`Pièces jointes: ${attachmentNames.join(", ")}`);
          }
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
        tab: {
          type: isInWorktree ? "worktree" : "main",
          worktreeId: activeWorktree?.id || null,
          worktreeName: activeWorktree?.name || null,
          branchName: activeWorktree?.branchName || null,
        },
        messages: exportMessages.map((message) => {
          if (message.role === "commandExecution") {
            return {
              id: message.id,
              role: message.role,
              command: message.command || "",
              output: message.output || "",
              status: message.status || "",
            };
          }
          if (message.role === "tool_result") {
            return {
              id: message.id,
              role: message.role,
              text: message.text || "",
              toolResult: message.toolResult || null,
            };
          }
          return {
            id: message.id,
            role: message.role,
            text: message.text || "",
            attachments: normalizeAttachments(message.attachments || []),
          };
        }),
      };
      downloadTextFile(
        formatExportName(baseName, "json"),
        JSON.stringify(payload, null, 2),
        "application/json"
      );
    },
    [
      currentMessages,
      attachmentSession?.repoUrl,
      repoUrl,
      isInWorktree,
      activeWorktree,
    ]
  );

  const handleInputChange = (event) => {
    const { value } = event.target;
    setInput(value);
    if (!inputRef.current) {
      return;
    }
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  };

  const handleComposerKeyDown = (event) => {
    if (composerInputMode !== "single") {
      return;
    }
    if (event.isComposing) {
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSendMessage();
    }
  };

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  }, [input, isMobileLayout]);

  useEffect(() => {
    if (!conversationRef.current || !composerRef.current) {
      return undefined;
    }
    const updateComposerSpace = () => {
      if (!conversationRef.current || !composerRef.current) {
        return;
      }
      const rect = composerRef.current.getBoundingClientRect();
      const extra = isMobileLayout ? 12 : 16;
      conversationRef.current.style.setProperty(
        "--composer-space",
        `${Math.ceil(rect.height + extra)}px`
      );
    };
    updateComposerSpace();
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(updateComposerSpace);
      observer.observe(composerRef.current);
    }
    window.addEventListener("resize", updateComposerSpace);
    return () => {
      window.removeEventListener("resize", updateComposerSpace);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [isMobileLayout, draftAttachments.length]);

  const handleChoiceClick = (choice, blockKey, choiceIndex) => {
    setChoiceSelections((prev) => ({
      ...prev,
      [blockKey]: choiceIndex,
    }));
    setInput(choice);
    handleSendMessage(choice);
  };

  const handleClearChat = async () => {
    setToolbarExportOpen(false);
    if (activeWorktreeId !== "main") {
      setWorktrees((current) => {
        const next = new Map(current);
        const wt = next.get(activeWorktreeId);
        if (wt) {
          next.set(activeWorktreeId, { ...wt, messages: [] });
        }
        return next;
      });
      lastNotifiedIdRef.current = null;
      if (attachmentSession?.sessionId) {
        try {
          await apiFetch(
            `/api/session/${encodeURIComponent(
              attachmentSession.sessionId
            )}/clear`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ worktreeId: activeWorktreeId }),
            }
          );
        } catch (error) {
          // Ignore clear failures; next refresh will resync.
        }
      }
      return;
    }

    setMessages([]);
    messageIndex.clear();
    commandIndex.clear();
    setChoiceSelections({});
    if (choicesKey) {
      localStorage.removeItem(choicesKey);
    }
    setCommandPanelOpen({});
    setToolResultPanelOpen({});
    lastNotifiedIdRef.current = null;
    if (attachmentSession?.sessionId) {
      try {
        await apiFetch(
          `/api/session/${encodeURIComponent(
            attachmentSession.sessionId
          )}/clear`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: llmProvider }),
          }
        );
      } catch (error) {
        // Ignore clear failures; next refresh will resync.
      }
    }
  };

  const supportsModels = llmProvider === "codex";
  const hasSession = Boolean(attachmentSession?.sessionId);
  const canSwitchProvider = availableProviders.length > 1;
  const nextProvider = canSwitchProvider
    ? availableProviders.find((provider) => provider !== llmProvider) || llmProvider
    : llmProvider;

  if (!attachmentSession?.sessionId) {
    const isRepoProvided = Boolean(repoUrl);
    const isCloning = sessionRequested && isRepoProvided;
    const repoDisplay = getTruncatedText(repoUrl, 72);
    const formDisabled = workspaceBusy || sessionRequested;
    const workspaceProvider = (providerKey) => workspaceProviders[providerKey] || {};
    const showStep1 = workspaceStep === 1;
    const showStep2 = workspaceStep === 2 && workspaceMode === "new";
    const showStep3 = workspaceStep === 3 && workspaceToken;
    return (
      <div className="session-gate">
        <div className="session-card">
          <p className="eyebrow">m5chat</p>
          <h1>
            {showStep3
              ? "Cloner une session"
              : showStep2
                ? "Configurer les providers IA"
                : "Configurer le workspace"}
          </h1>
          {showStep1 && (
            <>
              <p className="session-hint">
                Selectionnez un workspace existant ou creez-en un nouveau.
              </p>
              <form className="session-form" onSubmit={handleWorkspaceSubmit}>
                <div className="session-auth">
                  <div className="session-auth-title">Workspace</div>
                  <div className="session-auth-options">
                    <label className="session-auth-option">
                      <input
                        type="radio"
                        name="workspaceMode"
                        value="existing"
                        checked={workspaceMode === "existing"}
                        onChange={() => setWorkspaceMode("existing")}
                        disabled={formDisabled}
                      />
                      Utiliser un workspace existant
                    </label>
                    <label className="session-auth-option">
                      <input
                        type="radio"
                        name="workspaceMode"
                        value="new"
                        checked={workspaceMode === "new"}
                        onChange={() => setWorkspaceMode("new")}
                        disabled={formDisabled}
                      />
                      Creer un nouveau workspace
                    </label>
                  </div>
                </div>
                {workspaceMode === "existing" && (
                  <div className="session-auth">
                    <div className="session-auth-grid">
                      <input
                        type="text"
                        placeholder="workspaceId (ex: w...)"
                        value={workspaceIdInput}
                        onChange={(event) => setWorkspaceIdInput(event.target.value)}
                        disabled={formDisabled}
                        spellCheck={false}
                      />
                      <input
                        type="password"
                        placeholder="workspaceSecret"
                        value={workspaceSecretInput}
                        onChange={(event) =>
                          setWorkspaceSecretInput(event.target.value)
                        }
                        disabled={formDisabled}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                )}
                <div className="session-form-row">
                  <div />
                  <button type="submit" disabled={formDisabled}>
                    {workspaceBusy ? "Validation..." : "Continuer"}
                  </button>
                </div>
              </form>
              {workspaceError && (
                <div className="attachments-error">{workspaceError}</div>
              )}
            </>
          )}

          {showStep2 && (
            <>
              <p className="session-hint">
                Configurez les providers IA pour ce workspace.
              </p>
              <form className="session-form" onSubmit={handleWorkspaceProvidersSubmit}>
                <div className="session-auth">
                  <div className="session-auth-title">
                    Providers IA (obligatoire)
                  </div>
                  <div className="session-auth-options">
                    {["codex", "claude"].map((provider) => {
                      const config = workspaceProvider(provider);
                      const label = provider === "codex" ? "Codex" : "Claude";
                      return (
                        <label key={provider} className="session-auth-option">
                          <input
                            type="checkbox"
                            checked={Boolean(config.enabled)}
                            onChange={() =>
                              setWorkspaceProviders((current) => ({
                                ...current,
                                [provider]: {
                                  ...current[provider],
                                  enabled: !current[provider]?.enabled,
                                },
                              }))
                            }
                            disabled={formDisabled}
                          />
                          {label}
                        </label>
                      );
                    })}
                  </div>
                  {["codex", "claude"].map((provider) => {
                    const config = workspaceProvider(provider);
                    if (!config?.enabled) {
                      return null;
                    }
                    return (
                      <div key={`${provider}-auth`} className="session-auth">
                        <div className="session-auth-title">
                          Auth {provider === "codex" ? "Codex" : "Claude"}
                        </div>
                        <div className="session-auth-grid">
                          <select
                            value={config.authType}
                            onChange={(event) =>
                              setWorkspaceProviders((current) => ({
                                ...current,
                                [provider]: {
                                  ...current[provider],
                                  authType: event.target.value,
                                },
                              }))
                            }
                            disabled={formDisabled}
                          >
                            <option value="api_key">api_key</option>
                            <option value="auth_json_b64">auth_json_b64</option>
                            <option value="setup_token">setup_token</option>
                          </select>
                          {config.authType === "auth_json_b64" ? (
                            <textarea
                              className="session-auth-textarea"
                              placeholder="JSON credentials"
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
                              rows={4}
                            />
                          ) : (
                            <input
                              type="password"
                              placeholder="Cle ou token"
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
                        {config.authType === "auth_json_b64" && (
                          <div className="session-auth-hint">
                            Le JSON sera encode en base64 cote client.
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="session-form-row">
                  <button
                    type="button"
                    onClick={() => setWorkspaceStep(1)}
                    disabled={formDisabled}
                  >
                    Retour
                  </button>
                  <button type="submit" disabled={formDisabled}>
                    {workspaceBusy ? "Validation..." : "Continuer"}
                  </button>
                </div>
              </form>
              {workspaceError && (
                <div className="attachments-error">{workspaceError}</div>
              )}
            </>
          )}

          {showStep3 && (
            <>
              <p className="session-hint">
                Workspace valide. Configurez le depot a cloner.
              </p>
              <div className="session-form-row">
                <div />
                <button
                  type="button"
                  className="icon-button"
                  onClick={handleLeaveWorkspace}
                  aria-label="Leave workspace"
                  title="Leave workspace"
                >
                  <FontAwesomeIcon icon={faRightFromBracket} />
                </button>
              </div>
              {(workspaceCreated?.workspaceId || workspaceId) && (
                <div className="session-meta">
                  Workspace: {workspaceCreated?.workspaceId || workspaceId}
                  {workspaceCreated?.workspaceSecret && (
                    <div className="session-meta">
                      Secret: {workspaceCreated.workspaceSecret}
                    </div>
                  )}
                </div>
              )}
              {isCloning ? (
                <div className="session-hint">
                  Clonage du depot...
                  {repoDisplay && (
                    <div className="session-meta">{repoDisplay}</div>
                  )}
                </div>
              ) : (
                <form className="session-form" onSubmit={onRepoSubmit}>
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
                      Authentification depot (optionnelle)
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
                          onChange={(event) => setSshKeyInput(event.target.value)}
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
                            onChange={(event) => setHttpUsername(event.target.value)}
                            disabled={formDisabled}
                            autoComplete="username"
                          />
                          <input
                            type="password"
                            placeholder="Mot de passe ou PAT"
                            value={httpPassword}
                            onChange={(event) => setHttpPassword(event.target.value)}
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
                  <div className="session-form-row">
                    <div />
                    <button type="submit" disabled={formDisabled}>
                      {sessionRequested ? "Chargement..." : "Cloner"}
                    </button>
                  </div>
                </form>
              )}
              {attachmentsError && (
                <div className="attachments-error">{attachmentsError}</div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  const renderExplorerNodes = (
    nodes,
    tabId,
    expandedSet,
    selectedPath,
    statusByPath,
    dirStatus
  ) => {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return null;
    }
    return (
      <ul className="explorer-tree-list">
        {nodes.map((node) => {
          if (node.type === "dir") {
            const isExpanded = expandedSet.has(node.path);
            const statusType = dirStatus?.[node.path] || "";
            return (
              <li
                key={node.path}
                className={`explorer-tree-item is-dir ${
                  statusType ? `is-${statusType}` : ""
                }`}
              >
                <button
                  type="button"
                  className="explorer-tree-toggle"
                  onClick={() => toggleExplorerDir(tabId, node.path)}
                >
                  <span className="explorer-tree-caret" aria-hidden="true">
                    <FontAwesomeIcon
                      icon={isExpanded ? faChevronDown : faChevronRight}
                    />
                  </span>
                  <span className="explorer-tree-name">{node.name}</span>
                </button>
                {isExpanded
                  ? renderExplorerNodes(
                      node.children,
                      tabId,
                      expandedSet,
                      selectedPath,
                      statusByPath,
                      dirStatus
                    )
                  : null}
              </li>
            );
          }
          const isSelected = selectedPath === node.path;
          const statusType = statusByPath?.[node.path] || "";
          return (
            <li
              key={node.path}
              className={`explorer-tree-item is-file ${
                isSelected ? "is-selected" : ""
              } ${statusType ? `is-${statusType}` : ""}`}
            >
              <button
                type="button"
                className="explorer-tree-file"
                onClick={() => loadExplorerFile(tabId, node.path)}
              >
                <span className="explorer-tree-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={faFileLines} />
                </span>
                <span className="explorer-tree-name">{node.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="app">
      <header className="header">
        <div className="topbar-left">
          <div className="topbar-spacer" />
          <div className="topbar-brand">
            <p className="eyebrow">m5chat</p>
            <div className="topbar-subtitle">
              {repoName || attachmentSession?.sessionId || "Session"}
            </div>
          </div>
          <div className="topbar-tabs">
            <WorktreeTabs
              worktrees={allTabs}
              activeWorktreeId={activeWorktreeId}
              onSelect={setActiveWorktreeId}
              onCreate={createWorktree}
              onClose={openCloseConfirm}
              onRename={renameWorktreeHandler}
              provider={llmProvider}
              providers={
                availableProviders.length
                  ? availableProviders
                  : [llmProvider]
              }
              branches={branches}
              defaultBranch={defaultBranch || currentBranch}
              branchLoading={branchLoading}
              branchError={branchError}
              onRefreshBranches={loadBranches}
              providerModelState={providerModelState}
              onRequestProviderModels={loadProviderModels}
              disabled={!connected}
              isMobile={isMobileLayout}
            />
          </div>
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className="icon-button"
            aria-label="Ouvrir les paramètres"
            onClick={handleOpenSettings}
          >
            <FontAwesomeIcon icon={faGear} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Quitter la session"
            onClick={handleLeaveSession}
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
          </button>
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
          <div className="side-body">
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
          </div>
          <div className="side-footer">
            <button
              type="button"
              className={`side-footer-button ${
                activePane === "settings" ? "is-active" : ""
              }`}
              onClick={handleOpenSettings}
              aria-pressed={activePane === "settings"}
            >
              <span className="side-footer-icon" aria-hidden="true">
                <FontAwesomeIcon icon={faGear} />
              </span>
              Paramètres
            </button>
          </div>
        </aside>

        <section
          className={`conversation ${
            chatFullWidth ? "is-chat-full" : "is-chat-narrow"
          }`}
          ref={conversationRef}
        >
          <div className="pane-stack">
            {activePane !== "settings" && (
              <div
                className="chat-toolbar"
                role="toolbar"
                aria-label="Outils du chat"
              >
              <div className="chat-toolbar-group">
                <button
                  type="button"
                  className={`chat-toolbar-button ${
                    activePane === "chat" ? "is-active" : ""
                  }`}
                  onClick={() => handleViewSelect("chat")}
                  aria-pressed={activePane === "chat"}
                  aria-label="Messages"
                  title="Messages"
                >
                  <span className="chat-toolbar-icon-wrap" aria-hidden="true">
                    <span className="chat-toolbar-icon">
                      <FontAwesomeIcon icon={faComments} />
                    </span>
                  </span>
                  <span className="chat-toolbar-label">Messages</span>
                </button>
                <button
                  type="button"
                  className={`chat-toolbar-button ${
                    activePane === "diff" ? "is-active" : ""
                  }`}
                  onClick={handleDiffSelect}
                  aria-pressed={activePane === "diff"}
                  aria-label="Diff"
                  title="Diff"
                >
                  <span className="chat-toolbar-icon-wrap" aria-hidden="true">
                    <span className="chat-toolbar-icon">
                      <FontAwesomeIcon icon={faCodeCompare} />
                    </span>
                  </span>
                  <span className="chat-toolbar-label">Diff</span>
                </button>
                <button
                  type="button"
                  className={`chat-toolbar-button ${
                    activePane === "explorer" ? "is-active" : ""
                  }`}
                  onClick={() => handleViewSelect("explorer")}
                  aria-pressed={activePane === "explorer"}
                  aria-label="Explorateur"
                  title="Explorateur"
                >
                  <span className="chat-toolbar-icon-wrap" aria-hidden="true">
                    <span className="chat-toolbar-icon" aria-hidden="true">
                      <FontAwesomeIcon icon={faFolderTree} />
                    </span>
                  </span>
                  <span className="chat-toolbar-label">Explorateur</span>
                </button>
                {terminalEnabled && (
                  <button
                    type="button"
                    className={`chat-toolbar-button ${
                      activePane === "terminal" ? "is-active" : ""
                    }`}
                    onClick={() => handleViewSelect("terminal")}
                    aria-pressed={activePane === "terminal"}
                    aria-label="Terminal"
                    title="Terminal"
                  >
                    <span className="chat-toolbar-icon-wrap" aria-hidden="true">
                      <span className="chat-toolbar-icon">
                        <FontAwesomeIcon icon={faTerminal} />
                      </span>
                    </span>
                    <span className="chat-toolbar-label">Terminal</span>
                  </button>
                )}
                {debugMode && rpcLogsEnabled && (
                  <button
                    type="button"
                    className={`chat-toolbar-button ${
                      activePane === "logs" ? "is-active" : ""
                    }`}
                    onClick={() => handleViewSelect("logs")}
                    aria-pressed={activePane === "logs"}
                    aria-label="Logs"
                    title="Logs"
                  >
                    <span className="chat-toolbar-icon-wrap" aria-hidden="true">
                      <span className="chat-toolbar-icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faClipboardList} />
                      </span>
                    </span>
                    <span className="chat-toolbar-label">Logs</span>
                  </button>
                )}
              </div>
              <div className="chat-toolbar-divider" />
              <div className="chat-toolbar-group">
                {debugMode && (
                  <div className="chat-toolbar-item" ref={toolbarExportRef}>
                    <button
                      type="button"
                      className={`chat-toolbar-button ${
                        toolbarExportOpen ? "is-open" : ""
                      }`}
                      onClick={() => {
                        if (!hasMessages) {
                          return;
                        }
                        setToolbarExportOpen((current) => !current);
                      }}
                      aria-expanded={toolbarExportOpen}
                      aria-label="Export"
                      title="Export"
                      disabled={!hasMessages}
                      >
                        <span
                          className="chat-toolbar-icon-wrap"
                          aria-hidden="true"
                        >
                          <span className="chat-toolbar-icon">
                            <FontAwesomeIcon icon={faDownload} />
                          </span>
                        </span>
                        <span className="chat-toolbar-label">Exporter</span>
                      </button>
                    {toolbarExportOpen && (
                      <div className="chat-toolbar-menu">
                        <button
                          type="button"
                          className="chat-toolbar-menu-item"
                          onClick={() => handleExportChat("markdown")}
                          disabled={!hasMessages}
                        >
                          Markdown
                        </button>
                        <button
                          type="button"
                          className="chat-toolbar-menu-item"
                          onClick={() => handleExportChat("json")}
                          disabled={!hasMessages}
                        >
                          JSON
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="chat-toolbar-button is-danger"
                  onClick={() => handleClearChat()}
                  aria-label="Clear chat"
                  title="Clear chat"
                  disabled={!hasMessages}
                >
                  <span className="chat-toolbar-icon-wrap" aria-hidden="true">
                    <span className="chat-toolbar-icon" aria-hidden="true">
                      <FontAwesomeIcon icon={faBroom} />
                    </span>
                  </span>
                  <span className="chat-toolbar-label">Effacer</span>
                </button>
              </div>
            </div>
            )}
            <main className={`chat ${activePane === "chat" ? "" : "is-hidden"}`}>
              <div className="chat-scroll" ref={listRef}>
                <div className="chat-scroll-inner">
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
                  if (message?.groupType === "toolResult") {
                    return (
                      <div
                        key={message.id}
                        className="bubble command-execution"
                      >
                        {message.items.map((item) => {
                          const toolTitle = `Outil : ${
                            item.toolResult?.name ||
                            item.toolResult?.tool ||
                            "Tool"
                          }`;
                          const output =
                            item.toolResult?.output || item.text || "";
                          const isExpandable = Boolean(output);
                          const summaryContent = (
                            <span className="command-execution-title">
                              {toolTitle}
                            </span>
                          );
                          const panelKey = `tool-${item.id}`;
                          return (
                            <div key={item.id}>
                              {isExpandable ? (
                                <details
                                  className="command-execution-panel"
                                  open={Boolean(toolResultPanelOpen[panelKey])}
                                  onToggle={(event) => {
                                    const isOpen = event.currentTarget.open;
                                    setToolResultPanelOpen((prev) => ({
                                      ...prev,
                                      [panelKey]: isOpen,
                                    }));
                                  }}
                                >
                                  <summary className="command-execution-summary">
                                    {summaryContent}
                                  </summary>
                                  <pre className="command-execution-output">
                                    {output}
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
                        {renderMessageAttachments(message.attachments)}
                      </div>
                    );
                  }

                  return (
                    <div key={message.id} className={`bubble ${message.role}`}>
                      {(() => {
                        const rawText = message.text || "";
                        const isWarning = rawText.startsWith("⚠️");
                        const warningText = rawText.replace(/^⚠️\s*/, "");
                        const { cleanedText, blocks, filerefs } =
                          extractVibecoderBlocks(isWarning ? warningText : rawText);
                        const content = (
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ node, ...props }) => {
                                return (
                                  <a
                                    {...props}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  />
                                );
                              },
                              code: ({
                                node,
                                inline,
                                className,
                                children,
                                ...props
                              }) => {
                                const rawText = Array.isArray(children)
                                  ? children.join("")
                                  : String(children);
                                const text = rawText.replace(/\n$/, "");
                                if (!inline) {
                                  return (
                                    <code className={className} {...props}>
                                      {children}
                                    </code>
                                  );
                                }
                                return (
                                  <span className="inline-code">
                                    <code className={className} {...props}>
                                      {text}
                                    </code>
                                    <button
                                      type="button"
                                      className="code-copy"
                                      aria-label="Copier le code"
                                      title="Copier"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        copyTextToClipboard(text);
                                      }}
                                    >
                                      <FontAwesomeIcon icon={faCopy} />
                                    </button>
                                  </span>
                                );
                              },
                            }}
                          >
                            {cleanedText}
                          </ReactMarkdown>
                        );
                        return (
                          <>
                            {isWarning ? (
                              <div className="warning-message">
                                <span className="warning-icon" aria-hidden="true">
                                  <FontAwesomeIcon icon={faTriangleExclamation} />
                                </span>
                                <div className="warning-body">{content}</div>
                              </div>
                            ) : (
                              content
                            )}
                            {filerefs.length ? (
                              <ul className="fileref-list">
                                {filerefs.map((pathRef) => (
                                  <li
                                    key={`${message.id}-fileref-${pathRef}`}
                                    className="fileref-item"
                                  >
                                    <button
                                      type="button"
                                      className="fileref-link"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        openFileInExplorer(pathRef);
                                      }}
                                    >
                                      {pathRef}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                            {blocks.map((block, index) => {
                              const blockKey = `${message.id}-${index}`;
                              if (block.type === "form") {
                                return (
                                  <div
                                    className="vibecoder-form"
                                    key={blockKey}
                                  >
                                    <button
                                      type="button"
                                      className="vibecoder-form-button"
                                      onClick={() =>
                                        openVibecoderForm(block, blockKey)
                                      }
                                    >
                                      {block.question ||
                                        "Ouvrir le formulaire"}
                                    </button>
                                  </div>
                                );
                              }

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

                              const isInline = block.type === "yesno";
                              return (
                                <div
                                  className={`choices ${
                                    isInline ? "is-inline" : ""
                                  }`}
                                  key={blockKey}
                                >
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
                                    } ${isInline ? "is-inline" : ""}`}
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
                            {renderMessageAttachments(message.attachments)}
                          </>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
            {currentProcessing && (
                <div className="bubble assistant typing">
                  <div className="typing-indicator">
                    <div
                      className="loader"
                      title={currentActivity || "Traitement en cours..."}
                    >
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                    <span className="typing-text">
                      {currentActivity || "Traitement en cours..."}
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
                <div className="diff-title">
                  {isInWorktree ? "Diff du worktree" : "Diff du repository"}
                </div>
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
                    disabled={!connected || currentProcessing || !hasCurrentChanges}
                    title="Envoyer 'Commit' dans le chat"
                  >
                    Commit
                  </button>
                  <button
                    type="button"
                    className="diff-action-button primary"
                    onClick={() => sendCommitMessage("Commit & Push")}
                    disabled={!connected || currentProcessing || !hasCurrentChanges}
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
              ) : currentDiff.diff ? (
                <pre className="diff-fallback">{currentDiff.diff}</pre>
              ) : (
                <div className="diff-empty">Aucun changement detecte.</div>
              )}
            </div>
            <div
              className={`explorer-panel ${
                activePane === "explorer" ? "" : "is-hidden"
              }`}
            >
              <div className="explorer-header">
                <div>
                  <div className="explorer-title">Explorateur</div>
                  {(repoName ||
                    activeWorktree?.branchName ||
                    activeWorktree?.name) && (
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
                  onClick={() =>
                    (() => {
                      const tabId = activeWorktreeId || "main";
                      requestExplorerTree(tabId, true);
                      requestExplorerStatus(tabId, true);
                    })()
                  }
                  disabled={!attachmentSession?.sessionId}
                >
                  Rafraichir
                </button>
              </div>
              <div className="explorer-body">
                <div className="explorer-tree">
                  {activeExplorer.loading ? (
                    <div className="explorer-empty">Chargement...</div>
                  ) : activeExplorer.error ? (
                    <div className="explorer-empty">
                      {activeExplorer.error}
                    </div>
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
                          Liste tronquee apres {activeExplorer.treeTotal} entrees.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="explorer-empty">
                      Aucun fichier trouve.
                    </div>
                  )}
                </div>
                <div className="explorer-editor">
                  <div className="explorer-editor-header">
                    <span className="explorer-editor-path">
                      {activeExplorer.selectedPath ||
                        "Aucun fichier selectionne"}
                    </span>
                    <div className="explorer-editor-actions">
                      {activeExplorer.selectedPath && !activeExplorer.fileBinary && (
                        <button
                          type="button"
                          className="explorer-action"
                          onClick={() =>
                            toggleExplorerEditMode(
                              activeWorktreeId || "main",
                              !activeExplorer.editMode
                            )
                          }
                          disabled={activeExplorer.fileLoading}
                        >
                          {activeExplorer.editMode ? "Lecture" : "Editer"}
                        </button>
                      )}
                      {activeExplorer.editMode && (
                        <button
                          type="button"
                          className="explorer-action primary"
                          onClick={() =>
                            saveExplorerFile(activeWorktreeId || "main")
                          }
                          disabled={
                            activeExplorer.fileSaving ||
                            !activeExplorer.isDirty
                          }
                        >
                          {activeExplorer.fileSaving ? "Sauvegarde..." : "Sauver"}
                        </button>
                      )}
                    </div>
                  </div>
                  {activeExplorer.fileLoading ? (
                    <div className="explorer-editor-empty">
                      Chargement...
                    </div>
                  ) : activeExplorer.fileError ? (
                    <div className="explorer-editor-empty">
                      {activeExplorer.fileError}
                    </div>
                  ) : activeExplorer.fileBinary ? (
                    <div className="explorer-editor-empty">
                      Fichier binaire non affiche.
                    </div>
                  ) : activeExplorer.selectedPath ? (
                    <>
                      {activeExplorer.editMode ? (
                        <textarea
                          className="explorer-editor-input"
                          value={activeExplorer.draftContent}
                          onChange={(event) =>
                            updateExplorerDraft(
                              activeWorktreeId || "main",
                              event.target.value
                            )
                          }
                          spellCheck={false}
                        />
                      ) : (
                        <pre className="explorer-editor-content">
                          {activeExplorer.fileContent}
                        </pre>
                      )}
                      {activeExplorer.fileSaveError && (
                        <div className="explorer-truncated">
                          {activeExplorer.fileSaveError}
                        </div>
                      )}
                      {activeExplorer.fileTruncated && (
                        <div className="explorer-truncated">
                          Fichier tronque pour l'affichage.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="explorer-editor-empty">
                      Selectionnez un fichier dans l'arborescence.
                    </div>
                  )}
                </div>
              </div>
            </div>
            {terminalEnabled && (
              <div
                className={`terminal-panel ${
                  activePane === "terminal" ? "" : "is-hidden"
                }`}
              >
                <div className="terminal-header">
                  <div className="terminal-title">Terminal</div>
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
                    Demarrez une session pour ouvrir le terminal.
                  </div>
                )}
              </div>
            )}
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
                    onClick={handleClearRpcLogs}
                    disabled={scopedRpcLogs.length === 0}
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
                <button
                  type="button"
                  className="settings-back icon-button"
                  onClick={handleSettingsBack}
                  aria-label="Revenir à la vue précédente"
                  title="Revenir"
                >
                  <span aria-hidden="true">
                    <FontAwesomeIcon icon={faArrowLeft} />
                  </span>
                </button>
              <div className="settings-heading">
                <div className="settings-title">Paramètres utilisateur</div>
                <div className="settings-subtitle">
                  Ces réglages sont stockés dans votre navigateur.
                </div>
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
                  <span className="settings-name">
                    Afficher les tool results dans le chat
                  </span>
                  <span className="settings-hint">
                    Affiche les blocs tool_result dans la conversation.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  checked={showToolResults}
                  onChange={(event) =>
                    setShowToolResults(event.target.checked)
                  }
                />
              </label>
              <label className="settings-item">
                <span className="settings-text">
                  <span className="settings-name">Chat pleine largeur</span>
                  <span className="settings-hint">
                    Utilise toute la largeur disponible pour la zone de chat.
                  </span>
                </span>
                <input
                  type="checkbox"
                  className="settings-toggle"
                  checked={chatFullWidth}
                  onChange={(event) => setChatFullWidth(event.target.checked)}
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
              <label className="settings-item">
                <span className="settings-text">
                  <span className="settings-name">Mode sombre</span>
                  <span className="settings-hint">
                    Active le thème sombre pour l'interface.
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
                  <span className="settings-name">Style de l'input</span>
                  <span className="settings-hint">
                    Choisissez un champ de saisie mono ou multiligne.
                  </span>
                </span>
                <select
                  className="settings-select"
                  value={composerInputMode}
                  onChange={(event) => setComposerInputMode(event.target.value)}
                >
                  <option value="single">Monoligne</option>
                  <option value="multi">Multiligne</option>
                </select>
              </label>
              <label className="settings-item">
                <span className="settings-text">
                  <span className="settings-name">Mode débug</span>
                  <span className="settings-hint">
                    Active l'accès aux logs et à l'export Markdown/JSON.
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
                    Identité Git pour ce dépôt
                  </span>
                  <span className="settings-hint">
                    Renseignez user.name et user.email pour les commits du dépôt.
                  </span>
                  <span className="settings-hint">
                    Valeurs globales:{" "}
                    {gitIdentityGlobal.name || "Non défini"} /{" "}
                    {gitIdentityGlobal.email || "Non défini"}.
                  </span>
                  <span className="settings-hint">
                    {gitIdentityRepo.name || gitIdentityRepo.email
                      ? `Valeurs du dépôt: ${
                          gitIdentityRepo.name || "Non défini"
                        } / ${gitIdentityRepo.email || "Non défini"}.`
                      : "Aucune valeur spécifique au dépôt."}
                  </span>
                </div>
                <div className="settings-fields">
                  <label className="settings-field">
                    <span className="settings-field-label">user.name</span>
                    <input
                      type="text"
                      className="settings-input"
                      value={gitIdentityName}
                      onChange={(event) => setGitIdentityName(event.target.value)}
                      placeholder={gitIdentityGlobal.name || "Nom complet"}
                      disabled={
                        gitIdentityLoading ||
                        gitIdentitySaving ||
                        !attachmentSession?.sessionId
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span className="settings-field-label">user.email</span>
                    <input
                      type="email"
                      className="settings-input"
                      value={gitIdentityEmail}
                      onChange={(event) =>
                        setGitIdentityEmail(event.target.value)
                      }
                      placeholder={
                        gitIdentityGlobal.email || "ton.email@exemple.com"
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
                    {gitIdentitySaving ? "Enregistrement..." : "Enregistrer"}
                  </button>
                  {gitIdentityLoading ? (
                    <span className="settings-status">Chargement...</span>
                  ) : null}
                  {gitIdentityError ? (
                    <span className="settings-status is-error">
                      {gitIdentityError}
                    </span>
                  ) : null}
                  {gitIdentityMessage ? (
                    <span className="settings-status">{gitIdentityMessage}</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          </div>

          {activePane === "chat" ? (
            <form
              className="composer composer--sticky"
              onSubmit={onSubmit}
              ref={composerRef}
            >
              <div className="composer-inner">
                {draftAttachments.length ? (
                  <div
                    className="composer-attachments"
                    aria-label="Pièces sélectionnées"
                  >
                    {draftAttachments.map((attachment) => {
                      const label = attachment?.name || attachment?.path || "";
                      const key = attachment?.path || attachment?.name || label;
                      const extension = getAttachmentExtension(attachment);
                      const sizeLabel =
                        attachment?.lineCount || attachment?.lines
                          ? `${attachment.lineCount || attachment.lines} lignes`
                          : formatAttachmentSize(attachment?.size);
                      return (
                        <div className="attachment-card" key={key}>
                          <div className="attachment-card-body">
                            <div className="attachment-card-title">{label}</div>
                            {sizeLabel ? (
                              <div className="attachment-card-meta">
                                {sizeLabel}
                              </div>
                            ) : null}
                          </div>
                          <div className="attachment-card-footer">
                            <span className="attachment-card-type">
                              {extension}
                            </span>
                            <button
                              type="button"
                              className="attachment-card-remove"
                              aria-label={`Retirer ${label}`}
                              onClick={() =>
                                removeDraftAttachment(
                                  attachment?.path || attachment?.name
                                )
                              }
                            >
                              <FontAwesomeIcon icon={faXmark} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
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
                        {draftAttachments.length}
                      </span>
                    ) : null}
                  </button>
                  <input
                    ref={uploadInputRef}
                    type="file"
                    multiple
                    onChange={onUploadAttachments}
                    disabled={!attachmentSession || attachmentsLoading}
                    className="visually-hidden"
                  />
                  <textarea
                    className={`composer-input ${
                      composerInputMode === "single" ? "is-single" : "is-multi"
                    }`}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleComposerKeyDown}
                    onPaste={onPasteAttachments}
                    placeholder="Écris ton message…"
                    rows={composerInputMode === "single" ? 1 : 2}
                    ref={inputRef}
                  />
                  {canInterrupt ? (
                    <button
                      type="button"
                      className="primary stop-button"
                      onClick={interruptTurn}
                      aria-label="Stop"
                      title="Stop"
                    >
                      <span className="stop-icon">⏹</span>
                    </button>
                  ) : (
                    <button
                      type="submit"
                      className="primary send-button"
                      disabled={!connected || !input.trim()}
                      aria-label="Envoyer"
                      title="Envoyer"
                    >
                      <span className="send-icon">➤</span>
                    </button>
                  )}
                </div>

                {attachmentsError && (
                  <div className="attachments-error composer-attachments-error">
                    {attachmentsError}
                  </div>
                )}
              </div>
            </form>
          ) : null}
        </section>
      </div>
      {activeForm ? (
        <div
          className="vibecoder-form-overlay"
          role="dialog"
          aria-modal="true"
          onClick={closeVibecoderForm}
        >
          <div
            className="vibecoder-form-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="vibecoder-form-header">
              <div className="vibecoder-form-title">
                {activeForm.question || "Formulaire"}
              </div>
              <button
                type="button"
                className="vibecoder-form-close"
                aria-label="Fermer"
                onClick={closeVibecoderForm}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <form className="vibecoder-form-body" onSubmit={submitActiveForm}>
              {activeForm.fields.map((field) => {
                const fieldId = `vibecoder-${activeForm.key}-${field.id}`;
                const value = activeFormValues[field.id] ?? "";
                if (field.type === "checkbox") {
                  return (
                    <div className="vibecoder-form-field" key={field.id}>
                      <label className="vibecoder-form-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(activeFormValues[field.id])}
                          onChange={(event) =>
                            updateActiveFormValue(
                              field.id,
                              event.target.checked
                            )
                          }
                        />
                        <span>{field.label}</span>
                      </label>
                    </div>
                  );
                }
                if (field.type === "textarea") {
                  return (
                    <div className="vibecoder-form-field" key={field.id}>
                      <label className="vibecoder-form-label" htmlFor={fieldId}>
                        {field.label}
                      </label>
                      <textarea
                        id={fieldId}
                        className="vibecoder-form-input"
                        rows={4}
                        value={value}
                        onChange={(event) =>
                          updateActiveFormValue(field.id, event.target.value)
                        }
                      />
                    </div>
                  );
                }
                if (field.type === "radio") {
                  return (
                    <div className="vibecoder-form-field" key={field.id}>
                      <div className="vibecoder-form-label">{field.label}</div>
                      <div className="vibecoder-form-options">
                        {(field.choices || []).length ? (
                          field.choices.map((choice) => (
                            <label
                              key={`${field.id}-${choice}`}
                              className="vibecoder-form-option"
                            >
                              <input
                                type="radio"
                                name={fieldId}
                                value={choice}
                                checked={value === choice}
                                onChange={() =>
                                  updateActiveFormValue(field.id, choice)
                                }
                              />
                              <span>{choice}</span>
                            </label>
                          ))
                        ) : (
                          <div className="vibecoder-form-empty">
                            Aucune option.
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                if (field.type === "select") {
                  return (
                    <div className="vibecoder-form-field" key={field.id}>
                      <label className="vibecoder-form-label" htmlFor={fieldId}>
                        {field.label}
                      </label>
                      <select
                        id={fieldId}
                        className="vibecoder-form-input vibecoder-form-select"
                        value={value}
                        onChange={(event) =>
                          updateActiveFormValue(field.id, event.target.value)
                        }
                      >
                        {(field.choices || []).length ? (
                          field.choices.map((choice) => (
                            <option key={`${field.id}-${choice}`} value={choice}>
                              {choice}
                            </option>
                          ))
                        ) : (
                          <option value="">Aucune option</option>
                        )}
                      </select>
                    </div>
                  );
                }
                return (
                  <div className="vibecoder-form-field" key={field.id}>
                    <label className="vibecoder-form-label" htmlFor={fieldId}>
                      {field.label}
                    </label>
                    <input
                      id={fieldId}
                      className="vibecoder-form-input"
                      type="text"
                      value={value}
                      onChange={(event) =>
                        updateActiveFormValue(field.id, event.target.value)
                      }
                    />
                  </div>
                );
              })}
              <div className="vibecoder-form-actions">
                <button
                  type="button"
                  className="vibecoder-form-cancel"
                  onClick={closeVibecoderForm}
                >
                  Annuler
                </button>
                <button type="submit" className="vibecoder-form-submit">
                  Envoyer
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {closeConfirm ? (
        <div
          className="worktree-close-confirm-overlay"
          role="dialog"
          aria-modal="true"
          onClick={closeCloseConfirm}
        >
          <div
            className="worktree-close-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="worktree-close-confirm-header">
              <div className="worktree-close-confirm-title">
                Fermer le worktree ?
              </div>
              <button
                type="button"
                className="worktree-close-confirm-close"
                aria-label="Fermer"
                onClick={closeCloseConfirm}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="worktree-close-confirm-body">
              Toutes les modifications seront perdues. Que souhaitez-vous faire ?
            </div>
            <div className="worktree-close-confirm-actions">
              <button
                type="button"
                className="worktree-close-confirm-cancel"
                onClick={closeCloseConfirm}
              >
                Annuler
              </button>
              <button
                type="button"
                className="worktree-close-confirm-merge"
                onClick={handleConfirmMerge}
              >
                Merge vers {mergeTargetBranch}
              </button>
              <button
                type="button"
                className="worktree-close-confirm-delete"
                onClick={handleConfirmDelete}
              >
                Supprimer le worktree
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {attachmentPreview ? (
        <div
          className="attachment-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => setAttachmentPreview(null)}
        >
          <button
            type="button"
            className="attachment-modal-close"
            aria-label="Fermer"
            onClick={() => setAttachmentPreview(null)}
          >
            <FontAwesomeIcon icon={faXmark} />
          </button>
          <div
            className="attachment-modal-body"
            onClick={(event) => event.stopPropagation()}
          >
            <img
              src={attachmentPreview.url}
              alt={attachmentPreview.name || "Aperçu"}
            />
            {attachmentPreview.name ? (
              <div className="attachment-modal-name">
                {attachmentPreview.name}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
