import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "@uiw/react-markdown-preview/markdown.css";
import { Diff, Hunk, parseDiff } from "react-diff-view";
import "react-diff-view/style/index.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

const getSessionIdFromUrl = () =>
  new URLSearchParams(window.location.search).get("session");

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

const getTruncatedText = (text, limit) => {
  if (!text) {
    return "";
  }
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}…`;
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
  const [repoUrl, setRepoUrl] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [sessionRequested, setSessionRequested] = useState(false);
  const [soundEnabled] = useState(true);
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
  const socketRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
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

  const messageIndex = useMemo(() => new Map(), []);
  const repoName = useMemo(
    () => extractRepoName(attachmentSession?.repoUrl),
    [attachmentSession?.repoUrl]
  );
  const backlogKey = useMemo(
    () =>
      attachmentSession?.sessionId
        ? `backlog:${attachmentSession.sessionId}`
        : null,
    [attachmentSession?.sessionId]
  );
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

  const applyMessages = useCallback(
    (items = []) => {
      const normalized = items.map((item, index) => ({
        id: item.id || `history-${index}`,
        role: item.role,
        text: item.text,
      }));
      messageIndex.clear();
      normalized.forEach((item, index) => {
        if (item.role === "assistant") {
          messageIndex.set(item.id, index);
        }
      });
      setMessages(normalized);
    },
    [messageIndex]
  );

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
  }, [playNotificationSound]);

  useEffect(() => {
    void ensureNotificationPermission();
    primeAudioContext();
  }, [ensureNotificationPermission, primeAudioContext]);

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
      });

      socket.addEventListener("close", () => {
        if (!isCurrent()) {
          return;
        }
        setConnected(false);
        setStatus("Deconnecte");
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

        if (payload.type === "status") {
          setStatus(payload.message);
        }

        if (payload.type === "ready") {
          setStatus("Pret");
        }

        if (payload.type === "assistant_delta") {
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

        if (payload.type === "assistant_message") {
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

        if (payload.type === "turn_error") {
          setStatus(`Erreur: ${payload.message}`);
          setProcessing(false);
          setActivity("");
          setCurrentTurnId(null);
        }

        if (payload.type === "error") {
          setStatus(payload.message || "Erreur inattendue");
          setProcessing(false);
          setActivity("");
          setModelLoading(false);
          setModelError(payload.message || "Erreur inattendue");
        }

        if (payload.type === "turn_started") {
          setProcessing(true);
          setActivity("Traitement en cours...");
          setCurrentTurnId(payload.turnId || null);
        }

        if (payload.type === "turn_completed") {
          setProcessing(false);
          setActivity("");
          setCurrentTurnId(null);
        }

        if (payload.type === "repo_diff") {
          setRepoDiff({
            status: payload.status || "",
            diff: payload.diff || "",
          });
        }

        if (payload.type === "model_list") {
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

        if (payload.type === "model_set") {
          setSelectedModel(payload.model || "");
          if (payload.reasoningEffort !== undefined) {
            setSelectedReasoningEffort(payload.reasoningEffort || "");
          }
          setModelLoading(false);
          setModelError("");
        }

        if (payload.type === "rpc_log") {
          if (payload.entry) {
            setRpcLogs((current) => [payload.entry, ...current].slice(0, 500));
          }
        }

        if (payload.type === "item_started") {
          const { item } = payload;
          if (!item?.type) {
            return;
          }
          if (item.type === "commandExecution") {
            setActivity(`Commande: ${item.command}`);
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
      });
    };

    connect();

    return () => {
      isMounted = false;
      closingRef.current = true;
      clearReconnectTimer();
      if (socketRef.current) {
        socketRef.current.close();
      }
      closingRef.current = false;
    };
  }, [attachmentSession?.sessionId, messageIndex]);

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
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repoUrl }),
        });
        if (!response.ok) {
          throw new Error("Failed to create attachment session.");
        }
        const data = await response.json();
        setAttachmentSession(data);
      } catch (error) {
        setAttachmentsError(
          error.message || "Impossible de creer la session de pieces jointes."
        );
      } finally {
        setAttachmentsLoading(false);
      }
    };

    createAttachmentSession();
  }, [repoUrl]);

  useEffect(() => {
    if (!attachmentSession?.sessionId) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("session", attachmentSession.sessionId);
    window.history.replaceState({}, "", url);
  }, [attachmentSession?.sessionId]);

  const onRepoSubmit = (event) => {
    event.preventDefault();
    const trimmed = repoInput.trim();
    if (!trimmed) {
      setAttachmentsError("URL de depot git requise pour demarrer.");
      return;
    }
    setAttachmentsError("");
    setSessionRequested(true);
    setRepoUrl(trimmed);
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

  const requestModelList = () => {
    if (!socketRef.current) {
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
  };

  const launchBacklogItem = (item) => {
    sendMessage(item.text || "", item.attachments || []);
    removeFromBacklog(item.id);
  };

  const onSubmit = (event) => {
    event.preventDefault();
    sendMessage();
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

  const handleInputChange = (event) => {
    const { value } = event.target;
    setInput(value);
    if (!inputRef.current) {
      return;
    }
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  };

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  }, [input]);

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
    setChoiceSelections({});
    lastNotifiedIdRef.current = null;
  };

  if (!attachmentSession?.sessionId) {
    return (
      <div className="session-gate">
        <div className="session-card">
          <p className="eyebrow">m5chat</p>
          <h1>Demarrer une session</h1>
          <p className="session-hint">
            Indique l'URL du depot git a cloner pour cette session.
          </p>
          <form className="session-form" onSubmit={onRepoSubmit}>
            <input
              type="text"
              placeholder="git@gitea.devops:mon-org/mon-repo.git"
              value={repoInput}
              onChange={(event) => setRepoInput(event.target.value)}
              disabled={sessionRequested}
              required
            />
            <button type="submit" disabled={sessionRequested}>
              {sessionRequested ? "Chargement..." : "Go"}
            </button>
          </form>
          {attachmentsError && (
            <div className="attachments-error">{attachmentsError}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">m5chat</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="clear-chat"
            onClick={handleClearChat}
            disabled={messages.length === 0}
          >
            Clear chat
          </button>
          <div className="model-control">
            <button
              type="button"
              className="model-button"
              onClick={requestModelList}
              disabled={!connected || modelLoading}
            >
              {modelLoading ? "Chargement..." : "Select model"}
            </button>
            <select
              className="model-select"
              value={selectedModel}
              onChange={handleModelChange}
              disabled={!connected || models.length === 0 || modelLoading}
            >
              <option value="">Modele par defaut</option>
              {models.map((model) => (
                <option key={model.id} value={model.model}>
                  {model.displayName || model.model}
                </option>
              ))}
            </select>
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
          </div>
          {!connected && (
            <div className="status-wrap">
              <div className="status down">{status}</div>
            </div>
          )}
          {modelError && <div className="status down">{modelError}</div>}
        </div>
      </header>

      <div className="layout">
        <div className="side">
          <aside className="attachments">
            <div className="attachments-header">
              <h2>Pieces jointes</h2>
              <p className="attachments-subtitle">
                {repoName || "Session en cours..."}
              </p>
            </div>

            <label
              className={`upload ${
                !attachmentSession || attachmentsLoading ? "disabled" : ""
              }`}
            >
              <input
                type="file"
                multiple
                onChange={onUploadAttachments}
                disabled={!attachmentSession || attachmentsLoading}
              />
              <span>Uploader des fichiers</span>
            </label>

            <div className="attachments-meta">
              <span>
                Selectionnees: {selectedAttachments.length}/{attachments.length}
              </span>
              {attachmentsLoading && <span>Chargement...</span>}
            </div>

            {attachmentsError && (
              <div className="attachments-error">{attachmentsError}</div>
            )}

            {attachments.length === 0 ? (
              <div className="attachments-empty">
                Aucune piece jointe pour cette session.
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
          </aside>

          <form className="composer" onSubmit={onSubmit}>
            <div className="composer-editor">
              <textarea
                className="composer-input"
                value={input}
                onChange={handleInputChange}
                onPaste={onPasteAttachments}
                placeholder="Ecris ton message..."
                rows={6}
                ref={inputRef}
              />
            </div>
            <div className="composer-actions">
              <button type="submit" disabled={!connected || !input.trim()}>
                Envoyer
              </button>
              <button
                type="button"
                className="ghost"
                onClick={interruptTurn}
                disabled={!processing || !currentTurnId}
              >
                Stop
              </button>
              <button
                type="button"
                className="secondary"
                onClick={addToBacklog}
                disabled={!input.trim()}
              >
                Ajouter a la backlog
              </button>
            </div>
          </form>
          <section className="backlog">
            <div className="backlog-header">
              <h2>Backlog</h2>
              <span className="backlog-count">{backlog.length}</span>
            </div>
            {backlog.length === 0 ? (
              <div className="backlog-empty">
                Aucune tache en attente pour le moment.
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
                        Editer
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
                        {item.attachments.length} piece(s) jointe(s)
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="conversation">
          <div className="conversation-tabs">
            <button
              type="button"
              className={`tab-button ${
                activePane === "chat" ? "is-active" : ""
              }`}
              onClick={() => setActivePane("chat")}
            >
              Messages
            </button>
            <button
              type="button"
              className={`tab-button ${
                activePane === "diff" ? "is-active" : ""
              }`}
              onClick={() => setActivePane("diff")}
            >
              Diff
            </button>
            <button
              type="button"
              className={`tab-button ${
                activePane === "terminal" ? "is-active" : ""
              }`}
              onClick={() => setActivePane("terminal")}
            >
              Terminal
            </button>
            <button
              type="button"
              className={`tab-button ${
                activePane === "logs" ? "is-active" : ""
              }`}
              onClick={() => setActivePane("logs")}
            >
              Logs
            </button>
          </div>
          <main
            className={`chat ${activePane === "chat" ? "" : "is-hidden"}`}
            ref={listRef}
          >
              {messages.length === 0 && (
                <div className="empty">
                  <p>Envoyez un message pour demarrer une session.</p>
                </div>
              )}
              {messages.map((message) => {
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
                              (choice, choiceIndex) => ({ choice, choiceIndex })
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
            className={`diff-panel ${activePane === "diff" ? "" : "is-hidden"}`}
          >
              <div className="diff-header">
                <div className="diff-title">Diff du repository</div>
                {diffStatusLines.length > 0 && (
                  <div className="diff-count">
                    {diffStatusLines.length} fichiers modifies
                  </div>
                )}
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
            className={`logs-panel ${activePane === "logs" ? "" : "is-hidden"}`}
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
        </section>
      </div>
    </div>
  );
}

export default App;
