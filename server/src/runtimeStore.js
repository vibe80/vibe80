const runtimeSessions = new Map();

export const getSessionRuntime = (sessionId) => {
  if (!sessionId) {
    return null;
  }
  let runtime = runtimeSessions.get(sessionId);
  if (!runtime) {
    runtime = {
      sockets: new Set(),
      clients: {},
      worktreeClients: new Map(),
    };
    runtimeSessions.set(sessionId, runtime);
  }
  return runtime;
};

export const getExistingSessionRuntime = (sessionId) => {
  if (!sessionId) {
    return null;
  }
  return runtimeSessions.get(sessionId) || null;
};

export const listSessionRuntimes = () => Array.from(runtimeSessions.values());

export const deleteSessionRuntime = (sessionId) => {
  runtimeSessions.delete(sessionId);
};
