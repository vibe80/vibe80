import path from "path";
import crypto from "crypto";
import { runAsCommand, runAsCommandOutput } from "./runAs.js";
import storage from "./storage/index.js";
import { getSessionRuntime } from "./runtimeStore.js";
import { createWorktreeClient } from "./clientFactory.js";

// Palette de couleurs pour distinguer les worktrees
const WORKTREE_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

let colorIndex = 0;
const getNextColor = () => {
  const color = WORKTREE_COLORS[colorIndex % WORKTREE_COLORS.length];
  colorIndex += 1;
  return color;
};

const runSessionCommand = (session, command, args, options = {}) =>
  runAsCommand(session.workspaceId, command, args, options);

const runSessionCommandOutput = (session, command, args, options = {}) =>
  runAsCommandOutput(session.workspaceId, command, args, options);

const resolveStartingRef = (startingBranch, remote = "origin") => {
  if (!startingBranch || typeof startingBranch !== "string") {
    return null;
  }
  const trimmed = startingBranch.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.startsWith("refs/")) {
    return trimmed;
  }
  if (trimmed.startsWith(`${remote}/`)) {
    return trimmed;
  }
  return `${remote}/${trimmed}`;
};

const normalizeBranchName = (value, remote = "origin") => {
  if (!value || typeof value !== "string") {
    return "";
  }
  let name = value.trim();
  if (!name) {
    return "";
  }
  if (name.startsWith("refs/heads/")) {
    name = name.slice("refs/heads/".length);
  } else if (name.startsWith(`refs/remotes/${remote}/`)) {
    name = name.slice(`refs/remotes/${remote}/`.length);
  } else if (name.startsWith(`${remote}/`)) {
    name = name.slice(`${remote}/`.length);
  }
  return name.trim();
};

const resolveCurrentBranchName = async (session) => {
  const output = await runSessionCommandOutput(
    session,
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: session.repoDir }
  );
  return output.trim();
};

const serializeWorktree = (worktree) => {
  if (!worktree) return null;
  const { client, ...persisted } = worktree;
  return persisted;
};

const touchSession = async (session) => {
  const updated = { ...session, lastActivityAt: Date.now() };
  await storage.saveSession(session.sessionId, updated);
  return updated;
};

const loadWorktree = async (worktreeId) => {
  if (!worktreeId) return null;
  return storage.getWorktree(worktreeId);
};

/**
 * Génère un nom de worktree à partir du premier message ou un nom par défaut
 */
const generateWorktreeName = (text, index) => {
  if (text) {
    const cleaned = text
      .slice(0, 30)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (cleaned.length > 2) {
      return cleaned;
    }
  }
  return `branch-${index}`;
};

/**
 * Crée un nouveau worktree pour une session
 */
