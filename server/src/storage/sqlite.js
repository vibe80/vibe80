import fs from "fs";
import path from "path";
import sqlite3 from "sqlite3";

const toJson = (value) => JSON.stringify(value);
const fromJson = (value) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const openDatabase = (filename) =>
  new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      filename,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,
      (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(db);
      }
    );
  });

const run = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this);
    });
  });

const get = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(row || null);
    });
  });

const all = (db, sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });

export const createSqliteStorage = () => {
  const dbPath = process.env.SQLITE_PATH;
  if (!dbPath) {
    throw new Error("SQLITE_PATH is required when STORAGE_BACKEND=sqlite.");
  }
  const resolvedPath = path.resolve(dbPath);
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o750 });

  let db = null;

  const ensureConnected = async () => {
    if (db) return;
    db = await openDatabase(resolvedPath);
    await run(db, "PRAGMA journal_mode = WAL;");
    await run(db, "PRAGMA busy_timeout = 5000;");
    await run(db, "PRAGMA foreign_keys = ON;");
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS sessions (
        sessionId TEXT PRIMARY KEY,
        workspaceId TEXT,
        createdAt INTEGER,
        lastActivityAt INTEGER,
        data TEXT NOT NULL
      );`
    );
    await run(
      db,
      `CREATE INDEX IF NOT EXISTS sessions_workspace_idx
       ON sessions (workspaceId);`
    );
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS worktrees (
        worktreeId TEXT PRIMARY KEY,
        sessionId TEXT NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY(sessionId) REFERENCES sessions(sessionId) ON DELETE CASCADE
      );`
    );
    await run(
      db,
      `CREATE INDEX IF NOT EXISTS worktrees_session_idx
       ON worktrees (sessionId);`
    );
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS worktree_messages (
        messageId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        worktreeId TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (worktreeId, messageId),
        FOREIGN KEY(sessionId) REFERENCES sessions(sessionId) ON DELETE CASCADE
      );`
    );
    await run(
      db,
      `CREATE INDEX IF NOT EXISTS worktree_messages_session_idx
       ON worktree_messages (sessionId, worktreeId, createdAt DESC);`
    );
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS workspace_user_ids (
        workspaceId TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );`
    );
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS workspace_refresh_tokens (
        workspaceId TEXT PRIMARY KEY,
        tokenHash TEXT UNIQUE,
        expiresAt INTEGER
      );`
    );
    await run(
      db,
      `CREATE INDEX IF NOT EXISTS workspace_refresh_tokens_hash_idx
       ON workspace_refresh_tokens (tokenHash);`
    );
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS workspace_uid_seq (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        lastUid INTEGER NOT NULL
      );`
    );
    const row = await get(db, "SELECT lastUid FROM workspace_uid_seq WHERE id = 1");
    if (!row) {
      const workspaceUidMin =
        Number.parseInt(process.env.WORKSPACE_UID_MIN, 10) || 200000;
      await run(
        db,
        "INSERT INTO workspace_uid_seq (id, lastUid) VALUES (1, ?)",
        [workspaceUidMin - 1]
      );
    }
  };

  const saveSession = async (sessionId, data) => {
    await ensureConnected();
    const createdAt =
      typeof data?.createdAt === "number" ? data.createdAt : Date.now();
    const lastActivityAt =
      typeof data?.lastActivityAt === "number" ? data.lastActivityAt : Date.now();
    await run(
      db,
      `INSERT INTO sessions (sessionId, workspaceId, createdAt, lastActivityAt, data)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sessionId) DO UPDATE SET
         workspaceId=excluded.workspaceId,
         createdAt=excluded.createdAt,
         lastActivityAt=excluded.lastActivityAt,
         data=excluded.data;`,
      [sessionId, data?.workspaceId || null, createdAt, lastActivityAt, toJson(data)]
    );
  };

  const getSession = async (sessionId) => {
    await ensureConnected();
    const row = await get(
      db,
      "SELECT data FROM sessions WHERE sessionId = ?",
      [sessionId]
    );
    return fromJson(row?.data);
  };

  const deleteSession = async (sessionId) => {
    await ensureConnected();
    await run(db, "DELETE FROM worktree_messages WHERE sessionId = ?", [sessionId]);
    await run(db, "DELETE FROM worktrees WHERE sessionId = ?", [sessionId]);
    await run(db, "DELETE FROM sessions WHERE sessionId = ?", [sessionId]);
  };

  const listSessions = async (workspaceId) => {
    await ensureConnected();
    const rows = await all(
      db,
      workspaceId
        ? "SELECT data FROM sessions WHERE workspaceId = ?"
        : "SELECT data FROM sessions",
      workspaceId ? [workspaceId] : []
    );
    return rows.map((row) => fromJson(row.data)).filter(Boolean);
  };

  const touchSession = async (sessionId) => {
    await ensureConnected();
    await run(
      db,
      "UPDATE sessions SET lastActivityAt = ? WHERE sessionId = ?",
      [Date.now(), sessionId]
    );
  };

  const saveWorktree = async (sessionId, worktreeId, data) => {
    await ensureConnected();
    await run(
      db,
      `INSERT INTO worktrees (worktreeId, sessionId, data)
       VALUES (?, ?, ?)
       ON CONFLICT(worktreeId) DO UPDATE SET
         sessionId=excluded.sessionId,
         data=excluded.data;`,
      [worktreeId, sessionId, toJson(data)]
    );
  };

  const getWorktree = async (worktreeId) => {
    await ensureConnected();
    const row = await get(
      db,
      "SELECT data FROM worktrees WHERE worktreeId = ?",
      [worktreeId]
    );
    return fromJson(row?.data);
  };

  const deleteWorktree = async (sessionId, worktreeId) => {
    await ensureConnected();
    await run(
      db,
      "DELETE FROM worktree_messages WHERE worktreeId = ? AND sessionId = ?",
      [worktreeId, sessionId]
    );
    await run(
      db,
      "DELETE FROM worktrees WHERE worktreeId = ? AND sessionId = ?",
      [worktreeId, sessionId]
    );
  };

  const listWorktrees = async (sessionId) => {
    await ensureConnected();
    const rows = await all(
      db,
      "SELECT data FROM worktrees WHERE sessionId = ?",
      [sessionId]
    );
    return rows.map((row) => fromJson(row.data)).filter(Boolean);
  };

  const appendWorktreeMessage = async (sessionId, worktreeId, message) => {
    await ensureConnected();
    const messageId = message?.id;
    if (!messageId) {
      throw new Error("Message id is required.");
    }
    const createdAt =
      typeof message?.createdAt === "number" ? message.createdAt : Date.now();
    await run(
      db,
      `INSERT INTO worktree_messages (messageId, sessionId, worktreeId, createdAt, data)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(worktreeId, messageId) DO NOTHING;`,
      [messageId, sessionId, worktreeId, createdAt, toJson(message)]
    );
  };

  const getWorktreeMessages = async (
    sessionId,
    worktreeId,
    { limit = null, beforeMessageId = null } = {}
  ) => {
    await ensureConnected();
    let createdAfter = null;
    if (beforeMessageId) {
      const row = await get(
        db,
        `SELECT createdAt FROM worktree_messages
         WHERE sessionId = ? AND worktreeId = ? AND messageId = ?`,
        [sessionId, worktreeId, beforeMessageId]
      );
      if (!row) {
        return [];
      }
      createdAfter = row.createdAt;
    }

    let rows;
    if (createdAfter !== null) {
      if (limit) {
        rows = await all(
          db,
          `SELECT data FROM worktree_messages
           WHERE sessionId = ? AND worktreeId = ? AND createdAt > ?
           ORDER BY createdAt DESC
           LIMIT ?`,
          [sessionId, worktreeId, createdAfter, limit]
        );
        rows.reverse();
      } else {
        rows = await all(
          db,
          `SELECT data FROM worktree_messages
           WHERE sessionId = ? AND worktreeId = ? AND createdAt > ?
           ORDER BY createdAt ASC`,
          [sessionId, worktreeId, createdAfter]
        );
      }
    } else if (limit) {
      rows = await all(
        db,
        `SELECT data FROM worktree_messages
         WHERE sessionId = ? AND worktreeId = ?
         ORDER BY createdAt DESC
         LIMIT ?`,
        [sessionId, worktreeId, limit]
      );
      rows.reverse();
    } else {
      rows = await all(
        db,
        `SELECT data FROM worktree_messages
         WHERE sessionId = ? AND worktreeId = ?
         ORDER BY createdAt ASC`,
        [sessionId, worktreeId]
      );
    }

    return rows.map((row) => fromJson(row.data)).filter(Boolean);
  };

  const clearWorktreeMessages = async (sessionId, worktreeId) => {
    await ensureConnected();
    await run(
      db,
      "DELETE FROM worktree_messages WHERE sessionId = ? AND worktreeId = ?",
      [sessionId, worktreeId]
    );
  };

  const saveWorkspaceUserIds = async (workspaceId, data) => {
    await ensureConnected();
    await run(
      db,
      `INSERT INTO workspace_user_ids (workspaceId, data)
       VALUES (?, ?)
       ON CONFLICT(workspaceId) DO UPDATE SET data=excluded.data;`,
      [workspaceId, toJson(data)]
    );
  };

  const getWorkspaceUserIds = async (workspaceId) => {
    await ensureConnected();
    const row = await get(
      db,
      "SELECT data FROM workspace_user_ids WHERE workspaceId = ?",
      [workspaceId]
    );
    return fromJson(row?.data);
  };

  const saveWorkspaceRefreshToken = async (
    workspaceId,
    tokenHash,
    expiresAt,
    _ttlMs = null
  ) => {
    await ensureConnected();
    await run(
      db,
      `INSERT INTO workspace_refresh_tokens (workspaceId, tokenHash, expiresAt)
       VALUES (?, ?, ?)
       ON CONFLICT(workspaceId) DO UPDATE SET
         tokenHash=excluded.tokenHash,
         expiresAt=excluded.expiresAt;`,
      [workspaceId, tokenHash, expiresAt]
    );
  };

  const getWorkspaceRefreshToken = async (tokenHash) => {
    await ensureConnected();
    const row = await get(
      db,
      "SELECT workspaceId, tokenHash, expiresAt FROM workspace_refresh_tokens WHERE tokenHash = ?",
      [tokenHash]
    );
    if (!row) return null;
    return {
      workspaceId: row.workspaceId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
    };
  };

  const deleteWorkspaceRefreshToken = async (tokenHash) => {
    await ensureConnected();
    await run(
      db,
      "DELETE FROM workspace_refresh_tokens WHERE tokenHash = ?",
      [tokenHash]
    );
  };

  const getNextWorkspaceUid = async () => {
    await ensureConnected();
    const workspaceUidMin =
      Number.parseInt(process.env.WORKSPACE_UID_MIN, 10) || 200000;
    const workspaceUidMax =
      Number.parseInt(process.env.WORKSPACE_UID_MAX, 10) || 999999999;
    await run(db, "BEGIN IMMEDIATE");
    try {
      const row = await get(db, "SELECT lastUid FROM workspace_uid_seq WHERE id = 1");
      const lastUid = Number(row?.lastUid ?? workspaceUidMin - 1);
      const nextUid = lastUid + 1;
      if (nextUid > workspaceUidMax) {
        throw new Error("Workspace UID range exhausted.");
      }
      await run(db, "UPDATE workspace_uid_seq SET lastUid = ? WHERE id = 1", [
        nextUid,
      ]);
      await run(db, "COMMIT");
      return nextUid;
    } catch (error) {
      await run(db, "ROLLBACK");
      throw error;
    }
  };

  return {
    init: ensureConnected,
    close: async () => {
      if (!db) return;
      await new Promise((resolve, reject) => {
        db.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
      db = null;
    },
    saveSession,
    getSession,
    deleteSession,
    listSessions,
    touchSession,
    saveWorktree,
    getWorktree,
    deleteWorktree,
    listWorktrees,
    appendWorktreeMessage,
    getWorktreeMessages,
    clearWorktreeMessages,
    saveWorkspaceUserIds,
    getWorkspaceUserIds,
    saveWorkspaceRefreshToken,
    getWorkspaceRefreshToken,
    deleteWorkspaceRefreshToken,
    getNextWorkspaceUid,
  };
};
