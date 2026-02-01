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
      worktreeDrafts: new Map(),
    };
    runtimeSessions.set(sessionId, runtime);
  }
  return runtime;
};

export const deleteSessionRuntime = (sessionId) => {
  runtimeSessions.delete(sessionId);
};
