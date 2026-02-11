import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "@uiw/react-markdown-preview/markdown.css";
import { parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import "@xterm/xterm/css/xterm.css";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronDown,
  faChevronRight,
  faFileLines,
  faGear,
  faPaperclip,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import ChatMessages from "./components/Chat/ChatMessages.jsx";
import ChatComposer from "./components/Chat/ChatComposer.jsx";
import ChatToolbar from "./components/Chat/ChatToolbar.jsx";
import useChatComposer from "./components/Chat/useChatComposer.js";
import useChatSocket from "./hooks/useChatSocket.js";
import useWorkspaceAuth from "./hooks/useWorkspaceAuth.js";
import useWorktrees from "./hooks/useWorktrees.js";
import useTerminalSession from "./hooks/useTerminalSession.js";
import useNotifications from "./hooks/useNotifications.js";
import useRepoStatus from "./hooks/useRepoStatus.js";
import useAttachments from "./hooks/useAttachments.jsx";
import useBacklog from "./hooks/useBacklog.js";
import useChatCommands from "./hooks/useChatCommands.js";
import useRepoBranchesModels from "./hooks/useRepoBranchesModels.js";
import useSessionLifecycle from "./hooks/useSessionLifecycle.js";
import useSessionHandoff from "./hooks/useSessionHandoff.js";
import useGitIdentity from "./hooks/useGitIdentity.js";
import useVibe80Forms from "./hooks/useVibe80Forms.js";
import useLocalPreferences from "./hooks/useLocalPreferences.js";
import useLayoutMode from "./hooks/useLayoutMode.js";
import useRpcLogView from "./hooks/useRpcLogView.js";
import useToolbarExport from "./hooks/useToolbarExport.js";
import usePanelState from "./hooks/usePanelState.js";
import usePaneNavigation from "./hooks/usePaneNavigation.js";
import useSessionReset from "./hooks/useSessionReset.js";
import useTurnInterrupt from "./hooks/useTurnInterrupt.js";
import useDiffNavigation from "./hooks/useDiffNavigation.js";
import useChatCollapse from "./hooks/useChatCollapse.js";
import useSessionResync from "./hooks/useSessionResync.js";
import useMessageSync from "./hooks/useMessageSync.js";
import useChatMessagesState from "./hooks/useChatMessagesState.js";
import useWorktreeCloseConfirm from "./hooks/useWorktreeCloseConfirm.js";
import useRpcLogActions from "./hooks/useRpcLogActions.js";
import useExplorerActions from "./hooks/useExplorerActions.js";
import useProviderSelection from "./hooks/useProviderSelection.js";
import useChatExport from "./hooks/useChatExport.js";
import useChatSend from "./hooks/useChatSend.js";
import useChatClear from "./hooks/useChatClear.js";
const ExplorerPanel = lazy(() => import("./components/Explorer/ExplorerPanel.jsx"));
const DiffPanel = lazy(() => import("./components/Diff/DiffPanel.jsx"));
import Topbar from "./components/Topbar/Topbar.jsx";
const TerminalPanel = lazy(() => import("./components/Terminal/TerminalPanel.jsx"));
import SessionGate from "./components/SessionGate/SessionGate.jsx";
const SettingsPanel = lazy(() => import("./components/Settings/SettingsPanel.jsx"));
const LogsPanel = lazy(() => import("./components/Logs/LogsPanel.jsx"));
import vibe80LogoDark from "./assets/vibe80_dark.svg";
import vibe80LogoLight from "./assets/vibe80_light.svg";
import { useI18n } from "./i18n.jsx";

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

const providerAuthOptions = {
  codex: ["api_key", "auth_json_b64"],
  claude: ["api_key", "setup_token"],
};

const getProviderAuthType = (provider, config) => {
  const allowed = providerAuthOptions[provider] || [];
  if (!allowed.length) {
    return config?.authType || "api_key";
  }
  return allowed.includes(config?.authType) ? config.authType : allowed[0];
};

const normalizeVibe80Question = (rawQuestion) => {
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

const extractVibe80Blocks = (text, t = (value) => value) => {
  const pattern =
    /<!--\s*vibe80:(choices|form)\s*([^>]*)-->([\s\S]*?)<!--\s*\/vibe80:\1\s*-->|<!--\s*vibe80:yesno\s*([^>]*)-->/g;
  const filerefPattern = /<!--\s*vibe80:fileref\s+([^>]+?)\s*-->/g;
  const taskPattern = /<!--\s*vibe80:task\s*[^>]*-->/g;
  const blocks = [];
  const filerefs = [];
  const normalizedText = String(text || "")
    .replace(filerefPattern, (_, filePath) => {
      const trimmed = String(filePath || "").trim();
      if (trimmed) {
        filerefs.push(trimmed);
      }
      return "";
    })
    .replace(taskPattern, "");
  let cleaned = "";
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(normalizedText)) !== null) {
    cleaned += normalizedText.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const blockType = match[1];
    const question = normalizeVibe80Question(match[2] || match[4]);
    const body = match[3] || "";

    if (!blockType) {
      blocks.push({
        type: "yesno",
        question,
        choices: [t("Yes"), t("No")],
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

const extractVibe80Task = (text) => {
  const pattern = /<!--\s*vibe80:task\s*([^>]*)-->/g;
  const raw = String(text || "");
  let label = "";
  let match;
  while ((match = pattern.exec(raw)) !== null) {
    const normalized = normalizeVibe80Question(match[1]);
    if (normalized) {
      label = normalized;
    }
  }
  return label;
};

const extractFirstLine = (text) => {
  const raw = String(text || "");
  if (!raw) {
    return "";
  }
  return raw.split(/\r?\n/)[0].trim();
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
const BACKLOG_PAGE_SIZE = 5;
const CHAT_COLLAPSE_THRESHOLD = 140;
const CHAT_COLLAPSE_VISIBLE = 60;
const REPO_HISTORY_KEY = "repoHistory";
const AUTH_MODE_KEY = "authMode";
const OPENAI_AUTH_MODE_KEY = "openAiAuthMode";
const LLM_PROVIDER_KEY = "llmProvider";
const LLM_PROVIDERS_KEY = "llmProviders";
const CHAT_COMMANDS_VISIBLE_KEY = "chatCommandsVisible";
const TOOL_RESULTS_VISIBLE_KEY = "toolResultsVisible";
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

const getAttachmentExtension = (attachment, t = (value) => value) => {
  const name = getAttachmentName(attachment);
  if (!name || !name.includes(".")) {
    return t("FILE");
  }
  const ext = name.split(".").pop();
  return ext ? ext.toUpperCase() : t("FILE");
};

const formatAttachmentSize = (bytes, t = (value) => value) => {
  if (!Number.isFinite(bytes)) {
    return "";
  }
  if (bytes < 1024) {
    return t("{{count}} B", { count: bytes });
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return t("{{count}} KB", { count: Math.round(kb) });
  }
  const mb = kb / 1024;
  return t("{{count}} MB", { count: mb.toFixed(1) });
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
  return "single";
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

const getLanguageForPath = (filePath) => {
  if (!filePath) {
    return "plaintext";
  }
  const baseName = filePath.split("/").pop() || "";
  if (baseName.toLowerCase() === "dockerfile") {
    return "dockerfile";
  }
  const match = filePath.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match ? match[1] : "";
  switch (ext) {
    case "js":
    case "cjs":
    case "mjs":
      return "javascript";
    case "jsx":
      return "javascript";
    case "ts":
      return "typescript";
    case "tsx":
      return "typescript";
    case "json":
      return "json";
    case "md":
    case "markdown":
      return "markdown";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "html":
    case "htm":
      return "html";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
    case "zsh":
      return "shell";
    case "py":
      return "python";
    case "go":
      return "go";
    case "java":
      return "java";
    case "c":
      return "c";
    case "cc":
    case "cpp":
    case "cxx":
    case "hpp":
    case "h":
      return "cpp";
    case "rs":
      return "rust";
    case "rb":
      return "ruby";
    case "php":
      return "php";
    case "sql":
      return "sql";
    case "toml":
      return "toml";
    case "xml":
      return "xml";
    case "dockerfile":
      return "dockerfile";
    default:
      return "plaintext";
  }
};

const formatProviderLabel = (provider, t = (value) => value) => {
  if (provider === "codex") {
    return t("Codex");
  }
  if (provider === "claude") {
    return t("Claude");
  }
  return provider || "";
};

function App() {
  const { t, language, setLanguage, locale } = useI18n();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState(() => t("Connecting..."));
  const [processing, setProcessing] = useState(false);
  const [activity, setActivity] = useState("");
  const [connected, setConnected] = useState(false);
  const [attachmentSession, setAttachmentSession] = useState(null);
  const [repoUrl, setRepoUrl] = useState(getInitialRepoUrl);
  const [repoInput, setRepoInput] = useState(getInitialRepoUrl);
  const [sessionNameInput, setSessionNameInput] = useState("");
  const [repoAuth, setRepoAuth] = useState(null);
  const [authMode, setAuthMode] = useState(readAuthMode);
  const [sshKeyInput, setSshKeyInput] = useState("");
  const [httpUsername, setHttpUsername] = useState("");
  const [httpPassword, setHttpPassword] = useState("");
  const [sessionMode, setSessionMode] = useState("new");
  const [defaultInternetAccess, setDefaultInternetAccess] = useState(true);
  const [defaultDenyGitCredentialsAccess, setDefaultDenyGitCredentialsAccess] = useState(false);
  const [toast, setToast] = useState(null);
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
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    readNotificationsEnabled
  );
  const [themeMode, setThemeMode] = useState(readThemeMode);
  const [composerInputMode, setComposerInputMode] = useState(
    readComposerInputMode
  );
  const toastTimeoutRef = useRef(null);
  const showToast = useCallback((message, type = "success") => {
    setToast({ message, type });
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, 3000);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
        toastTimeoutRef.current = null;
      }
    };
  }, []);
  const [paneByTab, setPaneByTab] = useState({ main: "chat" });
  const handleSendMessageRef = useRef(null);
  const loadExplorerFileRef = useRef(null);
  const requestExplorerTreeRef = useRef(null);
  const requestExplorerStatusRef = useRef(null);
  const explorerDefaultState = useMemo(
    () => ({
      tree: null,
      loading: false,
      error: "",
      treeTruncated: false,
      treeTotal: 0,
      openTabPaths: [],
      activeFilePath: null,
      filesByPath: {},
      selectedPath: null,
      selectedType: null,
      renamingPath: null,
      renameDraft: "",
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
  const [currentTurnId, setCurrentTurnId] = useState(null);
  const [rpcLogs, setRpcLogs] = useState([]);
  const [rpcLogsEnabled, setRpcLogsEnabled] = useState(true);
  const [logFilterByTab, setLogFilterByTab] = useState({ main: "all" });
  const [sideOpen, setSideOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState(null);
  const [terminalEnabled, setTerminalEnabled] = useState(true);
  const explorerRef = useRef({});
  // Worktree states for parallel LLM requests
  const [mainTaskLabel, setMainTaskLabel] = useState("");
  const lastPaneByTabRef = useRef(new Map());
  const getItemActivityLabel = (item) => {
    if (!item?.type) {
      return "";
    }
    if (item.type === "commandExecution") {
      const command =
        item.commandActions?.command || item.command || t("Command");
      return t("Command: {{command}}", { command });
    }
    if (item.type === "fileChange") {
      return t("Applying changes...");
    }
    if (item.type === "mcpToolCall") {
      return t("Tool: {{tool}}", { tool: item.tool });
    }
    if (item.type === "reasoning") {
      return t("Reasoning...");
    }
    if (item.type === "agentMessage") {
      return t("Generating response...");
    }
    return "";
  };
  const {
    commandPanelOpen,
    setCommandPanelOpen,
    toolResultPanelOpen,
    setToolResultPanelOpen,
  } = usePanelState();
  const [repoHistory, setRepoHistory] = useState(() => readRepoHistory());
  const [debugMode, setDebugMode] = useState(() => readDebugMode());
  const socketRef = useRef(null);
  const rpcLogsEnabledRef = useRef(true);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const uploadInputRef = useRef(null);
  const { toolbarExportOpen, setToolbarExportOpen, toolbarExportRef } =
    useToolbarExport();
  const conversationRef = useRef(null);
  const composerRef = useRef(null);
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
  const pingIntervalRef = useRef(null);
  const lastPongRef = useRef(0);
  const messagesRef = useRef([]);
  const {
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
  } = useWorkspaceAuth({
    t,
    encodeBase64,
    copyTextToClipboard,
    extractRepoName,
    setSessionMode,
    showToast,
    getProviderAuthType,
  });
  const {
    handoffOpen,
    handoffQrDataUrl,
    handoffExpiresAt,
    handoffLoading,
    handoffError,
    handoffRemaining,
    requestHandoffQr,
    closeHandoffQr,
  } = useSessionHandoff({
    t,
    apiFetch,
    attachmentSessionId: attachmentSession?.sessionId,
  });
  const {
    gitIdentityName,
    gitIdentityEmail,
    gitIdentityGlobal,
    gitIdentityRepo,
    gitIdentityLoading,
    gitIdentitySaving,
    gitIdentityError,
    gitIdentityMessage,
    setGitIdentityName,
    setGitIdentityEmail,
    handleSaveGitIdentity,
  } = useGitIdentity({
    t,
    apiFetch,
    attachmentSessionId: attachmentSession?.sessionId,
  });


  const messageIndex = useMemo(() => new Map(), []);
  const commandIndex = useMemo(() => new Map(), []);
  const repoName = useMemo(
    () => extractRepoName(attachmentSession?.repoUrl),
    [attachmentSession?.repoUrl]
  );
  const brandLogo = themeMode === "dark" ? vibe80LogoDark : vibe80LogoLight;
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

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    explorerRef.current = explorerByTab;
  }, [explorerByTab]);

  useEffect(() => {
    rpcLogsEnabledRef.current = rpcLogsEnabled;
  }, [rpcLogsEnabled]);

  const {
    attachmentPreview,
    attachmentsError,
    attachmentsLoading,
    draftAttachments,
    renderMessageAttachments,
    setAttachmentPreview,
    setAttachmentsError,
    setAttachmentsLoading,
    setDraftAttachments,
  } = useAttachments({
    attachmentSessionId: attachmentSession?.sessionId,
    workspaceToken,
    normalizeAttachments,
    isImageAttachment,
    getAttachmentName,
    attachmentIcon: <FontAwesomeIcon icon={faPaperclip} />,
    t,
  });

  const choicesKey = useMemo(
    () =>
      attachmentSession?.sessionId
        ? `choices:${attachmentSession.sessionId}`
        : null,
    [attachmentSession?.sessionId, apiFetch]
  );
  const {
    choiceSelections,
    setChoiceSelections,
    activeForm,
    activeFormValues,
    openVibe80Form,
    closeVibe80Form,
    updateActiveFormValue,
    submitActiveForm,
    handleChoiceClick,
  } = useVibe80Forms({
    choicesKey,
    input,
    setInput,
    handleSendMessageRef,
    draftAttachments,
    setDraftAttachments,
  });
  useLocalPreferences({
    authMode,
    llmProvider,
    selectedProviders,
    openAiAuthMode,
    showChatCommands,
    showToolResults,
    notificationsEnabled,
    themeMode,
    composerInputMode,
    repoHistory,
    debugMode,
    setLlmProvider,
    setOpenAiLoginError,
    setClaudeLoginError,
    AUTH_MODE_KEY,
    LLM_PROVIDER_KEY,
    LLM_PROVIDERS_KEY,
    OPENAI_AUTH_MODE_KEY,
    CHAT_COMMANDS_VISIBLE_KEY,
    TOOL_RESULTS_VISIBLE_KEY,
    NOTIFICATIONS_ENABLED_KEY,
    THEME_MODE_KEY,
    COMPOSER_INPUT_MODE_KEY,
    REPO_HISTORY_KEY,
    DEBUG_MODE_KEY,
  });

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
  const { isMobileLayout } = useLayoutMode({ themeMode, setSideOpen });

  const { applyMessages, mergeAndApplyMessages } = useChatMessagesState({
    normalizeAttachments,
    messageIndex,
    commandIndex,
    messagesRef,
    setMessages,
    setCommandPanelOpen,
    setToolResultPanelOpen,
  });

  const {
    activeWorktreeId,
    activeWorktreeIdRef,
    applyWorktreesList,
    closeWorktree,
    createWorktree,
    handleSelectWorktree,
    loadMainWorktreeSnapshot,
    loadWorktreeSnapshot,
    requestWorktreeMessages,
    requestWorktreesList,
    renameWorktreeHandler,
    setActiveWorktreeId,
    setWorktrees,
    worktrees,
  } = useWorktrees({
    apiFetch,
    attachmentSessionId: attachmentSession?.sessionId,
    availableProviders,
    llmProvider,
    messagesRef,
    normalizeAttachments,
    applyMessages,
    socketRef,
    setPaneByTab,
    setLogFilterByTab,
    showToast,
    t,
  });
  const {
    logFilter,
    setLogFilter,
    scopedRpcLogs,
    formattedRpcLogs,
    filteredRpcLogs,
  } =
    useRpcLogView({
      rpcLogs,
      activeWorktreeId,
      locale,
      logFilterByTab,
      setLogFilterByTab,
    });
  const { ensureNotificationPermission, maybeNotify, lastNotifiedIdRef } =
    useNotifications({
      notificationsEnabled,
      t,
    });
  const loadRepoLastCommitRef = useRef(() => {});
  const loadRepoLastCommitProxy = useCallback(
    (...args) => loadRepoLastCommitRef.current?.(...args),
    []
  );
  const {
    branches,
    branchError,
    branchLoading,
    currentBranch,
    defaultBranch,
    loadBranches,
    loadProviderModels,
    providerModelState,
    selectedModel,
    setModelError,
    setModelLoading,
    setModels,
    setProviderModelState,
    setSelectedModel,
    setSelectedReasoningEffort,
  } = useRepoBranchesModels({
    apiFetch,
    attachmentSessionId: attachmentSession?.sessionId,
    llmProvider,
    loadRepoLastCommit: loadRepoLastCommitProxy,
    processing,
    socketRef,
    t,
  });
  const {
    currentDiff,
    diffFiles,
    diffStatusLines,
    hasCurrentChanges,
    loadRepoLastCommit,
    loadWorktreeLastCommit,
    repoDiff,
    repoLastCommit,
    requestRepoDiff,
    requestWorktreeDiff,
    setRepoDiff,
    setRepoLastCommit,
    setWorktreeLastCommitById,
    worktreeLastCommitById,
  } = useRepoStatus({
    apiFetch,
    attachmentSessionId: attachmentSession?.sessionId,
    currentBranch,
    activeWorktreeId,
    parseDiff,
    setWorktrees,
    worktrees,
    t,
  });
  useEffect(() => {
    loadRepoLastCommitRef.current = loadRepoLastCommit;
  }, [loadRepoLastCommit]);
  const isInWorktree = activeWorktreeId && activeWorktreeId !== "main";
  const activeWorktree = isInWorktree ? worktrees.get(activeWorktreeId) : null;
  const activeProvider = isInWorktree ? activeWorktree?.provider : llmProvider;
  const activeModel = isInWorktree ? activeWorktree?.model : selectedModel;
  const currentMessages =
    isInWorktree && !activeWorktree
      ? []
      : activeWorktree
        ? activeWorktree.messages
        : messages;
  const hasMessages =
    Array.isArray(currentMessages) && currentMessages.length > 0;
  const activePane = paneByTab[activeWorktreeId] || "chat";
  const activeExplorer = explorerByTab[activeWorktreeId] || explorerDefaultState;
  const { handleResumeSession, onRepoSubmit } = useSessionLifecycle({
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
  });
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

  const { resyncSession } = useSessionResync({
    attachmentSessionId: attachmentSession?.sessionId,
    apiFetch,
    llmProvider,
    setLlmProvider,
    setSelectedProviders,
    setOpenAiReady,
    setClaudeReady,
    setRepoDiff,
    setRpcLogsEnabled,
    setRpcLogs,
    setTerminalEnabled,
    loadMainWorktreeSnapshot,
  });

  const { requestMessageSync } = useMessageSync({
    socketRef,
    messagesRef,
  });

  useChatSocket({
    attachmentSessionId: attachmentSession?.sessionId,
    workspaceToken,
    socketRef,
    reconnectTimerRef,
    reconnectAttemptRef,
    closingRef,
    pingIntervalRef,
    lastPongRef,
    messageIndex,
    commandIndex,
    rpcLogsEnabledRef,
    mergeAndApplyMessages,
    requestMessageSync,
    requestWorktreesList,
    requestWorktreeMessages,
    applyWorktreesList,
    resyncSession,
    t,
    setStatus,
    setConnected,
    setAppServerReady,
    setMessages,
    setProcessing,
    setActivity,
    setCurrentTurnId,
    setMainTaskLabel,
    setModelLoading,
    setModelError,
    setModels,
    setProviderModelState,
    setSelectedModel,
    setSelectedReasoningEffort,
    setRepoDiff,
    setRpcLogs,
    setWorktrees,
    setPaneByTab,
    setLogFilterByTab,
    setActiveWorktreeId,
    activeWorktreeIdRef,
    extractVibe80Task,
    extractFirstLine,
    getItemActivityLabel,
    maybeNotify,
    normalizeAttachments,
    loadRepoLastCommit,
    loadBranches,
    loadWorktreeLastCommit,
    openAiLoginRequest,
    setOpenAiLoginRequest,
    connected,
  });

  useTerminalSession({
    activePane,
    activeWorktreeId,
    attachmentSessionId: attachmentSession?.sessionId,
    terminalEnabled,
    terminalContainerRef,
    terminalDisposableRef,
    terminalFitRef,
    terminalRef,
    terminalSessionRef,
    terminalSocketRef,
    terminalWorktreeRef,
    themeMode,
    workspaceToken,
  });


  useEffect(() => {
    if (typeof attachmentSession?.terminalEnabled === "boolean") {
      setTerminalEnabled(attachmentSession.terminalEnabled);
    }
  }, [attachmentSession?.terminalEnabled]);

  useEffect(() => {
    setAppServerReady(false);
  }, [attachmentSession?.sessionId]);


  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    void loadMainWorktreeSnapshot();
    setRepoDiff(attachmentSession.repoDiff || { status: "", diff: "" });
    const logsEnabled =
      typeof attachmentSession.rpcLogsEnabled === "boolean"
        ? attachmentSession.rpcLogsEnabled
        : true;
    setRpcLogsEnabled(logsEnabled);
    setRpcLogs(logsEnabled ? attachmentSession.rpcLogs || [] : []);
    setStatus(t("Connecting..."));
    setConnected(false);
  }, [attachmentSession?.sessionId, loadMainWorktreeSnapshot, messageIndex, t]);

  useEffect(() => {
    if (attachmentSession?.sessionId) {
      const label = attachmentSession?.name || repoName || t("Session");
      document.title = `vibe80 - ${label}`;
    } else {
      document.title = "vibe80";
    }
  }, [attachmentSession?.sessionId, attachmentSession?.name, repoName, t]);

  useEffect(() => {
    if (typeof attachmentSession?.defaultInternetAccess === "boolean") {
      setDefaultInternetAccess(attachmentSession.defaultInternetAccess);
    }
  }, [attachmentSession?.defaultInternetAccess]);

  useEffect(() => {
    if (typeof attachmentSession?.defaultDenyGitCredentialsAccess === "boolean") {
      setDefaultDenyGitCredentialsAccess(
        attachmentSession.defaultDenyGitCredentialsAccess
      );
    }
  }, [attachmentSession?.defaultDenyGitCredentialsAccess]);

  useEffect(() => {
    if (!attachmentSession?.defaultProvider && !attachmentSession?.providers) {
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
    } else if (attachmentSession.defaultProvider) {
      setSelectedProviders([attachmentSession.defaultProvider]);
      setOpenAiReady(attachmentSession.defaultProvider === "codex");
      setClaudeReady(attachmentSession.defaultProvider === "claude");
    }
    // Sync local state with session provider on initial load
    if (
      attachmentSession.defaultProvider &&
      attachmentSession.defaultProvider !== llmProvider
    ) {
      setLlmProvider(attachmentSession.defaultProvider);
    }
  }, [attachmentSession?.defaultProvider, attachmentSession?.providers]);

  useEffect(() => {
    if (!attachmentSession?.repoUrl) {
      return;
    }
    setRepoHistory((current) =>
      mergeRepoHistory(current, attachmentSession.repoUrl)
    );
  }, [attachmentSession?.repoUrl]);

  const { handleProviderSwitch, toggleProviderSelection } =
    useProviderSelection({
      attachmentSessionId: attachmentSession?.sessionId,
      socketRef,
      availableProviders,
      llmProvider,
      providerSwitching,
      processing,
      setProviderSwitching,
      setStatus,
      setSelectedProviders,
      setLlmProvider,
      t,
    });

  const {
    commandMenuOpen,
    setCommandMenuOpen,
    setCommandQuery,
    commandSelection,
    filteredCommands,
    isDraggingAttachments,
    handleInputChange,
    handleComposerKeyDown,
    onSubmit,
    onUploadAttachments,
    onPasteAttachments,
    onDragOverComposer,
    onDragEnterComposer,
    onDragLeaveComposer,
    onDropAttachments,
    removeDraftAttachment,
    triggerAttachmentPicker,
    captureScreenshot,
  } = useChatComposer({
    t,
    input,
    setInput,
    inputRef,
    composerInputMode,
    handleSendMessageRef,
    attachmentSession,
    apiFetch,
    normalizeAttachments,
    setDraftAttachments,
    draftAttachments,
    setAttachmentsLoading,
    setAttachmentsError,
    showToast,
    uploadInputRef,
    attachmentsLoading,
    conversationRef,
    composerRef,
    isMobileLayout,
  });

  const { sendMessage, sendCommitMessage, sendWorktreeMessage } = useChatSend({
    input,
    setInput,
    setMessages,
    setDraftAttachments,
    socketRef,
    connected,
    normalizeAttachments,
    draftAttachments,
    setWorktrees,
    handleSendMessageRef,
    ensureNotificationPermission,
  });

  const mergeTargetBranch = defaultBranch || currentBranch || "main";

  const {
    openCloseConfirm,
    closeCloseConfirm,
    handleConfirmMerge,
    handleConfirmDelete,
  } = useWorktreeCloseConfirm({
    closeConfirm,
    setCloseConfirm,
    setActiveWorktreeId,
    activeWorktreeIdRef,
    closeWorktree,
    sendWorktreeMessage,
    mergeTargetBranch,
    t,
  });


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
  const activeChatKey = activeWorktreeId || "main";
  const {
    showOlderMessagesByTab,
    setShowOlderMessagesByTab,
    showOlderMessages,
    collapsedMessages: chatHistoryWindow,
  } = useChatCollapse({
    activeChatKey,
    displayedGroupedMessages,
    CHAT_COLLAPSE_THRESHOLD,
    CHAT_COLLAPSE_VISIBLE,
  });

  // Check if we're in a real worktree (not "main")
  const activeCommit = isInWorktree
    ? worktreeLastCommitById.get(activeWorktreeId)
    : repoLastCommit;
  const activeBranchLabel = isInWorktree
    ? activeWorktree?.branchName || activeWorktree?.name || ""
    : currentBranch || repoLastCommit?.branch || "";
  const shortSha =
    typeof activeCommit?.sha === "string" ? activeCommit.sha.slice(0, 7) : "";
  const showInternetAccess = isInWorktree
    ? Boolean(activeWorktree?.internetAccess)
    : Boolean(defaultInternetAccess);
  const showGitCredentialsShared = isInWorktree
    ? activeWorktree?.denyGitCredentialsAccess === false
    : defaultDenyGitCredentialsAccess === false;
  const activeProviderLabel = formatProviderLabel(activeProvider, t);
  const activeModelLabel = activeModel || t("Default model");
  const showProviderMeta = Boolean(activeProviderLabel && activeModelLabel);
  const repoTitle = repoName || t("Repository");
  const showChatInfoPanel =
    !isMobileLayout &&
    activePane === "chat" &&
    Boolean(activeBranchLabel && shortSha && activeCommit?.message);

  const isWorktreeProcessing = activeWorktree?.status === "processing";
  const currentProcessing = isInWorktree ? isWorktreeProcessing : processing;
  const currentActivity = isInWorktree ? activeWorktree?.activity || "" : activity;
  const activeTaskLabel = currentProcessing
    ? isInWorktree
      ? activeWorktree?.taskLabel
      : mainTaskLabel
    : "";
  const currentTurnIdForActive = isInWorktree
    ? activeWorktree?.currentTurnId
    : currentTurnId;
  const canInterrupt = currentProcessing && Boolean(currentTurnIdForActive);
  const isCodexReady =
    activeProvider !== "codex"
      ? true
      : isInWorktree
        ? activeWorktree?.status === "ready"
        : appServerReady;

  const { handleViewSelect, handleOpenSettings, handleSettingsBack } =
    usePaneNavigation({
      activePane,
      activeWorktreeId,
      debugMode,
      rpcLogsEnabled,
      terminalEnabled,
      setPaneByTab,
      setToolbarExportOpen,
      lastPaneByTabRef,
    });

  const {
    addToBacklog,
    backlog,
    editBacklogItem,
    launchBacklogItem,
    markBacklogItemDone,
    removeFromBacklog,
    setBacklog,
    setBacklogMessagePage,
    updateBacklogMessages,
  } = useBacklog({
    attachmentSessionId: attachmentSession?.sessionId,
    apiFetch,
    normalizeAttachments,
    sendMessage,
    setInput,
    setMessages,
    setWorktrees,
    setDraftAttachments,
    input,
    draftAttachments,
    inputRef,
    showToast,
    t,
  });

  const { interruptTurn } = useTurnInterrupt({
    activeWorktreeId,
    isInWorktree,
    currentTurnIdForActive,
    socketRef,
    setWorktrees,
    setActivity,
  });

  const { handleLeaveSession } = useSessionReset({
    setAttachmentSession,
    setRepoUrl,
    setRepoInput,
    setRepoAuth,
    setSessionRequested,
    setAttachmentsError,
    setAttachmentsLoading,
    setMessages,
    setRepoDiff,
    setRpcLogs,
    setRpcLogsEnabled,
    setRepoLastCommit,
    setWorktreeLastCommitById,
    setCurrentTurnId,
    setActivity,
  });

  useEffect(() => {
    if (!workspaceToken && attachmentSession?.sessionId) {
      handleLeaveSession();
    }
  }, [workspaceToken, attachmentSession?.sessionId, handleLeaveSession]);

  const { handleDiffSelect } = useDiffNavigation({
    activeWorktreeId,
    handleViewSelect,
    requestWorktreeDiff,
    requestRepoDiff,
  });


  const {
    updateExplorerState,
    openPathInExplorer,
    requestExplorerTree,
    requestExplorerStatus,
    loadExplorerFile,
    openFileInExplorer,
    setActiveExplorerFile,
    closeExplorerFile,
    selectExplorerNode,
    toggleExplorerDir,
    toggleExplorerEditMode,
    updateExplorerDraft,
    saveExplorerFile,
    startExplorerRename,
    cancelExplorerRename,
    updateExplorerRenameDraft,
    submitExplorerRename,
    createExplorerFile,
  } = useExplorerActions({
    attachmentSessionId: attachmentSession?.sessionId,
    apiFetch,
    t,
    setExplorerByTab,
    explorerDefaultState,
    explorerRef,
    activeWorktreeId,
    handleViewSelect,
    showToast,
    requestExplorerTreeRef,
    requestExplorerStatusRef,
    loadExplorerFileRef,
  });
  const { handleSendMessage } = useChatCommands({
    activeProvider,
    activeWorktreeId,
    addToBacklog,
    apiFetch,
    attachmentSessionId: attachmentSession?.sessionId,
    captureScreenshot,
    connected,
    handleSendMessageRef,
    handleViewSelect,
    input,
    isCodexReady,
    isInWorktree,
    openPathInExplorer,
    requestRepoDiff,
    requestWorktreeDiff,
    sendMessage,
    sendWorktreeMessage,
    setCommandMenuOpen,
    setDraftAttachments,
    setInput,
    setMessages,
    setWorktrees,
    socketRef,
    showToast,
    t,
  });

  // ============== End Worktree Functions ==============

  const { handleClearRpcLogs } = useRpcLogActions({
    activeWorktreeId,
    setRpcLogs,
  });

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
    requestExplorerTree(tabId, true);
    requestExplorerStatus(tabId, true);
  }, [
    activePane,
    activeWorktreeId,
    requestExplorerTree,
    requestExplorerStatus,
  ]);

  useEffect(() => {
    if (!attachmentSession?.sessionId || isMobileLayout || activePane !== "chat") {
      return;
    }
    if (isInWorktree && activeWorktreeId) {
      if (!worktreeLastCommitById.has(activeWorktreeId)) {
        void loadWorktreeLastCommit(activeWorktreeId);
      }
      return;
    }
    void loadRepoLastCommit();
  }, [
    attachmentSession?.sessionId,
    isMobileLayout,
    activePane,
    isInWorktree,
    activeWorktreeId,
    worktreeLastCommitById,
    loadWorktreeLastCommit,
    loadRepoLastCommit,
  ]);

  const { handleExportChat } = useChatExport({
    currentMessages,
    attachmentRepoUrl: attachmentSession?.repoUrl,
    repoUrl,
    isInWorktree,
    activeWorktree,
    t,
    normalizeAttachments,
    downloadTextFile,
    formatExportName,
    extractRepoName,
    setToolbarExportOpen,
  });

  const { handleClearChat } = useChatClear({
    activeWorktreeId,
    setToolbarExportOpen,
    setWorktrees,
    lastNotifiedIdRef,
    attachmentSessionId: attachmentSession?.sessionId,
    apiFetch,
    setMessages,
    messageIndex,
    commandIndex,
    setChoiceSelections,
    choicesKey,
    setCommandPanelOpen,
    setToolResultPanelOpen,
    llmProvider,
  });

  const supportsModels = llmProvider === "codex";
  const hasSession = Boolean(attachmentSession?.sessionId);
  const canSwitchProvider = availableProviders.length > 1;
  const nextProvider = canSwitchProvider
    ? availableProviders.find((provider) => provider !== llmProvider) || llmProvider
    : llmProvider;

  if (!attachmentSession?.sessionId) {
    const isRepoProvided = Boolean(repoUrl);
    const isCloning =
      sessionMode === "new" && sessionRequested && isRepoProvided;
    const repoDisplay = getTruncatedText(repoUrl, 72);
    const formDisabled = workspaceBusy || sessionRequested;
    const workspaceProvider = (providerKey) => workspaceProviders[providerKey] || {};
    const showStep1 = workspaceStep === 1;
    const showStep2 = workspaceStep === 2;
    const showStep3 = workspaceStep === 3 && workspaceToken;
    const showStep4 = workspaceStep === 4 && workspaceToken;
    const headerHint = showStep2
      ? t("Configure AI providers for this workspace.")
      : showStep3
        ? t("Workspace created hint")
        : null;
    const infoContent = showStep2
      ? {
          title: t("Configure AI providers"),
          paragraphs: [
            t(
              "Vibe80 can run Codex or Claude Code. To continue, provide your Anthropic and/or OpenAI credentials. If you use pay-as-you-go billing, supply an API key."
            ),
            t(
              "For subscription plans, use auth.json from the Codex CLI login (ChatGPT) or a long-lived token from `claude setup-token` (Claude)."
            ),
          ],
        }
      : showStep3
        ? {
            title: t("Workspace credentials"),
            paragraphs: [
              t(
                "Please keep your workspace credentials (Workspace ID and Workspace Secret) for future access. We do not have a user identification mechanism; your Workspace ID is your only identifier."
              ),
            ],
          }
      : showStep4
        ? {
            title: t("Start a session"),
            paragraphs: [
              t(
                "Vibe80 opens Git-based work sessions. Even in a secure environment, we recommend short-lived and revocable PATs or keys."
              ),
            ],
            securityLink: true,
          }
        : {
            title: t("Configure the workspace"),
            paragraphs: [
              t(
                "A workspace is an isolated, secured environment accessible only with credentials. It lets you reuse AI credentials for all future sessions."
              ),
              t(
                "You can create multiple workspaces to separate teams, projects, or security boundaries."
              ),
            ],
          };
    return (
      <SessionGate
        t={t}
        brandLogo={brandLogo}
        showStep1={showStep1}
        showStep2={showStep2}
        showStep3={showStep3}
        showStep4={showStep4}
        headerHint={headerHint}
        workspaceMode={workspaceMode}
        setWorkspaceMode={setWorkspaceMode}
        formDisabled={formDisabled}
        handleWorkspaceSubmit={handleWorkspaceSubmit}
        workspaceIdInput={workspaceIdInput}
        setWorkspaceIdInput={setWorkspaceIdInput}
        workspaceSecretInput={workspaceSecretInput}
        setWorkspaceSecretInput={setWorkspaceSecretInput}
        workspaceError={workspaceError}
        handleWorkspaceProvidersSubmit={handleWorkspaceProvidersSubmit}
        workspaceProvider={workspaceProvider}
        workspaceAuthExpanded={workspaceAuthExpanded}
        setWorkspaceAuthExpanded={setWorkspaceAuthExpanded}
        setWorkspaceProviders={setWorkspaceProviders}
        providerAuthOptions={providerAuthOptions}
        getProviderAuthType={getProviderAuthType}
        workspaceAuthFiles={workspaceAuthFiles}
        setWorkspaceAuthFiles={setWorkspaceAuthFiles}
        sessionMode={sessionMode}
        setSessionMode={setSessionMode}
        setSessionRequested={setSessionRequested}
        setAttachmentsError={setAttachmentsError}
        loadWorkspaceSessions={loadWorkspaceSessions}
        deploymentMode={deploymentMode}
        handleLeaveWorkspace={handleLeaveWorkspace}
        workspaceSessionsLoading={workspaceSessionsLoading}
        workspaceSessions={workspaceSessions}
        workspaceSessionsError={workspaceSessionsError}
        workspaceSessionDeletingId={workspaceSessionDeletingId}
        handleResumeSession={handleResumeSession}
        handleDeleteSession={handleDeleteSession}
        locale={locale}
        extractRepoName={extractRepoName}
        getTruncatedText={getTruncatedText}
        isCloning={isCloning}
        repoDisplay={repoDisplay}
        onRepoSubmit={onRepoSubmit}
        sessionNameInput={sessionNameInput}
        setSessionNameInput={setSessionNameInput}
        repoInput={repoInput}
        setRepoInput={setRepoInput}
        repoHistory={repoHistory}
        authMode={authMode}
        setAuthMode={setAuthMode}
        sshKeyInput={sshKeyInput}
        setSshKeyInput={setSshKeyInput}
        httpUsername={httpUsername}
        setHttpUsername={setHttpUsername}
        httpPassword={httpPassword}
        setHttpPassword={setHttpPassword}
        defaultInternetAccess={defaultInternetAccess}
        setDefaultInternetAccess={setDefaultInternetAccess}
        defaultDenyGitCredentialsAccess={defaultDenyGitCredentialsAccess}
        setDefaultDenyGitCredentialsAccess={setDefaultDenyGitCredentialsAccess}
        attachmentsError={attachmentsError}
        sessionRequested={sessionRequested}
        workspaceBusy={workspaceBusy}
        workspaceProvidersEditing={workspaceProvidersEditing}
        providersBackStep={providersBackStep}
        setWorkspaceStep={setWorkspaceStep}
        setWorkspaceProvidersEditing={setWorkspaceProvidersEditing}
        setWorkspaceError={setWorkspaceError}
        setProvidersBackStep={setProvidersBackStep}
        loadWorkspaceProviders={loadWorkspaceProviders}
        workspaceCreated={workspaceCreated}
        workspaceId={workspaceId}
        workspaceCopied={workspaceCopied}
        handleWorkspaceCopy={handleWorkspaceCopy}
        infoContent={infoContent}
        toast={toast}
      />
    );
  }
  const renderExplorerNodes = (
    nodes,
    tabId,
    expandedSet,
    selectedPath,
    selectedType,
    renamingPath,
    renameDraft,
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
            const isSelected = selectedPath === node.path && selectedType === "dir";
            const isRenaming = renamingPath === node.path;
            const statusType = dirStatus?.[node.path] || "";
            return (
              <li
                key={node.path}
                className={`explorer-tree-item is-dir ${
                  isSelected ? "is-selected" : ""
                } ${
                  statusType ? `is-${statusType}` : ""
                }`}
              >
                <div className="explorer-tree-entry">
                  <button
                    type="button"
                    className="explorer-tree-caret-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleExplorerDir(tabId, node.path);
                    }}
                  >
                    <span className="explorer-tree-caret" aria-hidden="true">
                      <FontAwesomeIcon
                        icon={isExpanded ? faChevronDown : faChevronRight}
                      />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="explorer-tree-toggle"
                    onClick={() => selectExplorerNode(tabId, node.path, "dir")}
                  >
                    {isRenaming ? (
                      <input
                        className="explorer-tree-rename-input"
                        value={renameDraft || ""}
                        autoFocus
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          updateExplorerRenameDraft(tabId, event.target.value)
                        }
                        onBlur={() => {
                          void submitExplorerRename(tabId);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void submitExplorerRename(tabId);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelExplorerRename(tabId);
                          }
                        }}
                      />
                    ) : (
                      <span className="explorer-tree-name">{node.name}</span>
                    )}
                  </button>
                </div>
                {isExpanded
                  ? renderExplorerNodes(
                      node.children || [],
                      tabId,
                      expandedSet,
                      selectedPath,
                      selectedType,
                      renamingPath,
                      renameDraft,
                      statusByPath,
                      dirStatus
                    )
                  : null}
              </li>
            );
          }
          const isSelected = selectedPath === node.path && selectedType === "file";
          const isRenaming = renamingPath === node.path;
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
                onClick={() => {
                  selectExplorerNode(tabId, node.path, "file");
                  loadExplorerFileRef.current?.(tabId, node.path);
                }}
              >
                <span className="explorer-tree-icon" aria-hidden="true">
                  <FontAwesomeIcon icon={faFileLines} />
                </span>
                {isRenaming ? (
                  <input
                    className="explorer-tree-rename-input"
                    value={renameDraft || ""}
                    autoFocus
                    onClick={(event) => event.stopPropagation()}
                    onChange={(event) =>
                      updateExplorerRenameDraft(tabId, event.target.value)
                    }
                    onBlur={() => {
                      void submitExplorerRename(tabId);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void submitExplorerRename(tabId);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelExplorerRename(tabId);
                      }
                    }}
                  />
                ) : (
                  <span className="explorer-tree-name">{node.name}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="app">
      <Topbar
        t={t}
        brandLogo={brandLogo}
        allTabs={allTabs}
        activeWorktreeId={activeWorktreeId}
        handleSelectWorktree={handleSelectWorktree}
        createWorktree={createWorktree}
        openCloseConfirm={openCloseConfirm}
        renameWorktreeHandler={renameWorktreeHandler}
        llmProvider={llmProvider}
        availableProviders={availableProviders}
        branches={branches}
        defaultBranch={defaultBranch}
        currentBranch={currentBranch}
        branchLoading={branchLoading}
        branchError={branchError}
        defaultInternetAccess={defaultInternetAccess}
        defaultDenyGitCredentialsAccess={defaultDenyGitCredentialsAccess}
        loadBranches={loadBranches}
        providerModelState={providerModelState}
        loadProviderModels={loadProviderModels}
        connected={connected}
        isMobileLayout={isMobileLayout}
        requestHandoffQr={requestHandoffQr}
        attachmentSession={attachmentSession}
        handoffLoading={handoffLoading}
        handleOpenSettings={handleOpenSettings}
        handleLeaveSession={handleLeaveSession}
      />

      <div
        className={`layout ${sideOpen ? "is-side-open" : "is-side-collapsed"} ${
          isMobileLayout ? "is-mobile" : ""
        }`}
      >
        {isMobileLayout && sideOpen ? (
          <button
            type="button"
            className="side-backdrop"
            aria-label={t("Close panel")}
            onClick={() => setSideOpen(false)}
          />
        ) : null}

        <aside className="side">
          <div className="side-body">
            <section className="backlog">
              <div className="panel-header">
                <div className="panel-title">{t("Backlog")}</div>
                <div className="panel-subtitle">
                  {backlog.length === 0
                    ? t("No tasks")
                    : t("{{count}} item(s)", { count: backlog.length })}
              </div>
            </div>
              {backlog.length === 0 ? (
                <div className="backlog-empty">
                  {t("No pending tasks at the moment.")}
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
                          {t("Edit")}
                        </button>
                        <button
                          type="button"
                          onClick={() => launchBacklogItem(item)}
                          disabled={!connected}
                        >
                          {t("Launch")}
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => removeFromBacklog(item.id)}
                        >
                          {t("Delete")}
                        </button>
                      </div>
                      {item.attachments?.length ? (
                        <div className="backlog-meta">
                          {t("{{count}} attachment(s)", {
                            count: item.attachments.length,
                          })}
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
              {t("Settings")}
            </button>
          </div>
        </aside>

        <section className="conversation is-chat-narrow" ref={conversationRef}>
          <div className="pane-stack">
            <ChatToolbar
              t={t}
              activePane={activePane}
              handleViewSelect={handleViewSelect}
              handleDiffSelect={handleDiffSelect}
              debugMode={debugMode}
              rpcLogsEnabled={rpcLogsEnabled}
              terminalEnabled={terminalEnabled}
              toolbarExportOpen={toolbarExportOpen}
              setToolbarExportOpen={setToolbarExportOpen}
              toolbarExportRef={toolbarExportRef}
              handleExportChat={handleExportChat}
              hasMessages={hasMessages}
              handleClearChat={handleClearChat}
            />
            <ChatMessages
              t={t}
              activePane={activePane}
              listRef={listRef}
              showChatInfoPanel={showChatInfoPanel}
              repoTitle={repoTitle}
              activeBranchLabel={activeBranchLabel}
              shortSha={shortSha}
              activeCommit={activeCommit}
              showProviderMeta={showProviderMeta}
              activeProviderLabel={activeProviderLabel}
              activeModelLabel={activeModelLabel}
              showInternetAccess={showInternetAccess}
              showGitCredentialsShared={showGitCredentialsShared}
              activeTaskLabel={activeTaskLabel}
              currentMessages={currentMessages}
              chatHistoryWindow={chatHistoryWindow}
              activeChatKey={activeChatKey}
              setShowOlderMessagesByTab={setShowOlderMessagesByTab}
              showChatCommands={showChatCommands}
              showToolResults={showToolResults}
              commandPanelOpen={commandPanelOpen}
              setCommandPanelOpen={setCommandPanelOpen}
              toolResultPanelOpen={toolResultPanelOpen}
              setToolResultPanelOpen={setToolResultPanelOpen}
              renderMessageAttachments={renderMessageAttachments}
              currentProcessing={currentProcessing}
              currentActivity={currentActivity}
              extractVibe80Blocks={extractVibe80Blocks}
              handleChoiceClick={handleChoiceClick}
              choiceSelections={choiceSelections}
              openVibe80Form={openVibe80Form}
              copyTextToClipboard={copyTextToClipboard}
              openFileInExplorer={openFileInExplorer}
              setInput={setInput}
              inputRef={inputRef}
              markBacklogItemDone={markBacklogItemDone}
              setBacklogMessagePage={setBacklogMessagePage}
              activeWorktreeId={activeWorktreeId}
              BACKLOG_PAGE_SIZE={BACKLOG_PAGE_SIZE}
              MAX_USER_DISPLAY_LENGTH={MAX_USER_DISPLAY_LENGTH}
              getTruncatedText={getTruncatedText}
            />
            <Suspense fallback={null}>
              <DiffPanel
                t={t}
                activePane={activePane}
                isInWorktree={isInWorktree}
                diffStatusLines={diffStatusLines}
                connected={connected}
                currentProcessing={currentProcessing}
                hasCurrentChanges={hasCurrentChanges}
                sendCommitMessage={sendCommitMessage}
                diffFiles={diffFiles}
                currentDiff={currentDiff}
              />
            </Suspense>
            <Suspense fallback={null}>
              <ExplorerPanel
                t={t}
                activePane={activePane}
                repoName={repoName}
                activeWorktree={activeWorktree}
                isInWorktree={isInWorktree}
                activeWorktreeId={activeWorktreeId}
                attachmentSession={attachmentSession}
                requestExplorerTree={requestExplorerTree}
                requestExplorerStatus={requestExplorerStatus}
                activeExplorer={activeExplorer}
                renderExplorerNodes={renderExplorerNodes}
                explorerStatusByPath={explorerStatusByPath}
                explorerDirStatus={explorerDirStatus}
                saveExplorerFile={saveExplorerFile}
                updateExplorerDraft={updateExplorerDraft}
                setActiveExplorerFile={setActiveExplorerFile}
                closeExplorerFile={closeExplorerFile}
                startExplorerRename={startExplorerRename}
                createExplorerFile={createExplorerFile}
                getLanguageForPath={getLanguageForPath}
                themeMode={themeMode}
              />
            </Suspense>
            <Suspense fallback={null}>
              <TerminalPanel
                t={t}
                terminalEnabled={terminalEnabled}
                activePane={activePane}
                repoName={repoName}
                activeWorktree={activeWorktree}
                isInWorktree={isInWorktree}
                terminalContainerRef={terminalContainerRef}
                attachmentSession={attachmentSession}
              />
            </Suspense>
            <Suspense fallback={null}>
              <LogsPanel
                t={t}
                activePane={activePane}
                filteredRpcLogs={filteredRpcLogs}
                logFilter={logFilter}
                setLogFilter={setLogFilter}
                scopedRpcLogs={scopedRpcLogs}
                handleClearRpcLogs={handleClearRpcLogs}
              />
            </Suspense>
            <Suspense fallback={null}>
              <SettingsPanel
                t={t}
                activePane={activePane}
                handleSettingsBack={handleSettingsBack}
                language={language}
                setLanguage={setLanguage}
                showChatCommands={showChatCommands}
                setShowChatCommands={setShowChatCommands}
                showToolResults={showToolResults}
                setShowToolResults={setShowToolResults}
                notificationsEnabled={notificationsEnabled}
                setNotificationsEnabled={setNotificationsEnabled}
                themeMode={themeMode}
                setThemeMode={setThemeMode}
                composerInputMode={composerInputMode}
                setComposerInputMode={setComposerInputMode}
                debugMode={debugMode}
                setDebugMode={setDebugMode}
                gitIdentityName={gitIdentityName}
                setGitIdentityName={setGitIdentityName}
                gitIdentityEmail={gitIdentityEmail}
                setGitIdentityEmail={setGitIdentityEmail}
                gitIdentityGlobal={gitIdentityGlobal}
                gitIdentityRepo={gitIdentityRepo}
                gitIdentityLoading={gitIdentityLoading}
                gitIdentitySaving={gitIdentitySaving}
                gitIdentityError={gitIdentityError}
                gitIdentityMessage={gitIdentityMessage}
                handleSaveGitIdentity={handleSaveGitIdentity}
                attachmentSession={attachmentSession}
              />
            </Suspense>
          </div>
          <ChatComposer
            t={t}
            activePane={activePane}
            isDraggingAttachments={isDraggingAttachments}
            onSubmit={onSubmit}
            onDragEnterComposer={onDragEnterComposer}
            onDragOverComposer={onDragOverComposer}
            onDragLeaveComposer={onDragLeaveComposer}
            onDropAttachments={onDropAttachments}
            composerRef={composerRef}
            draftAttachments={draftAttachments}
            getAttachmentExtension={getAttachmentExtension}
            formatAttachmentSize={formatAttachmentSize}
            removeDraftAttachment={removeDraftAttachment}
            commandMenuOpen={commandMenuOpen}
            filteredCommands={filteredCommands}
            setInput={setInput}
            setCommandMenuOpen={setCommandMenuOpen}
            setCommandQuery={setCommandQuery}
            inputRef={inputRef}
            commandSelection={commandSelection}
            triggerAttachmentPicker={triggerAttachmentPicker}
            attachmentSession={attachmentSession}
            attachmentsLoading={attachmentsLoading}
            isMobileLayout={isMobileLayout}
            uploadInputRef={uploadInputRef}
            onUploadAttachments={onUploadAttachments}
            input={input}
            handleInputChange={handleInputChange}
            handleComposerKeyDown={handleComposerKeyDown}
            onPasteAttachments={onPasteAttachments}
            composerInputMode={composerInputMode}
            canInterrupt={canInterrupt}
            interruptTurn={interruptTurn}
            connected={connected}
            isCodexReady={isCodexReady}
            attachmentsError={attachmentsError}
          />
        </section>
      </div>
      {activeForm ? (
        <div
          className="vibe80-form-overlay"
          role="dialog"
          aria-modal="true"
          onClick={closeVibe80Form}
        >
          <div
            className="vibe80-form-dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="vibe80-form-header">
              <div className="vibe80-form-title">
                {activeForm.question || t("Form")}
              </div>
              <button
                type="button"
                className="vibe80-form-close"
                aria-label={t("Close")}
                onClick={closeVibe80Form}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <form className="vibe80-form-body" onSubmit={submitActiveForm}>
              {activeForm.fields.map((field) => {
                const fieldId = `vibe80-${activeForm.key}-${field.id}`;
                const value = activeFormValues[field.id] ?? "";
                if (field.type === "checkbox") {
                  return (
                    <div className="vibe80-form-field" key={field.id}>
                      <label className="vibe80-form-checkbox">
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
                    <div className="vibe80-form-field" key={field.id}>
                      <label className="vibe80-form-label" htmlFor={fieldId}>
                        {field.label}
                      </label>
                      <textarea
                        id={fieldId}
                        className="vibe80-form-input"
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
                    <div className="vibe80-form-field" key={field.id}>
                      <div className="vibe80-form-label">{field.label}</div>
                      <div className="vibe80-form-options">
                        {(field.choices || []).length ? (
                          field.choices.map((choice) => (
                            <label
                              key={`${field.id}-${choice}`}
                              className="vibe80-form-option"
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
                          <div className="vibe80-form-empty">
                            {t("No options.")}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                }
                if (field.type === "select") {
                  return (
                    <div className="vibe80-form-field" key={field.id}>
                      <label className="vibe80-form-label" htmlFor={fieldId}>
                        {field.label}
                      </label>
                      <select
                        id={fieldId}
                        className="vibe80-form-input vibe80-form-select"
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
                          <option value="">{t("No options")}</option>
                        )}
                      </select>
                    </div>
                  );
                }
                return (
                  <div className="vibe80-form-field" key={field.id}>
                    <label className="vibe80-form-label" htmlFor={fieldId}>
                      {field.label}
                    </label>
                    <input
                      id={fieldId}
                      className="vibe80-form-input"
                      type="text"
                      value={value}
                      onChange={(event) =>
                        updateActiveFormValue(field.id, event.target.value)
                      }
                    />
                  </div>
                );
              })}
              <div className="vibe80-form-actions">
                <button
                  type="button"
                  className="vibe80-form-cancel"
                  onClick={closeVibe80Form}
                >
                  {t("Cancel")}
                </button>
                <button
                  type="submit"
                  className="vibe80-form-submit"
                  disabled={currentProcessing}
                >
                  {t("Send")}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {handoffOpen ? (
        <div
          className="handoff-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={closeHandoffQr}
        >
          <div
            className="handoff-modal"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="handoff-modal-header">
              <div className="handoff-modal-title">{t("Continue on mobile")}</div>
              <button
                type="button"
                className="handoff-modal-close"
                aria-label={t("Close")}
                onClick={closeHandoffQr}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="handoff-modal-body">
              <p className="handoff-modal-text">
                {t(
                  "Scan this QR code in the Android app to resume the current session."
                )}
              </p>
              {handoffError ? (
                <div className="handoff-modal-error">{handoffError}</div>
              ) : null}
              {handoffQrDataUrl ? (
                <div className="handoff-modal-qr">
                  <img src={handoffQrDataUrl} alt={t("QR code")} />
                </div>
              ) : (
                <div className="handoff-modal-placeholder">
                  {handoffLoading
                    ? t("Generating QR code...")
                    : t("QR code unavailable.")}
                </div>
              )}
              {typeof handoffRemaining === "number" ? (
                <div className="handoff-modal-meta">
                  {handoffRemaining > 0
                    ? t("Expires in {{seconds}}s", {
                        seconds: handoffRemaining,
                      })
                    : t("QR code expired")}
                </div>
              ) : null}
              <div className="handoff-modal-actions">
                <button
                  type="button"
                  className="session-button"
                  onClick={requestHandoffQr}
                  disabled={handoffLoading}
                >
                  {t("Regenerate")}
                </button>
              </div>
            </div>
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
                {t("Close the worktree?")}
              </div>
              <button
                type="button"
                className="worktree-close-confirm-close"
                aria-label={t("Close")}
                onClick={closeCloseConfirm}
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="worktree-close-confirm-body">
              {t("All changes will be lost. What would you like to do?")}
            </div>
            <div className="worktree-close-confirm-actions">
              <button
                type="button"
                className="worktree-close-confirm-cancel"
                onClick={closeCloseConfirm}
              >
                {t("Cancel")}
              </button>
              <button
                type="button"
                className="worktree-close-confirm-merge"
                onClick={handleConfirmMerge}
              >
                {t("Merge into {{branch}}", { branch: mergeTargetBranch })}
              </button>
              <button
                type="button"
                className="worktree-close-confirm-delete"
                onClick={handleConfirmDelete}
              >
                {t("Delete worktree")}
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
            aria-label={t("Close")}
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
              alt={attachmentPreview.name || t("Preview")}
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
