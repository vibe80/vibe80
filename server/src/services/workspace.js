import crypto from "crypto";
import path from "path";
import os from "os";
import {
  runCommand,
  runCommandOutput,
  runAsCommand,
  runAsCommandOutput,
} from "../runAs.js";
import storage from "../storage/index.js";
import { generateId } from "../helpers.js";
import { logDebug } from "../middleware/debug.js";

const deploymentMode = process.env.DEPLOYMENT_MODE;
const isMonoUser = deploymentMode === "mono_user";
const workspaceHomeBase = process.env.WORKSPACE_HOME_BASE || "/home";
const workspaceRootBase = process.env.WORKSPACE_ROOT_DIRECTORY || "/workspaces";
const workspaceRootName = "vibe80_workspace";
const monoUserWorkspaceDir =
  process.env.MONO_USER_WORKSPACE_DIR || path.join(os.homedir(), workspaceRootName);
const workspaceSessionsDirName = "sessions";
const rootHelperPath = process.env.VIBE80_ROOT_HELPER || "/usr/local/bin/vibe80-root";
const sudoPath = process.env.VIBE80_SUDO_PATH || "sudo";
const workspaceUidMin = Number.parseInt(process.env.WORKSPACE_UID_MIN, 10) || 200000;
const workspaceUidMax = Number.parseInt(process.env.WORKSPACE_UID_MAX, 10) || 999999999;
const workspaceUserExistsCache = new Map();

export const workspaceIdPattern = isMonoUser ? /^default$/ : /^w[0-9a-f]{24}$/;

export { isMonoUser };

const runRootCommand = (args, options = {}) => {
  if (isMonoUser) {
    throw new Error("Root helpers are not available in mono_user mode.");
  }
  return runCommand(sudoPath, ["-n", rootHelperPath, ...args], options);
};

const runWorkspaceStatOutput = async (
  workspaceId,
  targetPath,
  { gnuFormat, bsdFormat, options = {} }
) => {
  try {
    return await runAsCommandOutput(
      workspaceId,
      "/usr/bin/stat",
      ["-c", gnuFormat, targetPath],
      options
    );
  } catch {
    return runAsCommandOutput(
      workspaceId,
      "/usr/bin/stat",
      ["-f", bsdFormat, targetPath],
      options
    );
  }
};

const runHostStatOutput = async (targetPath, { gnuFormat, bsdFormat }) => {
  try {
    return await runCommandOutput("/usr/bin/stat", ["-c", gnuFormat, targetPath]);
  } catch {
    return runCommandOutput("/usr/bin/stat", ["-f", bsdFormat, targetPath]);
  }
};

export const getWorkspacePaths = (workspaceId) => {
  const home = isMonoUser ? os.homedir() : path.join(workspaceHomeBase, workspaceId);
  const root = isMonoUser
    ? monoUserWorkspaceDir
    : path.join(workspaceRootBase, workspaceId);
  const sessionsDir = path.join(root, workspaceSessionsDirName);
  return {
    homeDir: home,
    rootDir: root,
    sessionsDir,
  };
};

export const getWorkspaceSshPaths = (workspaceHome) => {
  const sshDir = path.join(workspaceHome, ".ssh");
  return {
    sshDir,
    knownHostsPath: path.join(sshDir, "known_hosts"),
  };
};

export const getWorkspaceAuthPaths = (workspaceHome) => ({
  codexDir: path.join(workspaceHome, ".codex"),
  codexAuthPath: path.join(workspaceHome, ".codex", "auth.json"),
  claudeAuthPath: path.join(workspaceHome, ".claude.json"),
  claudeDir: path.join(workspaceHome, ".claude"),
  claudeCredentialsPath: path.join(workspaceHome, ".claude", ".credentials.json"),
});

export const ensureWorkspaceDir = async (workspaceId, dirPath, mode = 0o700) => {
  await runAsCommand(workspaceId, "/bin/mkdir", ["-p", dirPath]);
  await runAsCommand(workspaceId, "/bin/chmod", [mode.toString(8), dirPath]);
};

export const writeWorkspaceFile = async (workspaceId, filePath, content, mode = 0o600) => {
  await runAsCommand(workspaceId, "/usr/bin/tee", [filePath], { input: content });
  await runAsCommand(workspaceId, "/bin/chmod", [mode.toString(8), filePath]);
};

export const appendWorkspaceFile = async (workspaceId, filePath, content, mode = 0o600) => {
  await runAsCommand(workspaceId, "/usr/bin/tee", ["-a", filePath], { input: content });
  await runAsCommand(workspaceId, "/bin/chmod", [mode.toString(8), filePath]);
};

