import crypto from "crypto";
import path from "path";
import dockerNames from "docker-names";

export const generateId = (prefix) =>
  `${prefix}${crypto.randomBytes(12).toString("hex")}`;

export const generateSessionName = () => dockerNames.getRandomName();

export const hashRefreshToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

export const generateRefreshToken = () =>
  crypto.randomBytes(32).toString("hex");

export const createMessageId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString("hex");

export const createDebugId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : crypto.randomBytes(8).toString("hex");

export const parseCommandArgs = (input = "") => {
  if (!input) {
    return [];
  }
  const matches = input.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return matches.map((item) =>
    item.startsWith("\"") && item.endsWith("\"")
      ? item.slice(1, -1)
      : item.startsWith("'") && item.endsWith("'")
        ? item.slice(1, -1)
        : item
  );
};

export const sanitizeFilename = (originalName) =>
  path.basename(originalName || "attachment");

export const getSessionTmpDir = (sessionDir) => path.join(sessionDir, "tmp");

export const formatDebugPayload = (payload, maxBody = 2000) => {
  if (payload == null) return null;
  if (Buffer.isBuffer(payload)) {
    const text = payload.toString("utf8");
    if (text.length > maxBody) {
      return `${text.slice(0, maxBody)}…(truncated)`;
    }
    return text;
  }
  if (typeof payload === "string") {
    if (payload.length > maxBody) {
      return `${payload.slice(0, maxBody)}…(truncated)`;
    }
    return payload;
  }
  if (typeof payload === "object") {
    try {
      const json = JSON.stringify(payload);
      if (json.length > maxBody) {
        return `${json.slice(0, maxBody)}…(truncated)`;
      }
      return json;
    } catch {
      return "[Unserializable object]";
    }
  }
  return String(payload);
};

export const classifySessionCreationError = (error) => {
  const rawMessage = (error?.message || "").trim();
  const message = rawMessage.toLowerCase();
  if (
    message.includes("authentication failed") ||
    message.includes("invalid username or password") ||
    message.includes("http basic: access denied") ||
    message.includes("could not read username") ||
    message.includes("fatal: authentication")
  ) {
    return {
      status: 403,
      error: `Echec d'authentification Git.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("permission denied (publickey)") || message.includes("publickey")) {
    return {
      status: 403,
      error: `Echec d'authentification SSH (cle).${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("repository not found") || message.includes("not found")) {
    return {
      status: 404,
      error: `Depot Git introuvable.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("could not resolve host") || message.includes("name or service not known")) {
    return {
      status: 400,
      error: `Hote Git introuvable.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  if (message.includes("connection timed out") || message.includes("operation timed out")) {
    return {
      status: 504,
      error: `Connexion au depot Git expiree.${rawMessage ? ` ${rawMessage}` : ""}`,
    };
  }
  return {
    status: 500,
    error: rawMessage || "Failed to create session.",
  };
};
