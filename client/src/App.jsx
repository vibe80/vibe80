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
  const [connected, setConnected] = useState(false);
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
      }

      if (payload.type === "error") {
        setStatus(payload.message || "Erreur inattendue");
      }
    });

    return () => {
      socket.close();
    };
  }, [messageIndex]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim() || !socketRef.current || !connected) {
      return;
    }

    const text = input.trim();
    setMessages((current) => [
      ...current,
      { id: `user-${Date.now()}`, role: "user", text },
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
        <div className={`status ${connected ? "ok" : "down"}`}>
          {status}
        </div>
      </header>

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
    </div>
  );
}

export default App;