export const workspaceUserExists = async (workspaceId) => {
  if (isMonoUser) {
    return workspaceId === "default";
  }
  try {
    await runCommandOutput("getent", ["passwd", workspaceId]);
    return true;
  } catch {
    return false;
  }
};

export const listWorkspaceEntries = async (workspaceId, dirPath) => {
  let output;
  try {
    output = await runAsCommandOutput(
      workspaceId,
      "/usr/bin/find",
      [dirPath, "-maxdepth", "1", "-mindepth", "1", "-printf", "%y\t%f\0"],
      { binary: true }
    );
    const parsed = output
      .toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((line) => {
        const [type, name] = line.split("\t");
        return { type, name };
      })
      .filter((entry) => entry.type && entry.name);
    if (parsed.length > 0) {
      return parsed;
    }
  } catch (error) {
    logDebug("[debug] listWorkspaceEntries failed", {
      workspaceId,
      dirPath,
      error: error?.message || error,
    });
  }

  try {
    const fallbackOutput = await runAsCommandOutput(workspaceId, "/usr/bin/find", [
      dirPath,
      "-maxdepth",
      "1",
      "-mindepth",
      "1",
      "-printf",
      "%y\t%f\n",
    ]);
    const parsed = fallbackOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [type, name] = line.split("\t");
        return { type, name };
      })
      .filter((entry) => entry.type && entry.name);
    if (parsed.length > 0) {
      return parsed;
    }
    if (output) {
      logDebug("[debug] listWorkspaceEntries empty parse", {
        workspaceId,
        dirPath,
        sample: output.toString("utf8").slice(0, 200),
      });
    }
  } catch (error) {
    logDebug("[debug] listWorkspaceEntries fallback failed", {
      workspaceId,
      dirPath,
      error: error?.message || error,
    });
  }
  return [];
};

export const getWorkspaceStat = async (workspaceId, targetPath, options = {}) => {
  const output = await runWorkspaceStatOutput(workspaceId, targetPath, {
    gnuFormat: "%f\t%s\t%a",
    bsdFormat: "%HT\t%z\t%Lp",
    options,
  });
  const [typeOrMode, sizeRaw, modeRaw] = output.trim().split("\t");
  const modeValue = Number.parseInt(typeOrMode, 16);
  const typeBits = Number.isFinite(modeValue) ? modeValue & 0o170000 : null;
  let type = "";
  if (Number.isFinite(typeBits)) {
    if (typeBits === 0o100000) {
      type = "regular";
    } else if (typeBits === 0o040000) {
      type = "directory";
    } else if (typeBits === 0o120000) {
      type = "symlink";
    } else {
      type = "other";
    }
  } else {
    const normalizedType = String(typeOrMode || "").toLowerCase();
    if (normalizedType.includes("regular")) {
      type = "regular";
    } else if (normalizedType.includes("directory")) {
      type = "directory";
    } else if (normalizedType.includes("symbolic")) {
      type = "symlink";
    } else if (normalizedType) {
      type = "other";
    }
  }
  return {
    type,
    size: Number.parseInt(sizeRaw, 10),
    mode: String(modeRaw || ""),
  };
};

export const workspacePathExists = async (workspaceId, targetPath) => {
  try {
    await runWorkspaceStatOutput(workspaceId, targetPath, {
      gnuFormat: "%F",
      bsdFormat: "%HT",
    });
    return true;
  } catch {
    return false;
  }
};

export const readWorkspaceFileBuffer = async (
  workspaceId,
  filePath,
  maxBytes,
  options = {}
) => {
  const stat = await getWorkspaceStat(workspaceId, filePath, options);
  if (!stat.type || !stat.type.startsWith("regular")) {
    console.warn("readWorkspaceFileBuffer: non-regular path", {
      workspaceId,
      filePath,
      type: stat.type || null,
      size: stat.size,
      mode: stat.mode,
    });
    throw new Error("Path is not a file.");
  }
  if (Number.isFinite(maxBytes) && stat.size > maxBytes) {
    const buffer = await runAsCommandOutput(
      workspaceId,
      "/usr/bin/head",
      ["-c", String(maxBytes), filePath],
      { binary: true, ...options }
    );
    return { buffer, truncated: true };
  }
  const buffer = await runAsCommandOutput(
    workspaceId,
    "/bin/cat",
    [filePath],
    { binary: true, ...options }
  );
  return { buffer, truncated: false };
};

