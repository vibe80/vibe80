import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const wsUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/ws`;
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
  const socketRef = useRef(null);
  const listRef = useRef(null);

  const messageIndex = useMemo(() => new Map(), []);

  useEffect(() => {
    const socket = new WebSocket(wsUrl());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      setConnected(true);
      setStatus("Connecte");
    });

    socket.addEventListener("close", () => {
      setConnected(false);
      setStatus("Deconnecte");
    });

    socket.addEventListener("message", (event) => {
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

    return () => {
      socket.close();
    };
  }, [messageIndex]);

  useEffect(() => {
    const createAttachmentSession = async () => {
      try {
        setAttachmentsLoading(true);
        setAttachmentsError("");
        const response = await fetch("/api/attachments/session", {
          method: "POST",
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
  }, []);

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
  }, [messages]);

  const onUploadAttachments = async (event) => {
    const files = Array.from(event.target.files || []);
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
      event.target.value = "";
    }
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
      JSON.stringify({ type: "user_message", text })
    );
    setInput("");
  };

  const onSubmit = (event) => {
    event.preventDefault();
    sendMessage();
  };

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
          {processing && (
            <div className="loader" title={activity || "Traitement..."}>
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          )}
        </div>
      </header>

      {processing && (
        <div className="activity">
          <span className="activity-label">Action:</span>
          <span>{activity || "Traitement en cours..."}</span>
        </div>
      )}

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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {message.text}
                </ReactMarkdown>
              </div>
            ))}
          </main>

          <form className="composer" onSubmit={onSubmit}>
            <input
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ecris ton message..."
            />
            <button type="submit" disabled={!connected || !input.trim()}>
              Envoyer
            </button>
          </form>
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
    </div>
  );
}

export default App;
