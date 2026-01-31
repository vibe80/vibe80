import { createClient } from "redis";

const DEFAULT_PREFIX = "vc";

const buildKey = (prefix, ...parts) => [prefix, ...parts].join(":");

const toJson = (value) => JSON.stringify(value);
const fromJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export const createRedisStorage = () => {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error("REDIS_URL is required when STORAGE_BACKEND=redis.");
  }
  const prefix = process.env.REDIS_KEY_PREFIX || DEFAULT_PREFIX;
  const client = createClient({ url });

  const sessionKey = (sessionId) => buildKey(prefix, "session", sessionId);
  const sessionWorktreesKey = (sessionId) =>
    buildKey(prefix, "session", sessionId, "worktrees");
  const workspaceSessionsKey = (workspaceId) =>
    buildKey(prefix, "workspace", workspaceId, "sessions");
  const worktreeKey = (worktreeId) => buildKey(prefix, "worktree", worktreeId);
  const workspaceUserIdsKey = (workspaceId) =>
    buildKey(prefix, "workspaceUserIds", workspaceId);
  const globalSessionsKey = () => buildKey(prefix, "sessions");

  const sessionTtlMs = Number.parseInt(process.env.SESSION_MAX_TTL_MS, 10) || 0;

  const ensureConnected = async () => {
    if (client.isOpen) {
      return;
    }
    await client.connect();
  };

  const setWithTtl = async (key, value, ttlMs) => {
    if (ttlMs && ttlMs > 0) {
      await client.set(key, value, { PX: ttlMs });
      return;
    }
    await client.set(key, value);
  };

  const touchTtl = async (key, ttlMs) => {
    if (ttlMs && ttlMs > 0) {
      await client.pExpire(key, ttlMs);
    }
  };

  const saveSession = async (sessionId, data) => {
    await ensureConnected();
    const key = sessionKey(sessionId);
    await setWithTtl(key, toJson(data), sessionTtlMs);
    await client.sAdd(globalSessionsKey(), sessionId);
    if (data?.workspaceId) {
      await client.sAdd(workspaceSessionsKey(data.workspaceId), sessionId);
    }
    await touchTtl(globalSessionsKey(), sessionTtlMs);
    if (data?.workspaceId) {
      await touchTtl(workspaceSessionsKey(data.workspaceId), sessionTtlMs);
    }
  };

  const getSession = async (sessionId) => {
    await ensureConnected();
    const raw = await client.get(sessionKey(sessionId));
    return fromJson(raw);
  };

  const deleteSession = async (sessionId, workspaceId = null) => {
    await ensureConnected();
    const worktreeIds = await client.sMembers(sessionWorktreesKey(sessionId));
    if (worktreeIds.length) {
      const keys = worktreeIds.map((id) => worktreeKey(id));
      await client.del(keys);
    }
    await client.del(sessionWorktreesKey(sessionId));
    await client.del(sessionKey(sessionId));
    await client.sRem(globalSessionsKey(), sessionId);
    if (workspaceId) {
      await client.sRem(workspaceSessionsKey(workspaceId), sessionId);
    }
  };

  const listSessions = async (workspaceId) => {
    await ensureConnected();
    const ids = workspaceId
      ? await client.sMembers(workspaceSessionsKey(workspaceId))
      : await client.sMembers(globalSessionsKey());
    if (!ids.length) {
      return [];
    }
    const keys = ids.map((id) => sessionKey(id));
    const raw = await client.mGet(keys);
    return raw.map(fromJson).filter(Boolean);
  };

  const touchSession = async (sessionId, workspaceId = null) => {
    await ensureConnected();
    await touchTtl(sessionKey(sessionId), sessionTtlMs);
    await touchTtl(sessionWorktreesKey(sessionId), sessionTtlMs);
    if (workspaceId) {
      await touchTtl(workspaceSessionsKey(workspaceId), sessionTtlMs);
    }
    await touchTtl(globalSessionsKey(), sessionTtlMs);
  };

  const saveWorktree = async (sessionId, worktreeId, data) => {
    await ensureConnected();
    await setWithTtl(worktreeKey(worktreeId), toJson(data), sessionTtlMs);
    await client.sAdd(sessionWorktreesKey(sessionId), worktreeId);
    await touchTtl(sessionWorktreesKey(sessionId), sessionTtlMs);
  };

  const getWorktree = async (worktreeId) => {
    await ensureConnected();
    const raw = await client.get(worktreeKey(worktreeId));
    return fromJson(raw);
  };

  const deleteWorktree = async (sessionId, worktreeId) => {
    await ensureConnected();
    await client.del(worktreeKey(worktreeId));
    await client.sRem(sessionWorktreesKey(sessionId), worktreeId);
  };

  const listWorktrees = async (sessionId) => {
    await ensureConnected();
    const ids = await client.sMembers(sessionWorktreesKey(sessionId));
    if (!ids.length) {
      return [];
    }
    const keys = ids.map((id) => worktreeKey(id));
    const raw = await client.mGet(keys);
    return raw.map(fromJson).filter(Boolean);
  };

  const saveWorkspaceUserIds = async (workspaceId, data) => {
    await ensureConnected();
    await setWithTtl(workspaceUserIdsKey(workspaceId), toJson(data), sessionTtlMs);
  };

  const getWorkspaceUserIds = async (workspaceId) => {
    await ensureConnected();
    const raw = await client.get(workspaceUserIdsKey(workspaceId));
    return fromJson(raw);
  };

  return {
    init: ensureConnected,
    close: async () => {
      if (client.isOpen) {
        await client.quit();
      }
    },
    saveSession,
    getSession,
    deleteSession,
    listSessions,
    touchSession,
    saveWorktree,
    getWorktree,
    deleteWorktree,
    listWorktrees,
    saveWorkspaceUserIds,
    getWorkspaceUserIds,
  };
};