export const writeWorkspaceFilePreserveMode = async (workspaceId, filePath, content) => {
  const stat = await getWorkspaceStat(workspaceId, filePath);
  if (!stat.type || !stat.type.startsWith("regular")) {
    throw new Error("Path is not a file.");
  }
  await runAsCommand(workspaceId, "/usr/bin/tee", [filePath], { input: content });
  if (stat.mode) {
    await runAsCommand(workspaceId, "/bin/chmod", [stat.mode, filePath]);
  }
};

export const getWorkspaceUserIds = async (workspaceId) => {
  if (isMonoUser) {
    const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
    const gid = typeof process.getgid === "function" ? process.getgid() : os.userInfo().gid;
    const ids = { uid, gid };
    await storage.saveWorkspaceUserIds(workspaceId, ids);
    return ids;
  }
  const workspaceRecord = await storage.getWorkspace(workspaceId);
  let ids = null;
  if (Number.isFinite(workspaceRecord?.uid) && Number.isFinite(workspaceRecord?.gid)) {
    ids = {
      uid: Number(workspaceRecord.uid),
      gid: Number(workspaceRecord.gid),
    };
  }
  if (!ids) {
    const cached = await storage.getWorkspaceUserIds(workspaceId);
    if (Number.isFinite(cached?.uid) && Number.isFinite(cached?.gid)) {
      ids = {
        uid: Number(cached.uid),
        gid: Number(cached.gid),
      };
      if (workspaceRecord) {
        await persistWorkspaceRecord({
          workspaceId,
          providers: workspaceRecord.providers || {},
          ids,
          existing: workspaceRecord,
        });
      }
    }
  }
  if (!ids) {
    ids = await recoverWorkspaceIds(workspaceId);
  }
  await storage.saveWorkspaceUserIds(workspaceId, ids);
  return ids;
};

export const buildWorkspaceEnv = (workspaceId) => {
  const home = isMonoUser ? os.homedir() : path.join(workspaceHomeBase, workspaceId);
  const user = isMonoUser ? os.userInfo().username : workspaceId;
  return {
    ...process.env,
    HOME: home,
    USER: user,
    LOGNAME: user,
  };
};

export const appendAuditLog = async (workspaceId, event, details = {}) => {
  try {
    const entry = {
      ts: Date.now(),
      event,
      workspaceId,
      ...details,
    };
    await storage.appendWorkspaceAuditEvent(workspaceId, entry);
  } catch {
    // Avoid failing requests on audit errors.
  }
};

const allowedAuthTypes = new Set(["api_key", "auth_json_b64", "setup_token"]);
const allowedProviders = new Set(["codex", "claude"]);
const providerAuthTypes = {
  codex: new Set(["api_key", "auth_json_b64"]),
  claude: new Set(["api_key", "setup_token"]),
};

export const validateProvidersConfig = (providers) => {
  if (!providers || typeof providers !== "object") {
    return "providers is required.";
  }
  let enabledCount = 0;
  for (const [provider, config] of Object.entries(providers)) {
    if (!allowedProviders.has(provider)) {
      return `Unknown provider ${provider}.`;
    }
    if (!config || typeof config !== "object") {
      return `Invalid provider config for ${provider}.`;
    }
    if (typeof config.enabled !== "boolean") {
      return `Provider ${provider} must include enabled boolean.`;
    }
    if (config.enabled) {
      enabledCount += 1;
    }
    if (config.enabled && !config.auth) {
      return `Provider ${provider} auth is required when enabled.`;
    }
    if (config.auth != null) {
      if (typeof config.auth !== "object") {
        return `Provider ${provider} auth must be an object.`;
      }
      const { type, value } = config.auth;
      if (!allowedAuthTypes.has(type)) {
        return `Provider ${provider} auth type is invalid.`;
      }
      const providerTypes = providerAuthTypes[provider];
      if (providerTypes && !providerTypes.has(type)) {
        return `Provider ${provider} auth type ${type} is not supported.`;
      }
      if (typeof value !== "string" || !value.trim()) {
        return `Provider ${provider} auth value is required.`;
      }
    }
  }
  if (enabledCount === 0) {
    return "At least one provider must be enabled.";
  }
  return null;
};

export const sanitizeProvidersForResponse = (providers = {}) => {
  const sanitized = {};
  for (const [provider, config] of Object.entries(providers || {})) {
    if (!config || typeof config !== "object") {
      continue;
    }
    sanitized[provider] = {
      enabled: Boolean(config.enabled),
      auth: config.auth?.type ? { type: config.auth.type } : null,
    };
  }
  return sanitized;
};

const hasAuthValue = (auth) =>
  Boolean(auth && typeof auth.value === "string" && auth.value.trim());

