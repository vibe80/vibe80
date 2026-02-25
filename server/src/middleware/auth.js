import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import jwt from "jsonwebtoken";

const homeDir = process.env.HOME || os.homedir();
const isMonoUser = process.env.VIBE80_DEPLOYMENT_MODE === "mono_user";
const defaultDataDirectory = isMonoUser
  ? path.join(homeDir, ".vibe80")
  : "/var/lib/vibe80";
const dataDirectory = process.env.VIBE80_DATA_DIRECTORY || defaultDataDirectory;
const jwtKeyPath = process.env.VIBE80_JWT_KEY_PATH || path.join(dataDirectory, "jwt.key");
const jwtIssuer = process.env.VIBE80_JWT_ISSUER || "vibe80";
const jwtAudience = process.env.VIBE80_JWT_AUDIENCE || "workspace";
const accessTokenTtlSeconds =
  Number(process.env.VIBE80_ACCESS_TOKEN_TTL_SECONDS) || 60 * 60;

const loadJwtKey = () => {
  if (process.env.VIBE80_JWT_KEY) {
    return process.env.VIBE80_JWT_KEY;
  }
  if (fs.existsSync(jwtKeyPath)) {
    return fs.readFileSync(jwtKeyPath, "utf8").trim();
  }
  fs.mkdirSync(path.dirname(jwtKeyPath), { recursive: true, mode: 0o700 });
  const key = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(jwtKeyPath, key, { mode: 0o600 });
  return key;
};

const jwtKey = loadJwtKey();

export const createWorkspaceToken = (workspaceId) =>
  jwt.sign({}, jwtKey, {
    algorithm: "HS256",
    expiresIn: `${accessTokenTtlSeconds}s`,
    subject: workspaceId,
    issuer: jwtIssuer,
    audience: jwtAudience,
    jwtid:
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : crypto.randomBytes(8).toString("hex"),
  });

export const verifyWorkspaceToken = (token) => {
  const payload = jwt.verify(token, jwtKey, {
    issuer: jwtIssuer,
    audience: jwtAudience,
  });
  const workspaceId = payload?.sub;
  if (typeof workspaceId !== "string") {
    throw new Error("Invalid token subject.");
  }
  return workspaceId;
};

export { accessTokenTtlSeconds };

export const isPublicApiRequest = (req) => {
  if (req.method === "POST" && req.path === "/workspaces") {
    return true;
  }
  if (req.method === "POST" && req.path === "/workspaces/login") {
    return true;
  }
  if (req.method === "POST" && req.path === "/workspaces/refresh") {
    return true;
  }
  if (req.method === "POST" && req.path === "/sessions/handoff/consume") {
    return true;
  }
  if (req.method === "GET" && req.path === "/health") {
    return true;
  }
  return false;
};

export function authMiddleware(req, res, next) {
  if (req.method === "OPTIONS" || isPublicApiRequest(req)) {
    next();
    return;
  }
  const header = req.headers.authorization || "";
  const bearerToken = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  const token = bearerToken || queryToken;
  if (!token) {
    res.status(401).json({ error: "Missing workspace token." });
    return;
  }
  try {
    req.workspaceId = verifyWorkspaceToken(token);
  } catch (error) {
    res.status(401).json({ error: "Invalid workspace token." });
    return;
  }
  next();
}
