import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeWorkspaceCredentials } from "../../factories/workspaceFactory.js";

const verifyWorkspaceSecretMock = vi.hoisted(() => vi.fn());
const issueWorkspaceTokensMock = vi.hoisted(() => vi.fn());
const appendAuditLogMock = vi.hoisted(() => vi.fn());
const getWorkspaceUserIdsMock = vi.hoisted(() => vi.fn());

vi.mock("../../../src/storage/index.js", () => ({
  default: {
    listSessions: vi.fn(async () => []),
    getWorkspaceRefreshToken: vi.fn(),
    deleteWorkspaceRefreshToken: vi.fn(),
  },
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
  updateWorkspace: vi.fn(),
  readWorkspaceConfig: vi.fn(),
  verifyWorkspaceSecret: verifyWorkspaceSecretMock,
  getWorkspaceUserIds: getWorkspaceUserIdsMock,
  sanitizeProvidersForResponse: vi.fn((providers) => providers || {}),
  mergeProvidersForUpdate: vi.fn((existing, incoming) => ({ ...existing, ...incoming })),
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
});