export const mergeProvidersForUpdate = (existingProviders = {}, incomingProviders = {}) => {
  const merged = { ...existingProviders };
  for (const [provider, config] of Object.entries(incomingProviders)) {
    if (!config || typeof config !== "object") {
      continue;
    }
    const previous = existingProviders?.[provider] || {};
    const previousAuthType = previous?.auth?.type || null;
    const incomingAuthType = config.auth?.type || previousAuthType || null;
    const authTypeChanged =
      incomingAuthType && previousAuthType && incomingAuthType !== previousAuthType;
    const nextAuthValue = hasAuthValue(config.auth)
      ? config.auth.value
      : previous?.auth?.value || "";
    if ((authTypeChanged || config.enabled) && !nextAuthValue) {
      throw new Error(`Provider ${provider} auth value is required.`);
    }
    merged[provider] = {
      enabled: Boolean(config.enabled),
      auth: incomingAuthType
        ? {
            type: incomingAuthType,
            value: nextAuthValue,
          }
        : null,
    };
  }
  return merged;
};

export const listEnabledProviders = (providers) =>
  Object.entries(providers || {})
    .filter(([, config]) => config?.enabled)
    .map(([name]) => name);

export const pickDefaultProvider = (providers) => {
  if (!providers || providers.length === 0) {
    return null;
  }
  if (providers.includes("codex")) {
    return "codex";
  }
  return providers[0];
};

export const ensureWorkspaceUser = async (workspaceId, homeDirPath, ids = null) => {
  if (isMonoUser) {
    return;
  }
  try {
    await runCommandOutput("getent", ["passwd", workspaceId]);
    return;
  } catch {
    // continue
  }
  if (ids?.gid) {
    try {
      await runCommandOutput("getent", ["group", String(ids.gid)]);
    } catch {
      await runCommand("groupadd", ["-g", String(ids.gid), workspaceId]);
    }
  }
  const userArgs = ["-m", "-d", homeDirPath, "-s", "/bin/bash"];
  if (ids?.uid) {
    userArgs.push("-u", String(ids.uid));
  }
  if (ids?.gid) {
    userArgs.push("-g", String(ids.gid));
  }
  userArgs.push(workspaceId);
  await runCommand("useradd", userArgs);
};

export const ensureWorkspaceUserExists = async (workspaceId) => {
  if (isMonoUser) {
    return;
  }
  if (workspaceUserExistsCache.get(workspaceId)) {
    return;
  }
  const ids = await getWorkspaceUserIds(workspaceId);
  try {
    await runCommandOutput("getent", ["passwd", workspaceId]);
    workspaceUserExistsCache.set(workspaceId, true);
    return;
  } catch {
    // continue
  }
  try {
    await runRootCommand([
      "create-workspace",
      "--workspace-id",
      workspaceId,
      "--uid",
      String(ids.uid),
      "--gid",
      String(ids.gid),
    ]);
  } catch (error) {
    const homeDir = getWorkspacePaths(workspaceId).homeDir;
    await ensureWorkspaceUser(workspaceId, homeDir, ids);
  }
  const workspaceRecord = await storage.getWorkspace(workspaceId);
  if (workspaceRecord?.providers) {
    await writeWorkspaceProviderAuth(workspaceId, workspaceRecord.providers);
  }
  await storage.saveWorkspaceUserIds(workspaceId, ids);
  await appendAuditLog(workspaceId, "workspace_user_recreated", {
    uid: ids.uid,
    gid: ids.gid,
  });
  await appendAuditLog(workspaceId, "workspace_auth_reconciled_after_recreate");
  workspaceUserExistsCache.set(workspaceId, true);
};

const allocateWorkspaceIds = async () => {
  const min = Math.max(1, workspaceUidMin);
  const max = Math.max(min, workspaceUidMax);
  const attempts = 1000;
  for (let i = 0; i < attempts; i += 1) {
    const candidate = await storage.getNextWorkspaceUid();
    if (candidate < min || candidate > max) {
      continue;
    }
    try {
      await runCommandOutput("getent", ["passwd", String(candidate)]);
      continue;
    } catch {
      // free uid
    }
    return { uid: candidate, gid: candidate };
  }
  throw new Error("Unable to allocate a workspace uid/gid.");
};

const hashWorkspaceSecret = (workspaceSecret) =>
  crypto.createHash("sha256").update(String(workspaceSecret || ""), "utf8").digest("hex");

