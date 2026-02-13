import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeWorkspaceCredentials } from "../../factories/workspaceFactory.js";

const verifyWorkspaceSecretMock = vi.hoisted(() => vi.fn());
const issueWorkspaceTokensMock = vi.hoisted(() => vi.fn());
const appendAuditLogMock = vi.hoisted(() => vi.fn());
const getWorkspaceUserIdsMock = vi.hoisted(() => vi.fn());
const readWorkspaceConfigMock = vi.hoisted(() => vi.fn());
const sanitizeProvidersForResponseMock = vi.hoisted(() => vi.fn((providers) => providers || {}));
const updateWorkspaceMock = vi.hoisted(() => vi.fn());
const mergeProvidersForUpdateMock = vi.hoisted(() =>
  vi.fn((existing, incoming) => ({ ...existing, ...incoming }))
);
const storageMock = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  getWorkspaceRefreshToken: vi.fn(),
  deleteWorkspaceRefreshToken: vi.fn(),
}));

vi.mock("../../../src/storage/index.js", () => ({
  default: storageMock,
}));

vi.mock("../../../src/services/auth.js", () => ({
  consumeMonoAuthToken: vi.fn(() => ({ ok: false, code: "MONO_AUTH_TOKEN_INVALID" })),
  issueWorkspaceTokens: issueWorkspaceTokensMock,
}));

vi.mock("../../../src/runtimeStore.js", () => ({
  getExistingSessionRuntime: vi.fn(() => null),
}));

vi.mock("../../../src/services/workspace.js", () => ({
  workspaceIdPattern: /^w[0-9a-f]{24}$/,
  createWorkspace: vi.fn(),
  updateWorkspace: updateWorkspaceMock,
  readWorkspaceConfig: readWorkspaceConfigMock,
  verifyWorkspaceSecret: verifyWorkspaceSecretMock,
  getWorkspaceUserIds: getWorkspaceUserIdsMock,
  sanitizeProvidersForResponse: sanitizeProvidersForResponseMock,
  mergeProvidersForUpdate: mergeProvidersForUpdateMock,
  appendAuditLog: appendAuditLogMock,
}));