export async function createWorktree(session, options) {
  const { provider, name, parentWorktreeId, startingBranch, model, reasoningEffort } =
    options;

  const worktreesDir = path.join(session.dir, "worktrees");
  await runAsCommand(session.workspaceId, "/bin/mkdir", ["-p", worktreesDir]);
  await runAsCommand(session.workspaceId, "/bin/chmod", ["2750", worktreesDir]);

  const worktreeId = crypto.randomBytes(8).toString("hex");
  const existingWorktrees = await storage.listWorktrees(session.sessionId);
  const worktreeIndex = existingWorktrees.length + 1;
  const requestedBranchName = normalizeBranchName(name);
  const worktreePath = path.join(worktreesDir, worktreeId);

  let startCommit = "HEAD";
  let sourceBranchName = "";
  if (parentWorktreeId) {
    const parent = await loadWorktree(parentWorktreeId);
    if (parent) {
      startCommit = await runSessionCommandOutput(
        session,
        "git",
        ["rev-parse", "HEAD"],
        { cwd: parent.path }
      );
      startCommit = startCommit.trim();
      sourceBranchName = parent.branchName || "";
    }
  } else if (startingBranch) {
    startCommit = resolveStartingRef(startingBranch) || startingBranch;
    sourceBranchName = normalizeBranchName(startingBranch);
  } else {
    sourceBranchName = await resolveCurrentBranchName(session);
  }

  const baseName =
    requestedBranchName ||
    sourceBranchName ||
    generateWorktreeName(null, worktreeIndex);
  const branchName = requestedBranchName
    ? requestedBranchName
    : `wt-${worktreeId.slice(0, 6)}-${baseName}`;

  const checkRemoteBranchExists = async (branch) => {
    const remoteRef = resolveStartingRef(branch);
    if (!remoteRef) return false;
    const remoteVerifyRef = remoteRef.startsWith("refs/")
      ? remoteRef
      : `refs/remotes/${remoteRef}`;
    try {
      await runSessionCommand(session, "git", ["show-ref", "--verify", remoteVerifyRef], {
        cwd: session.repoDir,
      });
      return true;
    } catch {
      return false;
    }
  };

  const remoteBranchExists = requestedBranchName
    ? await checkRemoteBranchExists(requestedBranchName)
    : false;

  if (requestedBranchName) {
    if (remoteBranchExists) {
      await runSessionCommand(
        session,
        "git",
        ["branch", branchName, resolveStartingRef(requestedBranchName)],
        { cwd: session.repoDir }
      );
    } else {
      if (!parentWorktreeId && !startingBranch) {
        throw new Error("Branche source requise pour creer une nouvelle branche.");
      }
      await runSessionCommand(session, "git", ["branch", branchName, startCommit], {
        cwd: session.repoDir,
      });
    }
  } else {
    await runSessionCommand(session, "git", ["branch", branchName, startCommit], {
      cwd: session.repoDir,
    });
  }

  await runSessionCommand(
    session,
    "git",
    ["config", `branch.${branchName}.remote`, "origin"],
    { cwd: session.repoDir }
  );
  await runSessionCommand(
    session,
    "git",
    ["config", `branch.${branchName}.merge`, `refs/heads/${branchName}`],
    { cwd: session.repoDir }
  );

  await runSessionCommand(
    session,
    "git",
    ["worktree", "add", worktreePath, branchName],
    { cwd: session.repoDir }
  );
  await runAsCommand(session.workspaceId, "/bin/chmod", ["2750", worktreePath]);

  const worktree = {
    id: worktreeId,
    sessionId: session.sessionId,
    name: baseName,
    branchName,
    path: worktreePath,
    provider,
    model: model || null,
    reasoningEffort: reasoningEffort || null,
    startingBranch: startingBranch || null,
    workspaceId: session.workspaceId,
    messages: [],
    status: "creating",
    parentWorktreeId: parentWorktreeId || null,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    color: getNextColor(),
  };

  await storage.saveWorktree(session.sessionId, worktreeId, serializeWorktree(worktree));
  await touchSession(session);

  try {
    const client = createWorktreeClient(worktree, session.attachmentsDir);
    const runtime = getSessionRuntime(session.sessionId);
    if (runtime) {
      runtime.worktreeClients.set(worktreeId, client);
    }
    worktree.client = client;
    worktree.status = "ready";
  } catch (error) {
    worktree.status = "error";
    await storage.saveWorktree(session.sessionId, worktreeId, serializeWorktree(worktree));
    throw error;
  }

  return worktree;
}

/**
 * Supprime un worktree
 */
export async function removeWorktree(session, worktreeId, deleteBranch = true) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) {
    throw new Error("Worktree not found");
  }

  const runtime = getSessionRuntime(session.sessionId);
  const client = runtime?.worktreeClients?.get(worktreeId);
  if (client) {
    try {
      if (typeof client.stop === "function") {
        await client.stop();
      }
    } catch (error) {
      console.error("Error stopping worktree client:", error);
    }
    runtime.worktreeClients.delete(worktreeId);
  }

  await runSessionCommand(
    session,
    "git",
    ["worktree", "remove", "--force", worktree.path],
    { cwd: session.repoDir }
  );

  if (deleteBranch) {
    try {
      await runSessionCommand(session, "git", ["branch", "-D", worktree.branchName], {
        cwd: session.repoDir,
      });
    } catch {
      console.warn("Could not delete branch:", worktree.branchName);
    }
  }

  await storage.deleteWorktree(session.sessionId, worktreeId);
  await touchSession(session);
}

export async function getWorktreeDiff(session, worktreeId) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) {
    throw new Error("Worktree not found");
  }
  const [status, diff] = await Promise.all([
    runSessionCommandOutput(session, "git", ["status", "--porcelain"], {
      cwd: worktree.path,
    }),
    runSessionCommandOutput(session, "git", ["diff"], { cwd: worktree.path }),
  ]);
  return { status, diff };
}