const compareWorkspaceSecretHash = (workspaceSecret, expectedHash) => {
  if (typeof expectedHash !== "string" || !expectedHash) {
    return false;
  }
  const computed = hashWorkspaceSecret(workspaceSecret);
  const computedBuffer = Buffer.from(computed, "hex");
  const expectedBuffer = Buffer.from(expectedHash, "hex");
  if (computedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(computedBuffer, expectedBuffer);
};

const toWorkspaceConfigPayload = (record) => ({
  workspaceId: record.workspaceId,
  providers: record.providers || {},
  uid: Number.isFinite(record.uid) ? record.uid : null,
  gid: Number.isFinite(record.gid) ? record.gid : null,
  createdAt: Number.isFinite(record.createdAt) ? record.createdAt : null,
  updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : null,
});

const persistWorkspaceRecord = async ({
  workspaceId,
  providers,
  ids = null,
  workspaceSecretHash,
  existing = null,
}) => {
  const now = Date.now();
  const payload = {
    workspaceId,
    providers: providers || existing?.providers || {},
    uid: Number.isFinite(ids?.uid) ? ids.uid : existing?.uid ?? null,
    gid: Number.isFinite(ids?.gid) ? ids.gid : existing?.gid ?? null,
    workspaceSecretHash:
      typeof workspaceSecretHash === "string" && workspaceSecretHash
        ? workspaceSecretHash
        : existing?.workspaceSecretHash || null,
    createdAt: Number.isFinite(existing?.createdAt) ? existing.createdAt : now,
    updatedAt: now,
  };
  await storage.saveWorkspace(workspaceId, payload);
  return payload;
};

const getWorkspaceRecord = async (workspaceId) => {
  const record = await storage.getWorkspace(workspaceId);
  if (!record || typeof record !== "object") {
    throw new Error("Workspace not found.");
  }
  return record;
};

const recoverWorkspaceIds = async (workspaceId) => {
  if (isMonoUser) {
    const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
    const gid = typeof process.getgid === "function" ? process.getgid() : os.userInfo().gid;
    return { uid, gid };
  }
  const homeDir = path.join(workspaceHomeBase, workspaceId);
  const workspaceRecord = await storage.getWorkspace(workspaceId);
  let uid = Number.isFinite(workspaceRecord?.uid) ? Number(workspaceRecord.uid) : null;
  let gid = Number.isFinite(workspaceRecord?.gid) ? Number(workspaceRecord.gid) : null;
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
    try {
      const output = await runWorkspaceStatOutput(workspaceId, homeDir, {
        gnuFormat: "%u\t%g",
        bsdFormat: "%u\t%g",
      });
      const [uidRaw, gidRaw] = output.trim().split("\t");
      if (!Number.isFinite(uid)) {
        uid = Number(uidRaw);
      }
      if (!Number.isFinite(gid)) {
        gid = Number(gidRaw);
      }
    } catch {
      try {
        const output = await runHostStatOutput(homeDir, {
          gnuFormat: "%u\t%g",
          bsdFormat: "%u\t%g",
        });
        const [uidRaw, gidRaw] = output.trim().split("\t");
        if (!Number.isFinite(uid)) {
          uid = Number(uidRaw);
        }
        if (!Number.isFinite(gid)) {
          gid = Number(gidRaw);
        }
      } catch {
        // ignore
      }
    }
  }
  if (!Number.isFinite(uid) || !Number.isFinite(gid)) {
    throw new Error("Workspace user ids unavailable.");
  }
  const ids = { uid, gid };
  await ensureWorkspaceUser(workspaceId, homeDir, ids);
  if (workspaceRecord) {
    await persistWorkspaceRecord({
      workspaceId,
      providers: workspaceRecord.providers || {},
      ids,
      existing: workspaceRecord,
    });
  }
  await appendAuditLog(workspaceId, "workspace_user_rehydrated", {
    uid: ids.uid,
    gid: ids.gid,
  });
  return ids;
};

const ensureWorkspaceDirs = async (workspaceId) => {
  const paths = getWorkspacePaths(workspaceId);
  await runAsCommand(workspaceId, "/bin/mkdir", ["-p", paths.sessionsDir]);
  await runAsCommand(workspaceId, "/bin/chmod", ["700", paths.sessionsDir]);
  const sshPaths = getWorkspaceSshPaths(paths.homeDir);
  await ensureWorkspaceDir(workspaceId, sshPaths.sshDir, 0o700);
  return paths;
};

const decodeBase64 = (value) => {
  if (!value) {
    return "";
  }
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch (error) {
    throw new Error("Invalid base64 payload.");
  }
};

const isObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);

