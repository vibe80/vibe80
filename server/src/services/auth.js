import storage from "../storage/index.js";
import { createWorkspaceToken, accessTokenTtlSeconds } from "../middleware/auth.js";
import { generateId, hashRefreshToken, generateRefreshToken } from "../helpers.js";

const refreshTokenTtlSeconds =
  Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 30 * 24 * 60 * 60;
const refreshTokenTtlMs = refreshTokenTtlSeconds * 1000;
const refreshRotationGraceSeconds =
  Number(process.env.REFRESH_TOKEN_ROTATION_GRACE_SECONDS) || 20;
const refreshRotationGraceMs = Math.max(0, refreshRotationGraceSeconds * 1000);
const handoffTokenTtlMs =
  Number(process.env.HANDOFF_TOKEN_TTL_MS) || 120 * 1000;
const monoAuthTokenTtlMs =
  Number(process.env.MONO_AUTH_TOKEN_TTL_MS) || 5 * 60 * 1000;

export const handoffTokens = new Map();
const monoAuthTokens = new Map();

export const issueWorkspaceTokens = async (workspaceId) => {
  const workspaceToken = createWorkspaceToken(workspaceId);
  const refreshToken = generateRefreshToken();
  const tokenHash = hashRefreshToken(refreshToken);
  const expiresAt = Date.now() + refreshTokenTtlMs;
  const existingRefreshState = await storage.getWorkspaceRefreshState(workspaceId);
  const previousTokenHash =
    typeof existingRefreshState?.currentTokenHash === "string" &&
    existingRefreshState.currentTokenHash
      ? existingRefreshState.currentTokenHash
      : null;
  const previousValidUntil = previousTokenHash
    ? Date.now() + refreshRotationGraceMs
    : null;
  await storage.saveWorkspaceRefreshToken(
    workspaceId,
    tokenHash,
    expiresAt,
    refreshTokenTtlMs,
    { previousTokenHash, previousValidUntil }
  );
  return {
    workspaceToken,
    refreshToken,
    expiresIn: accessTokenTtlSeconds,
    refreshExpiresIn: refreshTokenTtlSeconds,
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
  refreshRotationGraceMs,
};
