import storage from "../storage/index.js";
import { createWorkspaceToken, accessTokenTtlSeconds } from "../middleware/auth.js";
import { generateId, hashRefreshToken, generateRefreshToken } from "../helpers.js";

const refreshTokenTtlSeconds =
  Number(process.env.VIBE80_REFRESH_TOKEN_TTL_SECONDS) || 30 * 24 * 60 * 60;
const refreshTokenTtlMs = refreshTokenTtlSeconds * 1000;
const handoffTokenTtlMs =
  Number(process.env.VIBE80_HANDOFF_TOKEN_TTL_MS) || 120 * 1000;
const monoAuthTokenTtlMs =
  Number(process.env.VIBE80_MONO_AUTH_TOKEN_TTL_MS) || 5 * 60 * 1000;

export const handoffTokens = new Map();
const monoAuthTokens = new Map();

export const issueWorkspaceTokens = async (workspaceId) => {
  const workspaceToken = createWorkspaceToken(workspaceId);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = Date.now() + refreshTokenTtlMs;
  await storage.saveWorkspaceRefreshToken(
    workspaceId,
    tokenHash,
    expiresAt,
    refreshTokenTtlMs
  );
  return {
    workspaceToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
    refreshExpiresIn: refreshTokenTtlSeconds,
  };
};

const buildRefreshError = (code) => {
  if (code === "refresh_token_expired") {
    return {
      status: 401,
      payload: { error: "Refresh token expired.", code },
    };
  }
  if (code === "refresh_token_reused") {
    return {
      status: 401,
      payload: { error: "Refresh token reused.", code },
    };
  }
  return {
    status: 401,
    payload: { error: "Invalid refresh token.", code: "invalid_refresh_token" },
  };
};

export const rotateWorkspaceRefreshToken = async (refreshToken) => {
  const currentTokenHash = hashRefreshToken(refreshToken);
  const nextRefreshToken = generateRefreshToken();
  const nextTokenHash = hashRefreshToken(nextRefreshToken);
  const nextExpiresAt = Date.now() + refreshTokenTtlMs;
  const result = await storage.rotateWorkspaceRefreshToken(
    currentTokenHash,
    nextTokenHash,
    nextExpiresAt,
    refreshTokenTtlMs
  );
  if (!result?.ok || !result.workspaceId) {
    const error = buildRefreshError(result?.code || "invalid_refresh_token");
    return {
      ok: false,
      ...error,
    };
  }
  return {
    ok: true,
    payload: {
      workspaceToken: createWorkspaceToken(result.workspaceId),
      refreshToken: nextRefreshToken,
      expiresIn: accessTokenTtlSeconds,
      refreshExpiresIn: refreshTokenTtlSeconds,
    },
  };
};

export const createHandoffToken = (session) => {
  const now = Date.now();
  const token = generateId("h");
  const record = {
    token,
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    createdAt: now,
    expiresAt: now + handoffTokenTtlMs,
    usedAt: null,
  };
  handoffTokens.set(token, record);
  return record;
};

export const createMonoAuthToken = (workspaceId = "default") => {
  const now = Date.now();
  const token = generateId("m");
  const record = {
    token,
    workspaceId,
    createdAt: now,
    expiresAt: now + monoAuthTokenTtlMs,
    usedAt: null,
  };
  monoAuthTokens.set(token, record);
  return record;
};

export const consumeMonoAuthToken = (token) => {
  const record = monoAuthTokens.get(token);
  if (!record) {
    return { ok: false, code: "MONO_AUTH_TOKEN_INVALID" };
  }
  if (record.usedAt) {
    monoAuthTokens.delete(token);
    return { ok: false, code: "MONO_AUTH_TOKEN_USED" };
  }
  if (record.expiresAt && record.expiresAt <= Date.now()) {
    monoAuthTokens.delete(token);
    return { ok: false, code: "MONO_AUTH_TOKEN_EXPIRED" };
  }
  record.usedAt = Date.now();
  monoAuthTokens.delete(token);
  return {
    ok: true,
    workspaceId: record.workspaceId,
  };
};

export const cleanupHandoffTokens = () => {
  if (handoffTokens.size === 0) return;
  const now = Date.now();
  for (const [token, record] of handoffTokens.entries()) {
    if (record.usedAt || (record.expiresAt && record.expiresAt <= now)) {
      handoffTokens.delete(token);
    }
  }
};

export const cleanupMonoAuthTokens = () => {
  if (monoAuthTokens.size === 0) return;
  const now = Date.now();
  for (const [token, record] of monoAuthTokens.entries()) {
    if (record.usedAt || (record.expiresAt && record.expiresAt <= now)) {
      monoAuthTokens.delete(token);
    }
  }
};

export {
  hashRefreshToken,
  refreshTokenTtlMs,
  refreshTokenTtlSeconds,
};