const validateCodexAuthJson = (raw) => {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid Codex auth.json payload.");
  }
  if (!isObject(parsed)) {
    throw new Error("Invalid Codex auth.json payload.");
  }
  if (!Object.prototype.hasOwnProperty.call(parsed, "OPENAI_API_KEY")) {
    throw new Error("Invalid Codex auth.json payload.");
  }
  if (!isObject(parsed.tokens)) {
    throw new Error("Invalid Codex auth.json payload.");
  }
  const requiredTokenFields = ["id_token", "access_token", "refresh_token", "account_id"];
  for (const field of requiredTokenFields) {
    if (typeof parsed.tokens[field] !== "string" || !parsed.tokens[field]) {
      throw new Error("Invalid Codex auth.json payload.");
    }
  }
  if (typeof parsed.last_refresh !== "string" || !parsed.last_refresh) {
    throw new Error("Invalid Codex auth.json payload.");
  }
  return parsed;
};

const writeWorkspaceProviderAuth = async (workspaceId, providers) => {
  const workspaceHome = getWorkspacePaths(workspaceId).homeDir;
  const authPaths = getWorkspaceAuthPaths(workspaceHome);

  const codexConfig = providers?.codex;
  if (codexConfig?.enabled && codexConfig.auth) {
    await ensureWorkspaceDir(workspaceId, authPaths.codexDir, 0o700);
    if (codexConfig.auth.type === "api_key") {
      const payload = JSON.stringify({ OPENAI_API_KEY: codexConfig.auth.value }, null, 2);
      await writeWorkspaceFile(workspaceId, authPaths.codexAuthPath, payload, 0o600);
    } else if (codexConfig.auth.type === "auth_json_b64") {
      const decoded = decodeBase64(codexConfig.auth.value);
      validateCodexAuthJson(decoded);
      await writeWorkspaceFile(workspaceId, authPaths.codexAuthPath, decoded, 0o600);
    }
  }

  const claudeConfig = providers?.claude;
  if (claudeConfig?.enabled && claudeConfig.auth) {
    await runAsCommand(workspaceId, "/bin/rm", ["-f", authPaths.claudeAuthPath]);
    await runAsCommand(workspaceId, "/bin/rm", ["-f", authPaths.claudeCredentialsPath]);
    if (claudeConfig.auth.type === "api_key") {
      const payload = JSON.stringify({ primaryApiKey: claudeConfig.auth.value }, null, 2);
      await writeWorkspaceFile(workspaceId, authPaths.claudeAuthPath, payload, 0o600);
    } else if (claudeConfig.auth.type === "setup_token") {
      await ensureWorkspaceDir(workspaceId, authPaths.claudeDir, 0o700);
      const payload = JSON.stringify(
        {
          claudeAiOauth: {
            accessToken: claudeConfig.auth.value,
            refreshToken: "dummy",
            expiresAt: 1969350365482,
            scopes: [
              "user:inference",
              "user:mcp_servers",
              "user:profile",
              "user:sessions:claude_code",
            ],
            subscriptionType: "pro",
            rateLimitTier: "default_claude_ai",
          },
        },
        null,
        2
      );
      await writeWorkspaceFile(workspaceId, authPaths.claudeCredentialsPath, payload, 0o600);
    }
  }
};

export const readWorkspaceConfig = async (workspaceId) => {
  const record = await getWorkspaceRecord(workspaceId);
  return toWorkspaceConfigPayload(record);
};

export const verifyWorkspaceSecret = async (workspaceId, workspaceSecret) => {
  const record = await getWorkspaceRecord(workspaceId);
  return compareWorkspaceSecretHash(workspaceSecret, record.workspaceSecretHash);
};

export const rotateWorkspaceSecret = async (workspaceId, options = {}) => {
  if (!workspaceIdPattern.test(workspaceId)) {
    throw new Error("Invalid workspaceId.");
  }
  const record = await getWorkspaceRecord(workspaceId);
  const provided =
    typeof options?.workspaceSecret === "string" ? options.workspaceSecret.trim() : "";
  const nextSecret = provided || crypto.randomBytes(32).toString("hex");
  await persistWorkspaceRecord({
    workspaceId,
    providers: record.providers || {},
    ids: null,
    workspaceSecretHash: hashWorkspaceSecret(nextSecret),
    existing: record,
  });
  await appendAuditLog(workspaceId, "workspace_secret_rotated", {
    actor: typeof options?.actor === "string" && options.actor ? options.actor : "system",
  });
  return { workspaceId, workspaceSecret: nextSecret };
};

