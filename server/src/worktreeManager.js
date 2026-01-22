import path from "path";
import fs from "fs";
import crypto from "crypto";
import { spawn } from "child_process";
import { CodexAppServerClient } from "./codexClient.js";
import { ClaudeCliClient } from "./claudeClient.js";

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

const runCommand = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stderr = "";

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });

const runCommandOutput = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });

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
 * @returns {Promise<object>} L'entrée worktree créée
 */
export async function createWorktree(session, options) {
  const { provider, name, parentWorktreeId, startingBranch } = options;

  // Initialiser la Map des worktrees si nécessaire
  if (!session.worktrees) {
    session.worktrees = new Map();
  }

  // Créer le répertoire worktrees s'il n'existe pas
  const worktreesDir = path.join(session.dir, "worktrees");
  await fs.promises.mkdir(worktreesDir, { recursive: true });

  // Générer un ID unique
  const worktreeId = crypto.randomBytes(8).toString("hex");

  // Générer le nom de la branche
  const worktreeIndex = session.worktrees.size + 1;
  const baseName = name || generateWorktreeName(null, worktreeIndex);
  const branchName = `wt-${worktreeId.slice(0, 6)}-${baseName}`;

  // Chemin du worktree
  const worktreePath = path.join(worktreesDir, worktreeId);

  // Déterminer le commit de départ
  let startCommit = "HEAD";
  if (parentWorktreeId && session.worktrees.has(parentWorktreeId)) {
    const parent = session.worktrees.get(parentWorktreeId);
    // Obtenir le HEAD du worktree parent
    startCommit = await runCommandOutput("git", ["rev-parse", "HEAD"], {
      cwd: parent.path,
    });
    startCommit = startCommit.trim();
  } else if (startingBranch) {
    startCommit = startingBranch;
  }

  // Créer la branche
  await runCommand("git", ["branch", branchName, startCommit], {
    cwd: session.repoDir,
  });

  // Créer le worktree
  await runCommand("git", ["worktree", "add", worktreePath, branchName], {
    cwd: session.repoDir,
  });

  // Créer l'entrée worktree
  const worktree = {
    id: worktreeId,
    name: baseName,
    branchName,
    path: worktreePath,
    provider,
    client: null,
    messages: [],
    status: "creating",
    parentWorktreeId: parentWorktreeId || null,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    color: getNextColor(),
  };

  session.worktrees.set(worktreeId, worktree);

  // Créer et démarrer le client LLM
  try {
    const client =
      provider === "claude"
        ? new ClaudeCliClient({
            cwd: worktreePath,
            attachmentsDir: session.attachmentsDir,
          })
        : new CodexAppServerClient({ cwd: worktreePath });

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
  await runCommand("git", ["worktree", "remove", "--force", worktree.path], {
    cwd: session.repoDir,
  });

  // Supprimer la branche si demandé
  if (deleteBranch) {
    try {
      await runCommand("git", ["branch", "-D", worktree.branchName], {
        cwd: session.repoDir,
      });
    } catch (error) {
      // Ignorer si la branche n'existe plus
      console.warn("Could not delete branch:", worktree.branchName);
    }
  }

  // Supprimer de la Map
  session.worktrees.delete(worktreeId);
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
    runCommandOutput("git", ["status", "--porcelain"], { cwd: worktree.path }),
    runCommandOutput("git", ["diff"], { cwd: worktree.path }),
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

  const output = await runCommandOutput(
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
    await runCommand("git", ["merge", source.branchName, "--no-edit"], {
      cwd: target.path,
    });

    return { success: true };
  } catch (error) {
    // Vérifier s'il y a des conflits
    const status = await runCommandOutput("git", ["status", "--porcelain"], {
      cwd: target.path,
    });

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
  await runCommand("git", ["merge", "--abort"], { cwd: worktree.path });
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
    await runCommand("git", ["cherry-pick", commitSha], { cwd: target.path });
    return { success: true };
  } catch (error) {
    // Vérifier s'il y a des conflits
    const status = await runCommandOutput("git", ["status", "--porcelain"], {
      cwd: target.path,
    });

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
