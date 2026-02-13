import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const storageMock = vi.hoisted(() => ({
  getWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
  appendWorkspaceAuditEvent: vi.fn(),
}));

vi.mock("../../../src/storage/index.js", () => ({
  default: storageMock,
}));

describe("services/workspace", () => {
  const loadWorkspaceModule = async () => {
    vi.resetModules();
    return import("../../../src/services/workspace.js");
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getWorkspace.mockResolvedValue({
      workspaceId: "w0123456789abcdef01234567",
      providers: {
        codex: {
          enabled: true,
          auth: { type: "api_key", value: "x" },
        },
      },
      workspaceSecretHash: crypto.createHash("sha256").update("old").digest("hex"),
      uid: 200001,
      gid: 200001,
      createdAt: 1,
      updatedAt: 1,
    });
    storageMock.saveWorkspace.mockResolvedValue();
    storageMock.appendWorkspaceAuditEvent.mockResolvedValue();
  });

  it("rotateWorkspaceSecret rejette un workspaceId invalide", async () => {
    const { rotateWorkspaceSecret } = await loadWorkspaceModule();
    await expect(rotateWorkspaceSecret("invalid-id")).rejects.toThrow("Invalid workspaceId.");
    expect(storageMock.getWorkspace).not.toHaveBeenCalled();
  });

  it("rotateWorkspaceSecret met à jour le hash avec un secret fourni", async () => {
    const { rotateWorkspaceSecret } = await loadWorkspaceModule();
    const result = await rotateWorkspaceSecret("w0123456789abcdef01234567", {
      workspaceSecret: "my-new-secret",
      actor: "cli",
    });

    expect(result).toEqual({
      workspaceId: "w0123456789abcdef01234567",
      workspaceSecret: "my-new-secret",
    });

    expect(storageMock.saveWorkspace).toHaveBeenCalledTimes(1);
    const savedPayload = storageMock.saveWorkspace.mock.calls[0][1];
    expect(savedPayload.workspaceSecretHash).toBe(
      crypto.createHash("sha256").update("my-new-secret").digest("hex")
    );
    expect(savedPayload.createdAt).toBe(1);
    expect(savedPayload.updatedAt).toBeGreaterThan(1);
    expect(storageMock.appendWorkspaceAuditEvent).toHaveBeenCalledTimes(1);
  });

  it("rotateWorkspaceSecret génère un secret si absent", async () => {
    const { rotateWorkspaceSecret } = await loadWorkspaceModule();
    const result = await rotateWorkspaceSecret("w0123456789abcdef01234567");

    expect(result.workspaceId).toBe("w0123456789abcdef01234567");
    expect(result.workspaceSecret).toMatch(/^[0-9a-f]{64}$/);
    const savedPayload = storageMock.saveWorkspace.mock.calls[0][1];
    expect(savedPayload.workspaceSecretHash).toBe(
      crypto.createHash("sha256").update(result.workspaceSecret).digest("hex")
    );
  });

  it("verifyWorkspaceSecret retourne true/false selon le hash", async () => {
    const { verifyWorkspaceSecret } = await loadWorkspaceModule();
    await expect(
      verifyWorkspaceSecret("w0123456789abcdef01234567", "old")
    ).resolves.toBe(true);
    await expect(
      verifyWorkspaceSecret("w0123456789abcdef01234567", "wrong")
    ).resolves.toBe(false);
  });

  it("validateProvidersConfig valide les cas principaux", async () => {
    const { validateProvidersConfig } = await loadWorkspaceModule();

    expect(validateProvidersConfig(null)).toBe("providers is required.");
    expect(validateProvidersConfig({ unknown: { enabled: true } })).toBe(
      "Unknown provider unknown."
    );
    expect(
      validateProvidersConfig({
        codex: { enabled: true, auth: null },
      })
    ).toBe("Provider codex auth is required when enabled.");
    expect(
      validateProvidersConfig({
        codex: { enabled: true, auth: { type: "setup_token", value: "x" } },
      })
    ).toBe("Provider codex auth type setup_token is not supported.");

    expect(
      validateProvidersConfig({
        codex: { enabled: true, auth: { type: "api_key", value: "x" } },
        claude: { enabled: false, auth: null },
      })
    ).toBeNull();
  });
});