export const ensureDefaultMonoWorkspace = async () => {
  if (!isMonoUser) {
    return;
  }
  const workspaceId = "default";
  const enabledProviders = getMonoEnabledProvidersFromEnv();
  await ensureWorkspaceDirs(workspaceId);
  const ids = await getWorkspaceUserIds(workspaceId);
  const existing = await storage.getWorkspace(workspaceId);
  if (!existing) {
    const providers = applyMonoEnabledProviders({}, enabledProviders);
    await persistWorkspaceRecord({
      workspaceId,
      providers,
      ids,
      workspaceSecretHash: hashWorkspaceSecret("default"),
      existing: null,
    });
    await appendAuditLog(workspaceId, "workspace_created");
    return;
  }
  const providers = applyMonoEnabledProviders(existing.providers || {}, enabledProviders);
  await persistWorkspaceRecord({
    workspaceId,
    providers,
    ids,
    existing,
  });
  await appendAuditLog(workspaceId, "workspace_providers_activation_updated", {
    codexEnabled: providers.codex?.enabled ?? false,
    claudeEnabled: providers.claude?.enabled ?? false,
  });
};

const readEnvValue = (name) =>
  typeof process.env[name] === "string" ? process.env[name].trim() : "";

const parseMonoEnableEnv = (name) => {
  const raw = process.env[name];
  if (typeof raw !== "string") {
    return false;
  }
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off", ""].includes(value)) {
    return false;
  }
  throw new Error(
    `Invalid ${name} value \"${raw}\". Use one of: true/false, 1/0, yes/no, on/off.`
  );
};

const getMonoEnabledProvidersFromEnv = () => {
  const codexEnabled = parseMonoEnableEnv("VIBE80_MONO_ENABLE_CODEX");
  const claudeEnabled = parseMonoEnableEnv("VIBE80_MONO_ENABLE_CLAUDE");
  if (!codexEnabled && !claudeEnabled) {
    throw new Error(
      "In mono_user mode, enable at least one provider via --codex/--claude or VIBE80_MONO_ENABLE_CODEX/VIBE80_MONO_ENABLE_CLAUDE."
    );
  }
  return { codexEnabled, claudeEnabled };
};

const applyMonoEnabledProviders = (providers = {}, enabledConfig) => {
  const { codexEnabled, claudeEnabled } = enabledConfig;
  const codexPrev = providers?.codex && typeof providers.codex === "object" ? providers.codex : {};
  const claudePrev = providers?.claude && typeof providers.claude === "object" ? providers.claude : {};
  return {
    ...providers,
    codex: {
      enabled: Boolean(codexEnabled),
      auth: codexPrev.auth || null,
    },
    claude: {
      enabled: Boolean(claudeEnabled),
      auth: claudePrev.auth || null,
    },
  };
};

const buildMonoUserProviderOverridesFromEnv = () => {
  const codexApiKey = readEnvValue("CODEX_API_KEY");
  const codexAuthJsonB64Raw = process.env.CODEX_AUTH_JSON_B64;
  const hasCodexAuthJsonB64 = typeof codexAuthJsonB64Raw === "string";
  const codexAuthJsonB64 = hasCodexAuthJsonB64 ? codexAuthJsonB64Raw.trim() : "";
  const claudeApiKey = readEnvValue("CLAUDE_API_KEY");
  const claudeSetupTokenRaw = process.env.CLAUDE_SETUP_TOKEN;
  const hasClaudeSetupToken = typeof claudeSetupTokenRaw === "string";
  const claudeSetupToken = hasClaudeSetupToken ? claudeSetupTokenRaw.trim() : "";

  const overrides = {};

  if (codexApiKey && hasCodexAuthJsonB64) {
    console.warn(
      "[warn] Both CODEX_API_KEY and CODEX_AUTH_JSON_B64 are set; using CODEX_AUTH_JSON_B64."
    );
  }
  if (hasCodexAuthJsonB64) {
    if (!codexAuthJsonB64) {
      console.warn(
        "[warn] Invalid CODEX_AUTH_JSON_B64 detected; ignoring codex preprovisioning."
      );
    } else {
      try {
        const decoded = decodeBase64(codexAuthJsonB64);
        validateCodexAuthJson(decoded);
        overrides.codex = {
          auth: { type: "auth_json_b64", value: codexAuthJsonB64 },
        };
      } catch {
        console.warn(
          "[warn] Invalid CODEX_AUTH_JSON_B64 detected; ignoring codex preprovisioning."
        );
      }
    }
  } else if (codexApiKey) {
    overrides.codex = {
      auth: { type: "api_key", value: codexApiKey },
    };
  }

  if (claudeApiKey && hasClaudeSetupToken) {
    console.warn(
      "[warn] Both CLAUDE_API_KEY and CLAUDE_SETUP_TOKEN are set; using CLAUDE_SETUP_TOKEN."
    );
  }
  if (hasClaudeSetupToken) {
    if (!claudeSetupToken) {
      console.warn(
        "[warn] Invalid CLAUDE_SETUP_TOKEN detected; ignoring claude preprovisioning."
      );
    } else {
      overrides.claude = {
        auth: { type: "setup_token", value: claudeSetupToken },
      };
    }
  } else if (claudeApiKey) {
    overrides.claude = {
      auth: { type: "api_key", value: claudeApiKey },
    };
  }

  return overrides;
};

