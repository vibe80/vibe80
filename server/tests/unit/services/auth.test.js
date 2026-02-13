import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getWorkspaceRefreshState: vi.fn(),
  saveWorkspaceRefreshToken: vi.fn(),
}));

vi.mock("../../../src/storage/index.js", () => ({
  default: storageMock,
}));

vi.mock("../../../src/middleware/auth.js", () => ({
  createWorkspaceToken: vi.fn((workspaceId) => `token-${workspaceId}`),
  accessTokenTtlSeconds: 3600,
}));

vi.mock("../../../src/helpers.js", () => ({
  generateId: vi.fn((prefix) => `${prefix}_generated`),
  hashRefreshToken: vi.fn((token) => `hash-${token}`),
  generateRefreshToken: vi.fn(() => "refresh-token"),
}));

describe("services/auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("issueWorkspaceTokens crée un refresh token avec previousTokenHash", async () => {
    storageMock.getWorkspaceRefreshState.mockResolvedValueOnce({
      currentTokenHash: "prev-hash",
    });
    storageMock.saveWorkspaceRefreshToken.mockResolvedValueOnce();

    const { issueWorkspaceTokens } = await import("../../../src/services/auth.js");
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

  it("createMonoAuthToken + consumeMonoAuthToken fonctionne puis invalide le token", async () => {
    const { createMonoAuthToken, consumeMonoAuthToken } = await import(
      "../../../src/services/auth.js"
    );
    const record = createMonoAuthToken("default");

    const firstConsume = consumeMonoAuthToken(record.token);
    expect(firstConsume).toEqual({ ok: true, workspaceId: "default" });

    const secondConsume = consumeMonoAuthToken(record.token);
    expect(secondConsume.ok).toBe(false);
    expect(secondConsume.code).toBe("MONO_AUTH_TOKEN_INVALID");
  });
});
