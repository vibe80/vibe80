import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import useAttachments from "./hooks/useAttachments.js";
import ExplorerPanel from "./components/Explorer/ExplorerPanel.jsx";
import DiffPanel from "./components/Diff/DiffPanel.jsx";
import Topbar from "./components/Topbar/Topbar.jsx";
import TerminalPanel from "./components/Terminal/TerminalPanel.jsx";
import SessionGate from "./components/SessionGate/SessionGate.jsx";
import SettingsPanel from "./components/Settings/SettingsPanel.jsx";
import LogsPanel from "./components/Logs/LogsPanel.jsx";
import QRCode from "qrcode";
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
  const [defaultDenyGitCredentialsAccess, setDefaultDenyGitCredentialsAccess] = useState(true);
  const [toast, setToast] = useState(null);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffQrDataUrl, setHandoffQrDataUrl] = useState("");
  const [handoffExpiresAt, setHandoffExpiresAt] = useState(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  const [handoffRemaining, setHandoffRemaining] = useState(null);
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
  const [showOlderMessagesByTab, setShowOlderMessagesByTab] = useState({});
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
  const [closeConfirm, setCloseConfirm] = useState(null);
  const [terminalEnabled, setTerminalEnabled] = useState(true);
  const explorerRef = useRef({});
  // Worktree states for parallel LLM requests
  const [mainTaskLabel, setMainTaskLabel] = useState("");
  const lastPaneByTabRef = useRef(new Map());
  const [isMobileLayout, setIsMobileLayout] = useState(() =>
    window.matchMedia("(max-width: 1024px)").matches
  );
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

  const buildHandoffPayload = (token, expiresAt) =>
    JSON.stringify({
      type: "vibe80_handoff",
      handoffToken: token,
      baseUrl: window.location.origin,
      expiresAt,
    });

  const requestHandoffQr = useCallback(async () => {
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    setHandoffLoading(true);
    setHandoffError("");
    try {
      const response = await apiFetch("/api/sessions/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          payload?.error || t("Unable to generate the QR code.")
        );
      }
      const data = await response.json();
      const token = data?.handoffToken;
      if (!token) {
        throw new Error(t("Invalid resume token."));
      }
      const expiresAt = data?.expiresAt ?? null;
      const payload = buildHandoffPayload(token, expiresAt);
      const qrDataUrl = await QRCode.toDataURL(payload, {
        width: 260,
        margin: 1,
      });
      setHandoffQrDataUrl(qrDataUrl);
      setHandoffExpiresAt(expiresAt);
      setHandoffOpen(true);
    } catch (error) {
      setHandoffError(error?.message || t("Error during generation."));
    } finally {
      setHandoffLoading(false);
    }
  }, [attachmentSession?.sessionId, apiFetch, t]);

  const closeHandoffQr = useCallback(() => {
    setHandoffOpen(false);
    setHandoffError("");
    setHandoffQrDataUrl("");
    setHandoffExpiresAt(null);
    setHandoffRemaining(null);
  }, []);

  useEffect(() => {
    if (!handoffOpen || !handoffExpiresAt) {
      setHandoffRemaining(null);
      return;
    }
    const expiresAtMs =
      typeof handoffExpiresAt === "number"
        ? handoffExpiresAt
        : new Date(handoffExpiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      setHandoffRemaining(null);
      return;
    }
    const tick = () => {
      const remainingMs = expiresAtMs - Date.now();
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setHandoffRemaining(remainingSeconds);
    };
    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [handoffOpen, handoffExpiresAt]);


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
        throw new Error(t("Unable to load Git identity."));
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
      setGitIdentityError(error?.message || t("Error during loading."));
    } finally {
      setGitIdentityLoading(false);
    }
  }, [attachmentSession?.sessionId, apiFetch, t]);

  const handleSaveGitIdentity = useCallback(async () => {
    const sessionId = attachmentSession?.sessionId;
    if (!sessionId) {
      return;
    }
    const name = gitIdentityName.trim();
    const email = gitIdentityEmail.trim();
    if (!name || !email) {
      setGitIdentityError(t("Name and email required."));
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
        throw new Error(payload?.error || t("Update failed."));
      }
      const payload = await response.json().catch(() => ({}));
      const repoName = payload?.repo?.name || name;
      const repoEmail = payload?.repo?.email || email;
      setGitIdentityRepo({ name: repoName, email: repoEmail });
      setGitIdentityMessage(t("Repository Git identity updated."));
    } catch (error) {
      setGitIdentityError(error?.message || t("Update failed."));
    } finally {
      setGitIdentitySaving(false);
    }
  }, [attachmentSession?.sessionId, apiFetch, gitIdentityEmail, gitIdentityName, t]);

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
          ? new Date(entry.timestamp).toLocaleTimeString(locale)
          : "",
      })),
    [scopedRpcLogs, locale]
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
        throw new Error(payload.error || t("Unable to load branches."));
      }
      setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      setCurrentBranch(payload.current || "");
      if (!initialBranchRef.current && payload.current) {
        initialBranchRef.current = payload.current;
        setDefaultBranch(payload.current);
      }
    } catch (error) {
      setBranchError(error.message || t("Unable to load branches."));
    } finally {
      setBranchLoading(false);
    }
  }, [attachmentSession?.sessionId, apiFetch, t]);

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
          throw new Error(payload.error || t("Unable to load models."));
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
            error: error.message || t("Unable to load models."),
          },
        }));
      }
    },
    [attachmentSession?.sessionId, apiFetch, t]
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
  const activePane = paneByTab[activeWorktreeId] || "chat";
  const activeExplorer = explorerByTab[activeWorktreeId] || explorerDefaultState;
  const { ensureNotificationPermission, maybeNotify } = useNotifications({
    notificationsEnabled,
    t,
  });
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
      void loadMainWorktreeSnapshot();
    } catch (error) {
      // Ignore resync failures; reconnect loop will retry.
    }
  }, [
    attachmentSession?.sessionId,
    llmProvider,
    apiFetch,
    loadMainWorktreeSnapshot,
  ]);

  const requestMessageSync = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const lastSeenMessageId = (() => {
      if (!Array.isArray(messagesRef.current)) {
        return null;
      }
      for (let i = messagesRef.current.length - 1; i >= 0; i -= 1) {
        if (messagesRef.current[i]?.id) {
          return messagesRef.current[i].id;
        }
      }
      return null;
    })();
    socket.send(
      JSON.stringify({
        type: "sync_worktree_messages",
        worktreeId: "main",
        lastSeenMessageId,
      })
    );
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
        if (response.status === 401) {
          handleLeaveWorkspace();
          return;
        }
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
  }, [workspaceToken, attachmentSession?.sessionId, apiFetch, handleLeaveWorkspace]);

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
  ]);

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

  const handleResumeSession = async (sessionId) => {
    if (!sessionId) {
      return;
    }
    try {
      setSessionRequested(true);
      setAttachmentsError("");
      const response = await apiFetch(
        `/api/session/${encodeURIComponent(sessionId)}`
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
  };

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
      setStatus(t("Switching to {{provider}}...", { provider: newProvider }));
      socketRef.current.send(
        JSON.stringify({ type: "switch_provider", provider: newProvider })
      );
    },
    [llmProvider, providerSwitching, processing, availableProviders, t]
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
        throw new Error(payload.error || t("Unable to change branch."));
      }
      setBranches(Array.isArray(payload.branches) ? payload.branches : []);
      setCurrentBranch(payload.current || "");
      await loadRepoLastCommit();
      setBranchMenuOpen(false);
    } catch (error) {
      setBranchError(error.message || t("Unable to change branch."));
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

  const updateBacklogMessages = useCallback((updateFn) => {
    setMessages((current) =>
      current.map((message) => {
        if (message?.type !== "backlog_view") {
          return message;
        }
        const items = Array.isArray(message.backlog?.items)
          ? message.backlog.items
          : [];
        const updatedItems = updateFn(items);
        if (updatedItems === items) {
          return message;
        }
        return {
          ...message,
          backlog: {
            ...(message.backlog || {}),
            items: updatedItems,
          },
        };
      })
    );
    setWorktrees((current) => {
      const next = new Map(current);
      next.forEach((wt, id) => {
        if (!Array.isArray(wt?.messages)) {
          return;
        }
        let changed = false;
        const updatedMessages = wt.messages.map((message) => {
          if (message?.type !== "backlog_view") {
            return message;
          }
          const items = Array.isArray(message.backlog?.items)
            ? message.backlog.items
            : [];
          const updatedItems = updateFn(items);
          if (updatedItems === items) {
            return message;
          }
          changed = true;
          return {
            ...message,
            backlog: {
              ...(message.backlog || {}),
              items: updatedItems,
            },
          };
        });
        if (changed) {
          next.set(id, { ...wt, messages: updatedMessages });
        }
      });
      return next;
    });
  }, []);

  const setBacklogMessagePage = useCallback((targetWorktreeId, messageId, page) => {
    if (targetWorktreeId && targetWorktreeId !== "main") {
      setWorktrees((current) => {
        const next = new Map(current);
        const wt = next.get(targetWorktreeId);
        if (!wt) {
          return current;
        }
        const updatedMessages = wt.messages.map((message) =>
          message?.id === messageId && message.type === "backlog_view"
            ? {
                ...message,
                backlog: {
                  ...(message.backlog || {}),
                  page,
                },
              }
            : message
        );
        next.set(targetWorktreeId, { ...wt, messages: updatedMessages });
        return next;
      });
      return;
    }
    setMessages((current) =>
      current.map((message) =>
        message?.id === messageId && message.type === "backlog_view"
          ? {
              ...message,
              backlog: {
                ...(message.backlog || {}),
                page,
              },
            }
          : message
      )
    );
  }, []);

  const markBacklogItemDone = useCallback(
    async (itemId) => {
      const sessionId = attachmentSession?.sessionId;
      if (!sessionId) {
        showToast(t("Session not found."), "error");
        return;
      }
      try {
        const response = await apiFetch(
          `/api/session/${encodeURIComponent(sessionId)}/backlog`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: itemId, done: true }),
          }
        );
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error || t("Unable to update backlog."));
        }
        const payload = await response.json().catch(() => ({}));
        const updatedItem = payload?.item;
        updateBacklogMessages((items) =>
          items.map((item) =>
            item?.id === itemId
              ? { ...item, ...updatedItem, done: true }
              : item
          )
        );
      } catch (error) {
        showToast(error.message || t("Unable to update backlog."), "error");
      }
    },
    [apiFetch, attachmentSession?.sessionId, showToast, t, updateBacklogMessages]
  );

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
    if (!handleSendMessageRef.current) {
      return;
    }
    handleSendMessageRef.current(text, []);
  };

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
      t("Merge into {{branch}}", { branch: mergeTargetBranch }),
      []
    );
    setCloseConfirm(null);
  }, [closeConfirm, mergeTargetBranch, sendWorktreeMessage, t]);

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


  // Check if we're in a real worktree (not "main")
  const isInWorktree = activeWorktreeId && activeWorktreeId !== "main";
  const activeWorktree = isInWorktree ? worktrees.get(activeWorktreeId) : null;
  const activeCommit = isInWorktree
    ? worktreeLastCommitById.get(activeWorktreeId)
    : repoLastCommit;
  const activeBranchLabel = isInWorktree
    ? activeWorktree?.branchName || activeWorktree?.name || ""
    : currentBranch || repoLastCommit?.branch || "";
  const shortSha =
    typeof activeCommit?.sha === "string" ? activeCommit.sha.slice(0, 7) : "";
  const activeTaskLabel = isInWorktree
    ? activeWorktree?.taskLabel
    : mainTaskLabel;
  const showInternetAccess = isInWorktree
    ? Boolean(activeWorktree?.internetAccess)
    : Boolean(defaultInternetAccess);
  const showGitCredentialsShared = isInWorktree
    ? activeWorktree?.denyGitCredentialsAccess === false
    : defaultDenyGitCredentialsAccess === false;
  const activeProvider = isInWorktree ? activeWorktree?.provider : llmProvider;
  const activeModel = isInWorktree ? activeWorktree?.model : selectedModel;
  const activeProviderLabel = formatProviderLabel(activeProvider, t);
  const activeModelLabel = activeModel || t("Default model");
  const showProviderMeta = Boolean(activeProviderLabel && activeModelLabel);
  const repoTitle = repoName || t("Repository");
  const showChatInfoPanel =
    !isMobileLayout &&
    activePane === "chat" &&
    Boolean(activeBranchLabel && shortSha && activeCommit?.message);

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
  const activeChatKey = activeWorktreeId || "main";
  const showOlderMessages = Boolean(showOlderMessagesByTab[activeChatKey]);
  const chatHistoryWindow = useMemo(() => {
    const total = displayedGroupedMessages.length;
    const shouldCollapse = !showOlderMessages && total > CHAT_COLLAPSE_THRESHOLD;
    if (!shouldCollapse) {
      return {
        visibleMessages: displayedGroupedMessages,
        hiddenCount: 0,
        isCollapsed: false,
      };
    }
    const visibleMessages = displayedGroupedMessages.slice(
      Math.max(0, total - CHAT_COLLAPSE_VISIBLE)
    );
    return {
      visibleMessages,
      hiddenCount: Math.max(0, total - visibleMessages.length),
      isCollapsed: true,
    };
  }, [displayedGroupedMessages, showOlderMessages]);

  const isWorktreeProcessing = activeWorktree?.status === "processing";
  const currentProcessing = isInWorktree ? isWorktreeProcessing : processing;
  const currentActivity = isInWorktree ? activeWorktree?.activity || "" : activity;
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

  const openVibe80Form = useCallback((block, blockKey) => {
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

  const closeVibe80Form = useCallback(() => {
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
      handleSendMessageRef.current?.(text, []);
      setInput(preservedInput);
      setDraftAttachments(preservedAttachments);
    },
    [input, draftAttachments]
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
      closeVibe80Form();
    },
    [activeForm, activeFormValues, sendFormMessage, closeVibe80Form]
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
    setRepoLastCommit(null);
    setWorktreeLastCommitById(new Map());
    setCurrentTurnId(null);
    setActivity("");
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    window.history.replaceState({}, "", url);
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

  const findExplorerNode = useCallback((nodes, targetPath) => {
    if (!Array.isArray(nodes)) {
      return null;
    }
    for (const node of nodes) {
      if (node?.path === targetPath) {
        return node;
      }
      if (node?.type === "dir" && Array.isArray(node.children)) {
        const match = findExplorerNode(node.children, targetPath);
        if (match) {
          return match;
        }
      }
    }
    return null;
  }, []);

  const updateExplorerTreeNodes = useCallback((nodes, targetPath, children) => {
    if (!Array.isArray(nodes)) {
      return nodes;
    }
    let changed = false;
    const next = nodes.map((node) => {
      if (!node) {
        return node;
      }
      if (node.path === targetPath) {
        changed = true;
        return {
          ...node,
          children,
        };
      }
      if (node.type === "dir" && node.children != null) {
        const updatedChildren = updateExplorerTreeNodes(
          node.children,
          targetPath,
          children
        );
        if (updatedChildren !== node.children) {
          changed = true;
          return {
            ...node,
            children: updatedChildren,
          };
        }
      }
      return node;
    });
    return changed ? next : nodes;
  }, []);

  const setExplorerNodeChildren = useCallback(
    (tabId, targetPath, children) => {
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const tree = Array.isArray(prev.tree) ? prev.tree : [];
        const nextTree = updateExplorerTreeNodes(tree, targetPath, children);
        if (nextTree === tree) {
          return current;
        }
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            tree: nextTree,
          },
        };
      });
    },
    [explorerDefaultState, updateExplorerTreeNodes]
  );

  const fetchExplorerChildren = useCallback(
    async (tabId, dirPath) => {
      const sessionId = attachmentSession?.sessionId;
      if (!sessionId || !tabId) {
        return [];
      }
      const pathParam = dirPath ? `&path=${encodeURIComponent(dirPath)}` : "";
      const response = await apiFetch(
        `/api/worktree/${encodeURIComponent(
          tabId
        )}/browse?session=${encodeURIComponent(sessionId)}${pathParam}`
      );
      if (!response.ok) {
        throw new Error("Failed to load directory");
      }
      const payload = await response.json().catch(() => ({}));
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      const normalized = entries.map((entry) => ({
        ...entry,
        children: entry?.type === "dir" ? entry?.children ?? null : undefined,
      }));
      if (!dirPath) {
        updateExplorerState(tabId, {
          tree: normalized,
          loading: false,
          error: "",
          treeTruncated: false,
          treeTotal: normalized.length,
        });
      } else {
        setExplorerNodeChildren(tabId, dirPath, normalized);
      }
      return normalized;
    },
    [
      attachmentSession?.sessionId,
      apiFetch,
      setExplorerNodeChildren,
      updateExplorerState,
    ]
  );

  const normalizeOpenPath = useCallback((rawPath) => {
    if (!rawPath) {
      return "";
    }
    return rawPath
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/");
  }, []);

  const expandExplorerDir = useCallback((tabId, dirPath) => {
    if (!dirPath) {
      return;
    }
    const parts = dirPath.split("/").filter(Boolean);
    const expanded = [];
    let current = "";
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      expanded.push(current);
    });
    updateExplorerState(tabId, {
      expandedPaths: expanded,
      selectedPath: "",
      fileContent: "",
      draftContent: "",
      fileError: "",
      fileBinary: false,
      editMode: false,
      isDirty: false,
    });
  }, [updateExplorerState]);

  const openPathInExplorer = useCallback(
    async (rawPath) => {
      const sessionId = attachmentSession?.sessionId;
      const tabId = activeWorktreeId || "main";
      if (!sessionId) {
        showToast(t("Session not found."), "error");
        return;
      }
      const normalized = normalizeOpenPath(rawPath);
      if (!normalized) {
        showToast(t("Path required."), "error");
        return;
      }
      let tree = explorerRef.current[tabId]?.tree;
      if (!Array.isArray(tree) || tree.length === 0) {
        try {
          await fetchExplorerChildren(tabId, "");
          tree = explorerRef.current[tabId]?.tree;
        } catch (error) {
          showToast(t("Unable to load directory."), "error");
          return;
        }
      }
      const parts = normalized.split("/").filter(Boolean);
      let currentPath = "";
      let node = null;
      for (const part of parts) {
        const nextPath = currentPath ? `${currentPath}/${part}` : part;
        node = findExplorerNode(tree, nextPath);
        if (!node) {
          showToast(t("Path not found."), "error");
          return;
        }
        if (node.type === "dir" && node.children === null) {
          try {
            await fetchExplorerChildren(tabId, node.path);
            tree = explorerRef.current[tabId]?.tree;
            node = findExplorerNode(tree, nextPath);
            if (!node) {
              showToast(t("Path not found."), "error");
              return;
            }
          } catch (error) {
            showToast(t("Unable to load directory."), "error");
            return;
          }
        }
        currentPath = nextPath;
      }
      if (!node) {
        showToast(t("Path not found."), "error");
        return;
      }
      handleViewSelect("explorer");
      requestExplorerTreeRef.current?.(tabId);
      requestExplorerStatusRef.current?.(tabId);
      if (node.type === "dir") {
        expandExplorerDir(tabId, node.path);
      } else {
        loadExplorerFileRef.current?.(tabId, node.path);
      }
    },
    [
      activeWorktreeId,
      apiFetch,
      attachmentSession?.sessionId,
      expandExplorerDir,
      findExplorerNode,
      handleViewSelect,
      normalizeOpenPath,
      fetchExplorerChildren,
      showToast,
      t,
      updateExplorerState,
    ]
  );

  // Handle send message - route to worktree or legacy
  const handleSendMessage = useCallback(
    (textOverride, attachmentsOverride) => {
      const rawText = (textOverride ?? input).trim();
      if (!rawText) {
        return;
      }
      if (activeProvider === "codex" && !isCodexReady) {
        showToast(t("Codex is starting. Please wait."), "info");
        return;
      }
      if (rawText === "/diff" || rawText.startsWith("/diff ")) {
        handleViewSelect("diff");
        if (activeWorktreeId && activeWorktreeId !== "main") {
          requestWorktreeDiff(activeWorktreeId);
        } else {
          requestRepoDiff();
        }
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/backlog")) {
        if (!socketRef.current || !connected) {
          showToast(t("Disconnected"), "error");
          return;
        }
        const targetWorktreeId =
          isInWorktree && activeWorktreeId ? activeWorktreeId : null;
        socketRef.current.send(
          JSON.stringify({
            type: "backlog_view_request",
            worktreeId: targetWorktreeId || undefined,
          })
        );
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/open")) {
        const targetPath = rawText.replace(/^\/open\s*/i, "").trim();
        if (!targetPath) {
          showToast(t("Path required."), "error");
          return;
        }
        openPathInExplorer(targetPath)
          .then(() => {
            setInput("");
            setDraftAttachments([]);
            setCommandMenuOpen(false);
          })
          .catch(() => null);
        return;
      }
      if (rawText.startsWith("/todo")) {
        const action = rawText.replace(/^\/todo\s*/i, "").trim();
        if (!action) {
          showToast(t("Todo text required."), "error");
          return;
        }
        const sessionId = attachmentSession?.sessionId;
        if (!sessionId) {
          showToast(t("Session not found."), "error");
          return;
        }
        void (async () => {
          try {
            const response = await apiFetch(
              `/api/session/${encodeURIComponent(sessionId)}/backlog`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: action }),
              }
            );
            if (!response.ok) {
              const payload = await response.json().catch(() => null);
              throw new Error(payload?.error || t("Unable to update backlog."));
            }
            showToast(t("Added to backlog."));
          } catch (error) {
            showToast(
              error.message || t("Unable to update backlog."),
              "error"
            );
          }
        })();
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/run")) {
        const command = rawText.replace(/^\/run\s*/i, "").trim();
        if (!command) {
          showToast(t("Command required."), "error");
          return;
        }
        if (!socketRef.current || !connected) {
          showToast(t("Disconnected"), "error");
          return;
        }
        const targetWorktreeId =
          isInWorktree && activeWorktreeId ? activeWorktreeId : null;
        socketRef.current.send(
          JSON.stringify({
            type: "action_request",
            request: "run",
            arg: command,
            worktreeId: targetWorktreeId || undefined,
          })
        );
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (rawText.startsWith("/screenshot")) {
        captureScreenshot()
          .then(() => {
            setInput("");
            setCommandMenuOpen(false);
          })
          .catch(() => null);
        return;
      }
      if (rawText.startsWith("/git")) {
        const command = rawText.replace(/^\/git\s*/i, "").trim();
        if (!command) {
          showToast(t("Git command required."), "error");
          return;
        }
        if (!socketRef.current || !connected) {
          showToast(t("Disconnected"), "error");
          return;
        }
        const targetWorktreeId =
          isInWorktree && activeWorktreeId ? activeWorktreeId : null;
        socketRef.current.send(
          JSON.stringify({
            type: "action_request",
            request: "git",
            arg: command,
            worktreeId: targetWorktreeId || undefined,
          })
        );
        setInput("");
        setDraftAttachments([]);
        setCommandMenuOpen(false);
        return;
      }
      if (isInWorktree && activeWorktreeId) {
        sendWorktreeMessage(activeWorktreeId, textOverride, attachmentsOverride);
      } else {
        sendMessage(textOverride, attachmentsOverride);
      }
    },
    [
      activeWorktreeId,
      activeProvider,
      apiFetch,
      attachmentSession?.sessionId,
      captureScreenshot,
      connected,
      handleViewSelect,
      input,
      isCodexReady,
      isInWorktree,
      openPathInExplorer,
      requestRepoDiff,
      requestWorktreeDiff,
      sendMessage,
      sendWorktreeMessage,
      showToast,
      t,
    ]
  );

  useEffect(() => {
    handleSendMessageRef.current = handleSendMessage;
  }, [handleSendMessage]);

  // ============== End Worktree Functions ==============

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
        await fetchExplorerChildren(tabId, "");
      } catch (error) {
        updateExplorerState(tabId, {
          loading: false,
          error: t("Unable to load the explorer."),
        });
      }
    },
    [attachmentSession?.sessionId, fetchExplorerChildren, updateExplorerState, t]
  );

  useEffect(() => {
    requestExplorerTreeRef.current = requestExplorerTree;
  }, [requestExplorerTree]);

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
          statusError: t("Unable to load Git status."),
          statusLoaded: false,
        });
      }
    },
    [attachmentSession?.sessionId, updateExplorerState, t]
  );

  useEffect(() => {
    requestExplorerStatusRef.current = requestExplorerStatus;
  }, [requestExplorerStatus]);

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
          t(
            "Vous avez des modifications non sauvegardees. Continuer sans sauvegarder ?"
          )
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
        editMode: true,
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
          fileError: t("Unable to load the file."),
        });
      }
    },
    [attachmentSession?.sessionId, updateExplorerState, t]
  );

  useEffect(() => {
    loadExplorerFileRef.current = loadExplorerFile;
  }, [loadExplorerFile]);

  const openFileInExplorer = useCallback(
    (filePath) => {
      if (!filePath) {
        return;
      }
      const tabId = activeWorktreeId || "main";
      handleViewSelect("explorer");
      requestExplorerTree(tabId);
      requestExplorerStatus(tabId);
      loadExplorerFileRef.current?.(tabId, filePath);
    },
    [
      activeWorktreeId,
      handleViewSelect,
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
        const willExpand = !expanded.has(dirPath);
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
      if (dirPath) {
        const tree = explorerRef.current[tabId]?.tree;
        const node = findExplorerNode(tree, dirPath);
        if (willExpand && node?.type === "dir" && node.children === null) {
          fetchExplorerChildren(tabId, dirPath).catch(() => {
            updateExplorerState(tabId, {
              error: t("Unable to load the explorer."),
            });
          });
        }
      }
    },
    [
      explorerDefaultState,
      fetchExplorerChildren,
      findExplorerNode,
      t,
      updateExplorerState,
    ]
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
          fileSaveError: t("Unable to save the file."),
        });
      }
    },
    [
      attachmentSession?.sessionId,
      explorerByTab,
      updateExplorerState,
      requestExplorerStatus,
      t,
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
          ? `${activeWorktree.name || t("Worktree")} (${activeWorktree.branchName || activeWorktree.id})`
          : t("Main");
      if (format === "markdown") {
        const lines = [
          `# ${t("Chat history")}`,
          "",
          `${t("Export")}: ${new Date().toISOString()}`,
          `${t("Tab")}: ${tabLabel}`,
          "",
        ];
        exportMessages.forEach((message) => {
          if (message.role === "commandExecution") {
            lines.push(`## ${t("Command")}`);
            lines.push(`\`${message.command || t("Command")}\``);
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
              message.toolResult?.name || message.toolResult?.tool || t("Tool");
            const toolOutput = message.toolResult?.output || message.text || "";
            lines.push(`## ${t("Tool result")}`);
            lines.push(`\`${toolName}\``);
            if (toolOutput) {
              lines.push("```");
              lines.push(toolOutput);
              lines.push("```");
            }
            lines.push("");
            return;
          }
          const roleLabel =
            message.role === "user" ? t("Username") : t("Assistant");
          lines.push(`## ${roleLabel}`);
          lines.push(message.text || "");
          const attachmentNames = normalizeAttachments(
            message.attachments || []
          )
            .map((item) => item?.name || item?.path)
            .filter(Boolean);
          if (attachmentNames.length) {
            lines.push(
              `${t("Attachments")}: ${attachmentNames.join(", ")}`
            );
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
      t,
    ]
  );

  const handleChoiceClick = (choice, blockKey, choiceIndex) => {
    setChoiceSelections((prev) => ({
      ...prev,
      [blockKey]: choiceIndex,
    }));
    setInput(choice);
    handleSendMessageRef.current?.(choice);
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
            title: t("Clone a session"),
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
      />
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
                      node.children || [],
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
                onClick={() => loadExplorerFileRef.current?.(tabId, node.path)}
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

        <section
          className={`conversation ${
            chatFullWidth ? "is-chat-full" : "is-chat-narrow"
          }`}
          ref={conversationRef}
        >
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
              getLanguageForPath={getLanguageForPath}
              themeMode={themeMode}
            />
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
            <LogsPanel
              t={t}
              activePane={activePane}
              filteredRpcLogs={filteredRpcLogs}
              logFilter={logFilter}
              setLogFilter={setLogFilter}
              scopedRpcLogs={scopedRpcLogs}
              handleClearRpcLogs={handleClearRpcLogs}
            />
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
              chatFullWidth={chatFullWidth}
              setChatFullWidth={setChatFullWidth}
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
                <button type="submit" className="vibe80-form-submit">
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
                  className="ghost"
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