export const applyMonoUserProviderOverridesFromEnv = async () => {
  if (!isMonoUser) {
    return;
  }
  const overrides = buildMonoUserProviderOverridesFromEnv();
  if (Object.keys(overrides).length === 0) {
    return;
  }
  const workspaceId = "default";
  const existing = await storage.getWorkspace(workspaceId);
  if (!existing) {
    return;
  }
  const activationConfig = getMonoEnabledProvidersFromEnv();
  const mergedProviders = mergeProvidersForUpdate(existing.providers || {}, {
    ...(overrides.codex
      ? {
          codex: {
            enabled: activationConfig.codexEnabled,
            auth: overrides.codex.auth,
          },
        }
      : {}),
    ...(overrides.claude
      ? {
          claude: {
            enabled: activationConfig.claudeEnabled,
            auth: overrides.claude.auth,
          },
        }
      : {}),
  });
  const ids = await getWorkspaceUserIds(workspaceId);
  await writeWorkspaceProviderAuth(workspaceId, mergedProviders);
  await persistWorkspaceRecord({
    workspaceId,
    providers: mergedProviders,
    ids,
    existing,
  });
  await appendAuditLog(workspaceId, "workspace_providers_preprovisioned_from_env", {
    providers: Object.keys(overrides),
  });
};

export const createWorkspace = async (providers) => {
  const validationError = validateProvidersConfig(providers);
  if (validationError) {
    throw new Error(validationError);
  }
  if (isMonoUser) {
    const workspaceId = "default";
    await ensureWorkspaceDirs(workspaceId);
    const enabledProviders = getMonoEnabledProvidersFromEnv();
    const secret = "default";
    const ids = await getWorkspaceUserIds(workspaceId);
    const existing = await storage.getWorkspace(workspaceId);
    const providersWithActivation = applyMonoEnabledProviders(
      providers || existing?.providers || {},
      enabledProviders
    );
    await writeWorkspaceProviderAuth(workspaceId, providersWithActivation);
    await persistWorkspaceRecord({
      workspaceId,
      providers: providersWithActivation,
      ids,
      workspaceSecretHash: hashWorkspaceSecret(secret),
      existing,
    });
    await appendAuditLog(workspaceId, "workspace_created");
    return { workspaceId, workspaceSecret: secret };
  }
  while (true) {
    const workspaceId = generateId("w");
    if (!workspaceIdPattern.test(workspaceId)) {
      continue;
    }
    if (await workspaceUserExists(workspaceId)) {
      continue;
    }
    const ids = await allocateWorkspaceIds();
    await runRootCommand([
      "create-workspace",
      "--workspace-id",
      workspaceId,
      "--uid",
      String(ids.uid),
      "--gid",
      String(ids.gid),
    ]);
    await storage.saveWorkspaceUserIds(workspaceId, ids);
    const secret = crypto.randomBytes(32).toString("hex");
    await writeWorkspaceProviderAuth(workspaceId, providers);
    await persistWorkspaceRecord({
      workspaceId,
      providers,
      ids,
      workspaceSecretHash: hashWorkspaceSecret(secret),
    });
    await appendAuditLog(workspaceId, "workspace_created");
    return { workspaceId, workspaceSecret: secret };
  }
};

export const updateWorkspace = async (workspaceId, providers) => {
  const validationError = validateProvidersConfig(providers);
  if (validationError) {
    throw new Error(validationError);
  }
  const ids = await getWorkspaceUserIds(workspaceId);
  const existing = await storage.getWorkspace(workspaceId);
  if (!existing) {
    throw new Error("Workspace not found.");
  }
  await writeWorkspaceProviderAuth(workspaceId, providers);
  const payload = await persistWorkspaceRecord({
    workspaceId,
    providers,
    ids,
    existing,
  });
  await appendAuditLog(workspaceId, "workspace_updated");
  return toWorkspaceConfigPayload(payload);
};
