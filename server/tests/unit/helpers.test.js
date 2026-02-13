import { describe, expect, it, vi } from "vitest";

vi.mock("docker-names", () => ({
  default: {
    getRandomName: vi.fn(() => "calm-turing"),
  },
}));

import {
  classifySessionCreationError,
  createDebugId,
  createMessageId,
  formatDebugPayload,
  generateId,
  generateRefreshToken,
  generateSessionName,
  getSessionTmpDir,
  hashRefreshToken,
  parseCommandArgs,
  sanitizeFilename,
} from "../../src/helpers.js";

describe("helpers", () => {
  it("generateId préfixe correctement un id hexadécimal", () => {
    const id = generateId("w");
    expect(id).toMatch(/^w[0-9a-f]{24}$/);
  });

  it("generateSessionName retourne un nom docker", () => {
    expect(generateSessionName()).toBe("calm-turing");
  });

  it("hashRefreshToken calcule un sha256 stable", () => {
    expect(hashRefreshToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("generateRefreshToken retourne 64 chars hex", () => {
    expect(generateRefreshToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("createMessageId et createDebugId retournent des identifiants non vides", () => {
    expect(createMessageId().length).toBeGreaterThan(0);
    expect(createDebugId().length).toBeGreaterThan(0);
  });

  it("parseCommandArgs gère guillemets simples et doubles", () => {
    expect(parseCommandArgs(`git commit -m "hello world" 'and more'`)).toEqual([
      "git",
      "commit",
      "-m",
      "hello world",
      "and more",
    ]);
    expect(parseCommandArgs("")).toEqual([]);
  });

  it("sanitizeFilename supprime le path", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("")).toBe("attachment");
  });

  it("getSessionTmpDir construit le chemin tmp", () => {
    expect(getSessionTmpDir("/tmp/session-1")).toContain("/tmp/session-1");
    expect(getSessionTmpDir("/tmp/session-1")).toMatch(/tmp$/);
  });

  it("formatDebugPayload gère string/buffer/object/troncature", () => {
    expect(formatDebugPayload("abc")).toBe("abc");
    expect(formatDebugPayload(Buffer.from("abc", "utf8"))).toBe("abc");
    expect(formatDebugPayload({ a: 1 })).toBe("{\"a\":1}");
    expect(formatDebugPayload("abcdef", 3)).toBe("abc…(truncated)");
    expect(formatDebugPayload(null)).toBeNull();
  });

  it("classifySessionCreationError classe les erreurs connues", () => {
    expect(
      classifySessionCreationError(new Error("fatal: Authentication failed for repo"))
    ).toMatchObject({ status: 403 });
    expect(
      classifySessionCreationError(new Error("Permission denied (publickey)"))
    ).toMatchObject({ status: 403 });
    expect(
      classifySessionCreationError(new Error("repository not found"))
    ).toMatchObject({ status: 404 });
    expect(
      classifySessionCreationError(new Error("Could not resolve host github.com"))
    ).toMatchObject({ status: 400 });
    expect(
      classifySessionCreationError(new Error("Connection timed out"))
    ).toMatchObject({ status: 504 });
    expect(classifySessionCreationError(new Error("boom"))).toMatchObject({ status: 500 });
  });
});