describe("routes/workspaces", () => {
  const validCredentials = makeWorkspaceCredentials();

  beforeEach(() => {
    vi.clearAllMocks();
    issueWorkspaceTokensMock.mockResolvedValue({
      workspaceToken: "workspace-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      refreshExpiresIn: 86400,
    });
    getWorkspaceUserIdsMock.mockResolvedValue({ uid: 200001, gid: 200001 });
    appendAuditLogMock.mockResolvedValue();
    storageMock.getWorkspaceRefreshToken.mockResolvedValue(null);
    storageMock.deleteWorkspaceRefreshToken.mockResolvedValue();
    storageMock.listSessions.mockResolvedValue([]);
    readWorkspaceConfigMock.mockResolvedValue({
      providers: {
        codex: { enabled: true },
      },
    });
    updateWorkspaceMock.mockResolvedValue({
      providers: {
        codex: { enabled: true },
      },
    });
  });

  const createRouteHandler = async (path, method) => {
    const { default: workspaceRoutes } = await import("../../../src/routes/workspaces.js");
    const router = workspaceRoutes();
    const layer = router.stack.find(
      (entry) =>
        entry.route &&
        entry.route.path === path &&
        Boolean(entry.route.methods?.[String(method || "").toLowerCase()])
    );
    if (!layer) {
      throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
    }
    return layer.route.stack[0].handle;
  };

  const createMockRes = () => {
    const res = {
      statusCode: 200,
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        return this;
      },
    };
    return res;
  };

  it("POST /api/workspaces/login renvoie 401 si credentials manquants", async () => {
    const handler = await createRouteHandler("/workspaces/login", "post");
    const res = createMockRes();
    await handler({ body: {} }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid workspace credentials.");
  });

  it("POST /api/workspaces/login renvoie 401 si secret invalide", async () => {
    verifyWorkspaceSecretMock.mockResolvedValueOnce(false);
    const handler = await createRouteHandler("/workspaces/login", "post");
    const res = createMockRes();
    await handler(
      {
        body: {
          workspaceId: validCredentials.workspaceId,
          workspaceSecret: "bad-secret",
        },
      },
      res
    );

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe("Invalid workspace credentials.");
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      validCredentials.workspaceId,
      "workspace_login_failed"
    );
  });

  it("POST /api/workspaces/login renvoie 200 si credentials valides", async () => {
    verifyWorkspaceSecretMock.mockResolvedValueOnce(true);
    const handler = await createRouteHandler("/workspaces/login", "post");
    const res = createMockRes();
    await handler(
      {
        body: {
          workspaceId: validCredentials.workspaceId,
          workspaceSecret: "good-secret",
        },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      workspaceToken: "workspace-token",
      refreshToken: "refresh-token",
    });
    expect(getWorkspaceUserIdsMock).toHaveBeenCalledWith(validCredentials.workspaceId);
    expect(issueWorkspaceTokensMock).toHaveBeenCalledWith(validCredentials.workspaceId);
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      validCredentials.workspaceId,
      "workspace_login_success"
    );
  });

  it("POST /api/workspaces/refresh renvoie 400 si refreshToken manquant", async () => {
    const handler = await createRouteHandler("/workspaces/refresh", "post");
    const res = createMockRes();
    await handler({ body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "refreshToken is required." });
  });

  it("POST /api/workspaces/refresh renvoie 401 si refresh token invalide", async () => {
    storageMock.getWorkspaceRefreshToken.mockResolvedValueOnce(null);
    const handler = await createRouteHandler("/workspaces/refresh", "post");
    const res = createMockRes();
    await handler({ body: { refreshToken: "bad-refresh-token" } }, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Invalid refresh token.",
      code: "invalid_refresh_token",
    });
  });

  it("POST /api/workspaces/refresh renvoie 401 si token current expiré", async () => {
    storageMock.getWorkspaceRefreshToken.mockResolvedValueOnce({
      workspaceId: validCredentials.workspaceId,
      kind: "current",
      expiresAt: Date.now() - 1,
    });
    const handler = await createRouteHandler("/workspaces/refresh", "post");
    const res = createMockRes();
    await handler({ body: { refreshToken: "expired-refresh-token" } }, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Refresh token expired.",
      code: "refresh_token_expired",
    });
    expect(storageMock.deleteWorkspaceRefreshToken).toHaveBeenCalledTimes(1);
    expect(storageMock.deleteWorkspaceRefreshToken).toHaveBeenCalledWith(expect.any(String));
  });

  it("POST /api/workspaces/refresh renvoie 401 si token previous réutilisé", async () => {
    storageMock.getWorkspaceRefreshToken.mockResolvedValueOnce({
      workspaceId: validCredentials.workspaceId,
      kind: "previous",
      previousValidUntil: Date.now() - 1,
    });
    const handler = await createRouteHandler("/workspaces/refresh", "post");
    const res = createMockRes();
    await handler({ body: { refreshToken: "reused-refresh-token" } }, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      error: "Refresh token reused.",
      code: "refresh_token_reused",
    });
    expect(storageMock.deleteWorkspaceRefreshToken).toHaveBeenCalledTimes(1);
    expect(storageMock.deleteWorkspaceRefreshToken).toHaveBeenCalledWith(expect.any(String));
  });

  it("POST /api/workspaces/refresh renvoie 200 si refresh token valide", async () => {
    storageMock.getWorkspaceRefreshToken.mockResolvedValueOnce({
      workspaceId: validCredentials.workspaceId,
      kind: "current",
      expiresAt: Date.now() + 60_000,
    });
    const handler = await createRouteHandler("/workspaces/refresh", "post");
    const res = createMockRes();
    await handler({ body: { refreshToken: "valid-refresh-token" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      workspaceToken: "workspace-token",
      refreshToken: "refresh-token",
    });
    expect(issueWorkspaceTokensMock).toHaveBeenCalledWith(validCredentials.workspaceId);
    expect(storageMock.deleteWorkspaceRefreshToken).not.toHaveBeenCalled();
  });

  it("POST /api/workspaces/refresh renvoie 500 en cas d’erreur interne", async () => {
    storageMock.getWorkspaceRefreshToken.mockRejectedValueOnce(new Error("storage down"));
    const handler = await createRouteHandler("/workspaces/refresh", "post");
    const res = createMockRes();
    await handler({ body: { refreshToken: "valid-refresh-token" } }, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: "Failed to refresh workspace token." });
  });

  it("GET /api/workspaces/:workspaceId renvoie 400 si workspaceId invalide", async () => {
    const handler = await createRouteHandler("/workspaces/:workspaceId", "get");
    const res = createMockRes();
    await handler({ params: { workspaceId: "invalid-id" } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Invalid workspaceId." });
  });

  it("GET /api/workspaces/:workspaceId renvoie 403 si workspaceId ne correspond pas au token", async () => {
    const handler = await createRouteHandler("/workspaces/:workspaceId", "get");
    const res = createMockRes();
    await handler(
      {
        params: { workspaceId: validCredentials.workspaceId },
        workspaceId: "wffffffffffffffffffffffff",
      },
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden." });
  });

  it("GET /api/workspaces/:workspaceId renvoie 200 si accès autorisé", async () => {
    const handler = await createRouteHandler("/workspaces/:workspaceId", "get");
    const res = createMockRes();
    await handler(
      {
        params: { workspaceId: validCredentials.workspaceId },
        workspaceId: validCredentials.workspaceId,
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      workspaceId: validCredentials.workspaceId,
      providers: {
        codex: { enabled: true },
      },
    });
    expect(readWorkspaceConfigMock).toHaveBeenCalledWith(validCredentials.workspaceId);
    expect(sanitizeProvidersForResponseMock).toHaveBeenCalled();
  });

  it("GET /api/workspaces/:workspaceId renvoie 400 si la lecture échoue", async () => {
    readWorkspaceConfigMock.mockRejectedValueOnce(new Error("Workspace not found."));
    const handler = await createRouteHandler("/workspaces/:workspaceId", "get");
    const res = createMockRes();
    await handler(
      {
        params: { workspaceId: validCredentials.workspaceId },
        workspaceId: validCredentials.workspaceId,
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Workspace not found." });
  });

  it("PATCH /api/workspaces/:workspaceId renvoie 400 si workspaceId invalide", async () => {
    const handler = await createRouteHandler("/workspaces/:workspaceId", "patch");
    const res = createMockRes();
    await handler({ params: { workspaceId: "invalid-id" }, body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Invalid workspaceId." });
  });

  it("PATCH /api/workspaces/:workspaceId renvoie 403 si accès interdit", async () => {
    const handler = await createRouteHandler("/workspaces/:workspaceId", "patch");
    const res = createMockRes();
    await handler(
      {
        params: { workspaceId: validCredentials.workspaceId },
        workspaceId: "wffffffffffffffffffffffff",
        body: {},
      },
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: "Forbidden." });
  });

  it("PATCH /api/workspaces/:workspaceId renvoie 403 si provider actif en session", async () => {
    mergeProvidersForUpdateMock.mockReturnValueOnce({
      codex: { enabled: false },
    });
    readWorkspaceConfigMock.mockResolvedValueOnce({
      providers: {
        codex: { enabled: true },
      },
    });
    storageMock.listSessions.mockResolvedValueOnce([
      { sessionId: "s1", activeProvider: "codex" },
    ]);
    const handler = await createRouteHandler("/workspaces/:workspaceId", "patch");
    const res = createMockRes();
    await handler(
      {
        params: { workspaceId: validCredentials.workspaceId },
        workspaceId: validCredentials.workspaceId,
        body: { providers: { codex: { enabled: false } } },
      },
      res
    );

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({
      error: "Provider cannot be disabled: active sessions use it.",
    });
    expect(updateWorkspaceMock).not.toHaveBeenCalled();
  });

  it("PATCH /api/workspaces/:workspaceId renvoie 200 en succès", async () => {
    mergeProvidersForUpdateMock.mockReturnValueOnce({
      codex: { enabled: true },
    });
    updateWorkspaceMock.mockResolvedValueOnce({
      providers: {
        codex: { enabled: true },
      },
    });
    const handler = await createRouteHandler("/workspaces/:workspaceId", "patch");
    const res = createMockRes();
    await handler(
      {
        params: { workspaceId: validCredentials.workspaceId },
        workspaceId: validCredentials.workspaceId,
        body: { providers: { codex: { enabled: true } } },
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      workspaceId: validCredentials.workspaceId,
      providers: {
        codex: { enabled: true },
      },
    });
    expect(updateWorkspaceMock).toHaveBeenCalledWith(validCredentials.workspaceId, {
      codex: { enabled: true },
    });
  });

  it("PATCH /api/workspaces/:workspaceId renvoie 400 si update échoue", async () => {
    updateWorkspaceMock.mockRejectedValueOnce(new Error("Failed to update workspace."));
    const handler = await createRouteHandler("/workspaces/:workspaceId", "patch");
    const res = createMockRes();
    await handler(
      {
        params: { workspaceId: validCredentials.workspaceId },
        workspaceId: validCredentials.workspaceId,
        body: { providers: { codex: { enabled: true } } },
      },
      res
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Failed to update workspace." });
  });
});
