import storage from "../storage/index.js";
import { createWorkspaceToken, accessTokenTtlSeconds } from "../middleware/auth.js";
import { generateId, hashRefreshToken, generateRefreshToken } from "../helpers.js";

const refreshTokenTtlSeconds =
  Number(process.env.REFRESH_TOKEN_TTL_SECONDS) || 30 * 24 * 60 * 60;
const refreshTokenTtlMs = refreshTokenTtlSeconds * 1000;
const handoffTokenTtlMs =
  Number(process.env.HANDOFF_TOKEN_TTL_MS) || 120 * 1000;

export const handoffTokens = new Map();

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

export const cleanupHandoffTokens = () => {
  if (handoffTokens.size === 0) return;
  const now = Date.now();
  for (const [token, record] of handoffTokens.entries()) {
    if (record.usedAt || (record.expiresAt && record.expiresAt <= now)) {
      handoffTokens.delete(token);
    }
  }
};

export { hashRefreshToken, refreshTokenTtlMs, refreshTokenTtlSeconds };
