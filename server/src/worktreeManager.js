import path from "path";
import crypto from "crypto";
import { CodexAppServerClient } from "./codexClient.js";
import { ClaudeCliClient } from "./claudeClient.js";
import { runAsCommand, runAsCommandOutput } from "./runAs.js";

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
  colorIndex++;
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
  const output = await runSessionCommandOutput(session, "git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: session.repoDir,
  });
  return output.trim();
};

/**
 * Génère un nom de worktree à partir du premier message ou un nom par défaut
 */
const generateWorktreeName = (text, index) => {
  if (text) {
    // Prendre les 30 premiers caractères, nettoyer pour un nom de branche valide
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
 * @param {object} session - La session
 * @param {object} options - Options de création
 * @param {"codex" | "claude"} options.provider - Le provider LLM
 * @param {string} [options.name] - Nom personnalisé pour le worktree
 * @param {string} [options.parentWorktreeId] - ID du worktree parent (pour forker)
 * @param {string} [options.startingBranch] - Branche de départ (défaut: HEAD actuel)
 * @param {string} [options.model] - Modèle LLM (si supporté)
 * @param {string} [options.reasoningEffort] - Niveau de reasoning (si supporté)
 * @returns {Promise<object>} L'entrée worktree créée
 */
export async function createWorktree(session, options) {
  const { provider, name, parentWorktreeId, startingBranch, model, reasoningEffort } = options;

  // Initialiser la Map des worktrees si nécessaire
  if (!session.worktrees) {
    session.worktrees = new Map();
  }

  // Créer le répertoire worktrees s'il n'existe pas
  const worktreesDir = path.join(session.dir, "worktrees");
  await runAsCommand(session.workspaceId, "/bin/mkdir", ["-p", worktreesDir]);
  await runAsCommand(session.workspaceId, "/bin/chmod", ["2750", worktreesDir]);

  // Générer un ID unique
  const worktreeId = crypto.randomBytes(8).toString("hex");

  const worktreeIndex = session.worktrees.size + 1;
  const requestedBranchName = normalizeBranchName(name);

  // Chemin du worktree
  const worktreePath = path.join(worktreesDir, worktreeId);

  let startCommit = "HEAD";
  let sourceBranchName = "";
  if (parentWorktreeId && session.worktrees.has(parentWorktreeId)) {
    const parent = session.worktrees.get(parentWorktreeId);
    startCommit = await runSessionCommandOutput(
      session,
      "git",
      ["rev-parse", "HEAD"],
      { cwd: parent.path }
    );
    startCommit = startCommit.trim();
    sourceBranchName = parent.branchName || "";
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
    if (!remoteRef) {
      return false;
    }
    const remoteVerifyRef = remoteRef.startsWith("refs/")
      ? remoteRef
      : `refs/remotes/${remoteRef}`;
    try {
      await runSessionCommand(
        session,
        "git",
        ["show-ref", "--verify", remoteVerifyRef],
        { cwd: session.repoDir }
      );
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

  // Associer directement la branche locale au remote pour permettre `git push` sans -u.
  await runSessionCommand(
    session,
    "git",
    ["config", `branch.${branchName}.remote`, "origin"],
    {
      cwd: session.repoDir,
    }
  );
  await runSessionCommand(
    session,
    "git",
    ["config", `branch.${branchName}.merge`, `refs/heads/${branchName}`],
    {
      cwd: session.repoDir,
    }
  );

  // Créer le worktree
  await runSessionCommand(
    session,
    "git",
    ["worktree", "add", worktreePath, branchName],
    { cwd: session.repoDir }
  );
  await runAsCommand(session.workspaceId, "/bin/chmod", ["2750", worktreePath]);

  // Créer l'entrée worktree
  const worktree = {
    id: worktreeId,
    name: baseName,
    branchName,
    path: worktreePath,
    provider,
    model: model || null,
    reasoningEffort: reasoningEffort || null,
    startingBranch: startingBranch || null,
    workspaceId: session.workspaceId,
    client: null,
    messages: [],
    status: "creating",
    parentWorktreeId: parentWorktreeId || null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    color: getNextColor(),
  };

  session.worktrees.set(worktreeId, worktree);
  if (typeof session.lastActivityAt === "number") {
    session.lastActivityAt = Date.now();
  }

  // Créer et démarrer le client LLM
  try {
    const client =
      provider === "claude"
        ? new ClaudeCliClient({
            cwd: worktreePath,
            attachmentsDir: session.attachmentsDir,
            env: process.env,
            workspaceId: session.workspaceId,
          })
        : new CodexAppServerClient({
            cwd: worktreePath,
            env: process.env,
            workspaceId: session.workspaceId,
          });

    worktree.client = client;
    worktree.status = "ready";
  } catch (error) {
    worktree.status = "error";
    throw error;
  }

  return worktree;
}

/**
 * Supprime un worktree
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree à supprimer
 * @param {boolean} [deleteBranch=true] - Supprimer aussi la branche git
 */
export async function removeWorktree(session, worktreeId, deleteBranch = true) {
  if (!session.worktrees?.has(worktreeId)) {
    throw new Error("Worktree not found");
  }

  const worktree = session.worktrees.get(worktreeId);

  // Arrêter le client s'il est actif
  if (worktree.client) {
    try {
      if (typeof worktree.client.stop === "function") {
        await worktree.client.stop();
      }
    } catch (error) {
      console.error("Error stopping worktree client:", error);
    }
    worktree.client = null;
  }

  // Supprimer le worktree git
  await runSessionCommand(
    session,
    "git",
    ["worktree", "remove", "--force", worktree.path],
    { cwd: session.repoDir }
  );

  // Supprimer la branche si demandé
  if (deleteBranch) {
    try {
      await runSessionCommand(
        session,
        "git",
        ["branch", "-D", worktree.branchName],
        { cwd: session.repoDir }
      );
    } catch (error) {
      // Ignorer si la branche n'existe plus
      console.warn("Could not delete branch:", worktree.branchName);
    }
  }

  // Supprimer de la Map
  session.worktrees.delete(worktreeId);
  if (typeof session.lastActivityAt === "number") {
    session.lastActivityAt = Date.now();
  }
}

/**
 * Obtient le diff d'un worktree spécifique
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree
 * @returns {Promise<{status: string, diff: string}>}
 */
export async function getWorktreeDiff(session, worktreeId) {
  if (!session.worktrees?.has(worktreeId)) {
    throw new Error("Worktree not found");
  }

  const worktree = session.worktrees.get(worktreeId);

  const [status, diff] = await Promise.all([
    runSessionCommandOutput(session, "git", ["status", "--porcelain"], {
      cwd: worktree.path,
    }),
    runSessionCommandOutput(session, "git", ["diff"], { cwd: worktree.path }),
  ]);

  return { status, diff };
}

/**
 * Obtient les commits d'un worktree
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree
 * @param {number} [limit=20] - Nombre max de commits
 * @returns {Promise<Array<{sha: string, message: string, date: string}>>}
 */
export async function getWorktreeCommits(session, worktreeId, limit = 20) {
  if (!session.worktrees?.has(worktreeId)) {
    throw new Error("Worktree not found");
  }

  const worktree = session.worktrees.get(worktreeId);

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

/**
 * Fusionne un worktree dans un autre
 * @param {object} session - La session
 * @param {string} sourceWorktreeId - ID du worktree source
 * @param {string} targetWorktreeId - ID du worktree cible
 * @returns {Promise<{success: boolean, conflicts?: string[]}>}
 */
export async function mergeWorktree(session, sourceWorktreeId, targetWorktreeId) {
  if (!session.worktrees?.has(sourceWorktreeId)) {
    throw new Error("Source worktree not found");
  }
  if (!session.worktrees?.has(targetWorktreeId)) {
    throw new Error("Target worktree not found");
  }

  const source = session.worktrees.get(sourceWorktreeId);
  const target = session.worktrees.get(targetWorktreeId);

  try {
    // Effectuer la fusion dans le worktree cible
    await runSessionCommand(session, "git", ["merge", source.branchName, "--no-edit"], {
      cwd: target.path,
    });

    return { success: true };
  } catch (error) {
    // Vérifier s'il y a des conflits
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

/**
 * Annule une fusion en cours
 * @param {object} session - La session
 * @param {string} worktreeId - ID du worktree
 */
export async function abortMerge(session, worktreeId) {
  if (!session.worktrees?.has(worktreeId)) {
    throw new Error("Worktree not found");
  }

  const worktree = session.worktrees.get(worktreeId);
  await runSessionCommand(session, "git", ["merge", "--abort"], { cwd: worktree.path });
}

/**
 * Cherry-pick un commit dans un worktree
 * @param {object} session - La session
 * @param {string} commitSha - SHA du commit à cherry-pick
 * @param {string} targetWorktreeId - ID du worktree cible
 * @returns {Promise<{success: boolean, conflicts?: string[]}>}
 */
export async function cherryPickCommit(session, commitSha, targetWorktreeId) {
  if (!session.worktrees?.has(targetWorktreeId)) {
    throw new Error("Target worktree not found");
  }

  const target = session.worktrees.get(targetWorktreeId);

  try {
    await runSessionCommand(session, "git", ["cherry-pick", commitSha], {
      cwd: target.path,
    });
    return { success: true };
  } catch (error) {
    // Vérifier s'il y a des conflits
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

/**
 * Liste tous les worktrees d'une session
 * @param {object} session - La session
 * @returns {Array<object>} Liste des worktrees (sans le client)
 */
export function listWorktrees(session) {
  if (!session.worktrees) {
    return [];
  }

  return Array.from(session.worktrees.values()).map((wt) => ({
    id: wt.id,
    name: wt.name,
    branchName: wt.branchName,
    provider: wt.provider,
    status: wt.status,
    messageCount: wt.messages.length,
    parentWorktreeId: wt.parentWorktreeId,
    createdAt: wt.createdAt,
    lastActivityAt: wt.lastActivityAt,
    color: wt.color,
  }));
}

/**
 * Obtient un worktree par son ID
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree
 * @returns {object|null}
 */
export function getWorktree(session, worktreeId) {
  return session.worktrees?.get(worktreeId) || null;
}

/**
 * Met à jour le statut d'un worktree
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree
 * @param {"creating" | "ready" | "processing" | "completed" | "error"} status
 */
export function updateWorktreeStatus(session, worktreeId, status) {
  const worktree = session.worktrees?.get(worktreeId);
  if (worktree) {
    worktree.status = status;
    worktree.lastActivityAt = new Date();
  }
}

/**
 * Ajoute un message à un worktree
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree
 * @param {object} message - Le message à ajouter
 */
export function appendWorktreeMessage(session, worktreeId, message) {
  const worktree = session.worktrees?.get(worktreeId);
  if (worktree) {
    worktree.messages.push(message);
    worktree.lastActivityAt = new Date();
  }
}

/**
 * Efface les messages d'un worktree
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree
 */
export function clearWorktreeMessages(session, worktreeId) {
  const worktree = session.worktrees?.get(worktreeId);
  if (worktree) {
    worktree.messages = [];
    worktree.lastActivityAt = new Date();
  }
}

/**
 * Renomme un worktree
 * @param {object} session - La session
 * @param {string} worktreeId - L'ID du worktree
 * @param {string} newName - Le nouveau nom
 */
export function renameWorktree(session, worktreeId, newName) {
  const worktree = session.worktrees?.get(worktreeId);
  if (worktree) {
    worktree.name = newName;
  }
}
