import { useCallback, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

const terminalWsUrl = (sessionId, worktreeId) => {
  const params = new URLSearchParams();
  if (sessionId) {
    params.set("session", sessionId);
  }
  if (worktreeId) {
    params.set("worktreeId", worktreeId);
  }
  return `/api/terminal/ws?${params.toString()}`;
};

export default function useTerminalSession({
  activePane,
  activeWorktreeId,
  attachmentSessionId,
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
}) {
  const connectTerminal = useCallback(() => {
    if (!terminalEnabled) {
      return;
    }
    if (!workspaceToken) {
      return;
    }
    const sessionId = attachmentSessionId;
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
    const socket = new WebSocket(terminalWsUrl(sessionId, worktreeId));
    terminalSocketRef.current = socket;
    terminalSessionRef.current = sessionId;
    terminalWorktreeRef.current = worktreeId;
    let authenticated = false;

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "auth", token: workspaceToken }));
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
      if (payload.type === "auth_ok") {
        if (authenticated) {
          return;
        }
        authenticated = true;
        const term = terminalRef.current;
        const fitAddon = terminalFitRef.current;
        if (term && fitAddon) {
          fitAddon.fit();
          socket.send(
            JSON.stringify({ type: "init", cols: term.cols, rows: term.rows })
          );
        }
        return;
      }
      if (!authenticated) {
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
  }, [
    activeWorktreeId,
    attachmentSessionId,
    terminalEnabled,
    terminalFitRef,
    terminalRef,
    terminalSessionRef,
    terminalSocketRef,
    terminalWorktreeRef,
    workspaceToken,
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
  }, [
    activePane,
    terminalContainerRef,
    terminalDisposableRef,
    terminalEnabled,
    terminalFitRef,
    terminalRef,
    terminalSocketRef,
    themeMode,
  ]);

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
  }, [terminalRef, themeMode]);

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
  }, [terminalDisposableRef, terminalFitRef, terminalRef]);

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
  }, [
    activePane,
    connectTerminal,
    terminalEnabled,
    terminalFitRef,
    terminalRef,
    terminalSocketRef,
    themeMode,
  ]);

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
  }, [terminalFitRef, terminalRef, terminalSocketRef]);

  useEffect(() => {
    if (!attachmentSessionId && terminalSocketRef.current) {
      terminalSocketRef.current.close();
      terminalSocketRef.current = null;
      terminalSessionRef.current = null;
      terminalWorktreeRef.current = null;
    }
  }, [attachmentSessionId, terminalSessionRef, terminalSocketRef, terminalWorktreeRef]);

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
  }, [
    terminalDisposableRef,
    terminalEnabled,
    terminalFitRef,
    terminalRef,
    terminalSessionRef,
    terminalSocketRef,
    terminalWorktreeRef,
  ]);
}