export async function getWorktreeCommits(session, worktreeId, limit = 20) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) {
    throw new Error("Worktree not found");
  }

  const output = await runSessionCommandOutput(
    session,
    "git",
    ["log", `--max-count=${limit}`, "--format=%H|%s|%ci"],
    { cwd: worktree.path }
  );

  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [sha, message, date] = line.split("|");
      return { sha, message, date };
    });
}

export async function mergeWorktree(session, sourceWorktreeId, targetWorktreeId) {
  const source = await loadWorktree(sourceWorktreeId);
  if (!source) {
    throw new Error("Source worktree not found");
  }
  const target = await loadWorktree(targetWorktreeId);
  if (!target) {
    throw new Error("Target worktree not found");
  }

  try {
    await runSessionCommand(session, "git", ["merge", source.branchName, "--no-edit"], {
      cwd: target.path,
    });
    return { success: true };
  } catch (error) {
    const status = await runSessionCommandOutput(
      session,
      "git",
      ["status", "--porcelain"],
      { cwd: target.path }
    );
    const conflicts = status
      .split("\n")
      .filter((line) => line.startsWith("UU") || line.startsWith("AA"))
      .map((line) => line.slice(3).trim());
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }
    throw error;
  }
}

export async function abortMerge(session, worktreeId) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) {
    throw new Error("Worktree not found");
  }
  await runSessionCommand(session, "git", ["merge", "--abort"], { cwd: worktree.path });
}

export async function cherryPickCommit(session, commitSha, targetWorktreeId) {
  const target = await loadWorktree(targetWorktreeId);
  if (!target) {
    throw new Error("Target worktree not found");
  }
  try {
    await runSessionCommand(session, "git", ["cherry-pick", commitSha], {
      cwd: target.path,
    });
    return { success: true };
  } catch (error) {
    const status = await runSessionCommandOutput(
      session,
      "git",
      ["status", "--porcelain"],
      { cwd: target.path }
    );
    const conflicts = status
      .split("\n")
      .filter((line) => line.startsWith("UU") || line.startsWith("AA"))
      .map((line) => line.slice(3).trim());
    if (conflicts.length > 0) {
      return { success: false, conflicts };
    }
    throw error;
  }
}

export async function listWorktrees(session) {
  const worktrees = await storage.listWorktrees(session.sessionId);
  return worktrees.map((wt) => ({
    id: wt.id,
    name: wt.name,
    branchName: wt.branchName,
    provider: wt.provider,
    status: wt.status,
    messageCount: Array.isArray(wt.messages) ? wt.messages.length : 0,
    parentWorktreeId: wt.parentWorktreeId,
    createdAt: wt.createdAt,
    lastActivityAt: wt.lastActivityAt,
    color: wt.color,
  }));
}

export async function getWorktree(session, worktreeId) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) return null;
  const runtime = getSessionRuntime(session.sessionId);
  if (runtime?.worktreeClients?.has(worktreeId)) {
    worktree.client = runtime.worktreeClients.get(worktreeId);
  }
  return worktree;
}

export async function updateWorktreeStatus(session, worktreeId, status) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) return;
  const updated = {
    ...worktree,
    status,
    lastActivityAt: new Date().toISOString(),
  };
  await storage.saveWorktree(session.sessionId, worktreeId, serializeWorktree(updated));
}

export async function appendWorktreeMessage(session, worktreeId, message) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) return;
  const nextMessages = Array.isArray(worktree.messages)
    ? [...worktree.messages, message]
    : [message];
  if (nextMessages.length > 200) {
    nextMessages.splice(0, nextMessages.length - 200);
  }
  const updated = {
    ...worktree,
    messages: nextMessages,
    lastActivityAt: new Date().toISOString(),
  };
  await storage.saveWorktree(session.sessionId, worktreeId, serializeWorktree(updated));
}

export async function clearWorktreeMessages(session, worktreeId) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree) return;
  const updated = {
    ...worktree,
    messages: [],
    lastActivityAt: new Date().toISOString(),
  };
  await storage.saveWorktree(session.sessionId, worktreeId, serializeWorktree(updated));
}

export async function renameWorktree(session, worktreeId, newName) {
  const worktree = await loadWorktree(worktreeId);
  if (!worktree || !newName) return;
  const updated = { ...worktree, name: newName };
  await storage.saveWorktree(session.sessionId, worktreeId, serializeWorktree(updated));
}
