import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getWorkspaceRefreshState: vi.fn(),
  saveWorkspaceRefreshToken: vi.fn(),
}));
const idSeq = vi.hoisted(() => ({ value: 0 }));

vi.mock("../../../src/storage/index.js", () => ({
  default: storageMock,
}));

vi.mock("../../../src/middleware/auth.js", () => ({
  createWorkspaceToken: vi.fn((workspaceId) => `token-${workspaceId}`),
  accessTokenTtlSeconds: 3600,
}));

vi.mock("../../../src/helpers.js", () => ({
  generateId: vi.fn((prefix) => {
    idSeq.value += 1;
    return `${prefix}_generated_${idSeq.value}`;
  }),
  hashRefreshToken: vi.fn((token) => `hash-${token}`),
  generateRefreshToken: vi.fn(() => "refresh-token"),
}));

describe("services/auth", () => {
  const loadAuthModule = async () => {
    vi.resetModules();
    return import("../../../src/services/auth.js");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    idSeq.value = 0;
    vi.useRealTimers();
    delete process.env.MONO_AUTH_TOKEN_TTL_MS;
  });

  it("issueWorkspaceTokens crée un refresh token avec previousTokenHash", async () => {
    storageMock.getWorkspaceRefreshState.mockResolvedValueOnce({
      currentTokenHash: "prev-hash",
    });
    storageMock.saveWorkspaceRefreshToken.mockResolvedValueOnce();

    const { issueWorkspaceTokens } = await loadAuthModule();
    const result = await issueWorkspaceTokens("w123");

    expect(result.workspaceToken).toBe("token-w123");
    expect(result.refreshToken).toBe("refresh-token");
    expect(result.expiresIn).toBe(3600);
    expect(typeof result.refreshExpiresIn).toBe("number");

    expect(storageMock.saveWorkspaceRefreshToken).toHaveBeenCalledTimes(1);
    const call = storageMock.saveWorkspaceRefreshToken.mock.calls[0];
    expect(call[0]).toBe("w123");
    expect(call[1]).toBe("hash-refresh-token");
    expect(call[3]).toBeGreaterThan(0);
    expect(call[4]).toMatchObject({
      previousTokenHash: "prev-hash",
    });
  });

  it("issueWorkspaceTokens sans ancien token n’enregistre pas previousTokenHash", async () => {
    storageMock.getWorkspaceRefreshState.mockResolvedValueOnce(null);
    storageMock.saveWorkspaceRefreshToken.mockResolvedValueOnce();
    const { issueWorkspaceTokens } = await loadAuthModule();

    await issueWorkspaceTokens("w456");

    const call = storageMock.saveWorkspaceRefreshToken.mock.calls[0];
    expect(call[4]).toMatchObject({
      previousTokenHash: null,
      previousValidUntil: null,
    });
  });

  it("createMonoAuthToken + consumeMonoAuthToken fonctionne puis invalide le token", async () => {
    const { createMonoAuthToken, consumeMonoAuthToken } = await loadAuthModule();
    const record = createMonoAuthToken("default");

    const firstConsume = consumeMonoAuthToken(record.token);
    expect(firstConsume).toEqual({ ok: true, workspaceId: "default" });

    const secondConsume = consumeMonoAuthToken(record.token);
    expect(secondConsume.ok).toBe(false);
    expect(secondConsume.code).toBe("MONO_AUTH_TOKEN_INVALID");
  });

  it("consumeMonoAuthToken retourne INVALID pour un token inconnu", async () => {
    const { consumeMonoAuthToken } = await loadAuthModule();
    const result = consumeMonoAuthToken("unknown-token");
    expect(result).toEqual({ ok: false, code: "MONO_AUTH_TOKEN_INVALID" });
  });

  it("consumeMonoAuthToken retourne EXPIRED pour un token expiré", async () => {
    vi.useFakeTimers();
    process.env.MONO_AUTH_TOKEN_TTL_MS = "1";
    const { createMonoAuthToken, consumeMonoAuthToken } = await loadAuthModule();
    const record = createMonoAuthToken("default");
    vi.advanceTimersByTime(10);

    const result = consumeMonoAuthToken(record.token);
    expect(result).toEqual({ ok: false, code: "MONO_AUTH_TOKEN_EXPIRED" });
  });

  it("cleanupHandoffTokens supprime les tokens utilisés/expirés", async () => {
    vi.useFakeTimers();
    const {
      createHandoffToken,
      cleanupHandoffTokens,
      handoffTokens,
    } = await loadAuthModule();
    handoffTokens.clear();
    const expired = createHandoffToken({ sessionId: "s-exp", workspaceId: "w1" });
    const used = createHandoffToken({ sessionId: "s-used", workspaceId: "w1" });
    const willExpire = createHandoffToken({ sessionId: "s-exp", workspaceId: "w1" });
    used.usedAt = Date.now();
    vi.advanceTimersByTime(3 * 60 * 1000);
    const fresh = createHandoffToken({ sessionId: "s-fresh", workspaceId: "w1" });

    cleanupHandoffTokens();

    expect(handoffTokens.has(expired.token)).toBe(false);
    expect(handoffTokens.has(used.token)).toBe(false);
    expect(handoffTokens.has(willExpire.token)).toBe(false);
    expect(handoffTokens.has(fresh.token)).toBe(true);
  });

  it("cleanupMonoAuthTokens purge les tokens expirés", async () => {
    vi.useFakeTimers();
    process.env.MONO_AUTH_TOKEN_TTL_MS = "1";
    const {
      createMonoAuthToken,
      cleanupMonoAuthTokens,
      consumeMonoAuthToken,
    } = await loadAuthModule();
    const token = createMonoAuthToken("default").token;
    vi.advanceTimersByTime(10);

    cleanupMonoAuthTokens();

    expect(consumeMonoAuthToken(token)).toEqual({
      ok: false,
      code: "MONO_AUTH_TOKEN_INVALID",
    });
  });
});
