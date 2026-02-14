import { createClient } from "redis";

const DEFAULT_PREFIX = "v80";

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
  const worktreeMessagesKey = (worktreeId) =>
    buildKey(prefix, "worktree", worktreeId, "messages");
  const worktreeMessageIndexKey = (worktreeId) =>
    buildKey(prefix, "worktree", worktreeId, "messageIndex");
  const worktreeMessageSeqKey = (worktreeId) =>
    buildKey(prefix, "worktree", worktreeId, "messageSeq");
  const workspaceUserIdsKey = (workspaceId) =>
    buildKey(prefix, "workspaceUserIds", workspaceId);
  const workspaceKey = (workspaceId) => buildKey(prefix, "workspace", workspaceId);
  const workspaceAuditEventsKey = (workspaceId) =>
    buildKey(prefix, "workspace", workspaceId, "auditEvents");
  const workspaceUidSeqKey = () => buildKey(prefix, "workspaceUidSeq");
  const refreshTokenKey = (tokenHash) => buildKey(prefix, "refreshToken", tokenHash);
  const globalSessionsKey = () => buildKey(prefix, "sessions");

  const sessionTtlMs = Number.parseInt(process.env.SESSION_MAX_TTL_MS, 10) || 0;
  const workspaceUidMin =
    Number.parseInt(process.env.WORKSPACE_UID_MIN, 10) || 200000;
  const workspaceUidMax =
    Number.parseInt(process.env.WORKSPACE_UID_MAX, 10) || 999999999;

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
      const keys = worktreeIds.flatMap((id) => [
        worktreeKey(id),
        worktreeMessagesKey(id),
        worktreeMessageIndexKey(id),
        worktreeMessageSeqKey(id),
      ]);
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
    await client.del(
      worktreeKey(worktreeId),
      worktreeMessagesKey(worktreeId),
      worktreeMessageIndexKey(worktreeId),
      worktreeMessageSeqKey(worktreeId)
    );
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

  const appendWorktreeMessage = async (sessionId, worktreeId, message) => {
    await ensureConnected();
    const messageId = message?.id;
    if (!messageId) {
      throw new Error("Message id is required.");
    }
    const seq = await client.incr(worktreeMessageSeqKey(worktreeId));
    await client.hSet(worktreeMessageIndexKey(worktreeId), messageId, seq);
    await client.rPush(worktreeMessagesKey(worktreeId), toJson(message));
    await touchTtl(worktreeMessagesKey(worktreeId), sessionTtlMs);
    await touchTtl(worktreeMessageIndexKey(worktreeId), sessionTtlMs);
    await touchTtl(worktreeMessageSeqKey(worktreeId), sessionTtlMs);
  };

  const getWorktreeMessages = async (
    sessionId,
    worktreeId,
    { limit = null, beforeMessageId = null } = {}
  ) => {
    await ensureConnected();
    const listKey = worktreeMessagesKey(worktreeId);
    const listLength = await client.lLen(listKey);
    if (!listLength) {
      return [];
    }

    let startIndex = 0;
    let endIndex = listLength - 1;

    if (beforeMessageId) {
      const seqValue = await client.hGet(
        worktreeMessageIndexKey(worktreeId),
        beforeMessageId
      );
      const seq = Number.parseInt(seqValue, 10);
      if (!seq || Number.isNaN(seq)) {
        return [];
      }
      startIndex = seq;
    }

    if (limit && Number.isFinite(limit)) {
      const minStart = Math.max(0, listLength - limit);
      startIndex = Math.max(startIndex, minStart);
    }

    if (startIndex > endIndex) {
      return [];
    }

    const raw = await client.lRange(listKey, startIndex, endIndex);
    return raw.map(fromJson).filter(Boolean);
  };

  const clearWorktreeMessages = async (sessionId, worktreeId) => {
    await ensureConnected();
    await client.del(
      worktreeMessagesKey(worktreeId),
      worktreeMessageIndexKey(worktreeId),
      worktreeMessageSeqKey(worktreeId)
    );
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

  const saveWorkspaceRefreshToken = async (
    workspaceId,
    tokenHash,
    expiresAt,
    ttlMs,
    _options = {}
  ) => {
    await ensureConnected();
    const tokenPayload = {
      workspaceId,
      tokenHash,
      expiresAt,
      consumedAt: null,
      replacedByHash: null,
    };
    if (ttlMs && ttlMs > 0) {
      await client.set(refreshTokenKey(tokenHash), toJson(tokenPayload), { PX: ttlMs });
    } else {
      await client.set(refreshTokenKey(tokenHash), toJson(tokenPayload));
    }
  };

  const getWorkspaceRefreshToken = async (tokenHash) => {
    await ensureConnected();
    const raw = await client.get(refreshTokenKey(tokenHash));
    return fromJson(raw);
  };

  const rotateWorkspaceRefreshToken = async (
    tokenHash,
    nextTokenHash,
    nextExpiresAt,
    nextTtlMs
  ) => {
    await ensureConnected();
    const key = refreshTokenKey(tokenHash);
    const nextKey = refreshTokenKey(nextTokenHash);
    const attempts = 8;
    for (let i = 0; i < attempts; i += 1) {
      await client.watch(key);
      try {
        const raw = await client.get(key);
        const record = fromJson(raw);
        if (!record?.workspaceId) {
          await client.unwatch();
          return { ok: false, code: "invalid_refresh_token" };
        }
        const now = Date.now();
        if (record.consumedAt) {
          await client.unwatch();
          return { ok: false, code: "refresh_token_reused" };
        }
        if (record.expiresAt && record.expiresAt <= now) {
          const expireTx = client.multi();
          expireTx.del(key);
          await expireTx.exec();
          return { ok: false, code: "refresh_token_expired" };
        }
        const oldRemainingTtlMs = Math.max(1, (record.expiresAt || now) - now);
        const updated = {
          ...record,
          consumedAt: now,
          replacedByHash: nextTokenHash,
        };
        const nextPayload = {
          workspaceId: record.workspaceId,
          tokenHash: nextTokenHash,
          expiresAt: nextExpiresAt,
          consumedAt: null,
          replacedByHash: null,
        };
        const tx = client.multi();
        tx.set(key, toJson(updated), { PX: oldRemainingTtlMs });
        if (nextTtlMs && nextTtlMs > 0) {
          tx.set(nextKey, toJson(nextPayload), { PX: nextTtlMs });
        } else {
          tx.set(nextKey, toJson(nextPayload));
        }
        const execResult = await tx.exec();
        if (execResult) {
          return { ok: true, workspaceId: record.workspaceId };
        }
      } catch {
        await client.unwatch();
      }
    }
    throw new Error("Unable to rotate refresh token.");
  };

  const deleteWorkspaceRefreshToken = async (tokenHash) => {
    await ensureConnected();
    await client.del(refreshTokenKey(tokenHash));
  };

  const cleanupWorkspaceRefreshTokens = async () => {
    // TTL-based cleanup handled by Redis expiration.
  };

  const getNextWorkspaceUid = async () => {
    await ensureConnected();
    const key = workspaceUidSeqKey();
    const current = await client.get(key);
    if (current === null) {
      await client.set(key, String(workspaceUidMin - 1));
    }
    const next = await client.incr(key);
    if (next > workspaceUidMax) {
      throw new Error("Workspace UID range exhausted.");
    }
    return Number(next);
  };

  const saveWorkspace = async (workspaceId, data) => {
    await ensureConnected();
    await client.set(workspaceKey(workspaceId), toJson(data));
  };

  const getWorkspace = async (workspaceId) => {
    await ensureConnected();
    const raw = await client.get(workspaceKey(workspaceId));
    return fromJson(raw);
  };

  const appendWorkspaceAuditEvent = async (workspaceId, data) => {
    await ensureConnected();
    await client.rPush(workspaceAuditEventsKey(workspaceId), toJson(data));
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
    appendWorktreeMessage,
    getWorktreeMessages,
    clearWorktreeMessages,
    saveWorkspaceUserIds,
    getWorkspaceUserIds,
    saveWorkspaceRefreshToken,
    getWorkspaceRefreshToken,
    rotateWorkspaceRefreshToken,
    deleteWorkspaceRefreshToken,
    cleanupWorkspaceRefreshTokens,
    getNextWorkspaceUid,
    saveWorkspace,
    getWorkspace,
    appendWorkspaceAuditEvent,
  };
};
