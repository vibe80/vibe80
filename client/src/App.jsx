import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import "@uiw/react-markdown-preview/markdown.css";

const getSessionIdFromUrl = () =>
  new URLSearchParams(window.location.search).get("session");

const wsUrl = (sessionId) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const query = sessionId ? `?session=${encodeURIComponent(sessionId)}` : "";
  return `${protocol}://${window.location.host}/ws${query}`;
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
  const socketRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const closingRef = useRef(false);

  const messageIndex = useMemo(() => new Map(), []);

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
        }

        if (payload.type === "error") {
          setStatus(payload.message || "Erreur inattendue");
          setProcessing(false);
          setActivity("");
        }

        if (payload.type === "turn_started") {
          setProcessing(true);
          setActivity("Traitement en cours...");
        }

        if (payload.type === "turn_completed") {
          setProcessing(false);
          setActivity("");
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
    setStatus("Connexion...");
    setConnected(false);
  }, [attachmentSession?.sessionId, applyMessages, messageIndex]);

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

  const sendMessage = () => {
    if (!input.trim() || !socketRef.current || !connected) {
      return;
    }

    const selectedPaths = selectedAttachments;
    const suffix =
      selectedPaths.length > 0
        ? `;; attachments: ${JSON.stringify(selectedPaths)}`
        : "";
    const displayText = input.trim();
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

  const onSubmit = (event) => {
    event.preventDefault();
    sendMessage();
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
          <h1>Conversation locale avec Codex</h1>
        </div>
        <div className="status-wrap">
          <div className={`status ${connected ? "ok" : "down"}`}>
            {status}
          </div>
        </div>
      </header>

      <div className="layout">
        <section className="conversation">
          <main className="chat" ref={listRef}>
            {messages.length === 0 && (
              <div className="empty">
                <p>Envoyez un message pour demarrer une session.</p>
              </div>
            )}
            {messages.map((message) => (
              <div key={message.id} className={`bubble ${message.role}`}>
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
                  {message.text}
                </ReactMarkdown>
              </div>
            ))}
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

        </section>

        <aside className="attachments">
          <div className="attachments-header">
            <h2>Pieces jointes</h2>
            <p className="attachments-subtitle">
              {attachmentSession?.path || "Session en cours..."}
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
                      <span className="attachments-path">{file.path}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>

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
        <button type="submit" disabled={!connected || !input.trim()}>
          Envoyer
        </button>
      </form>
    </div>
  );
}

export default App;
