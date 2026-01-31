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
      `CREATE TABLE IF NOT EXISTS workspace_user_ids (
        workspaceId TEXT PRIMARY KEY,
        data TEXT NOT NULL
      );`
    );
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
    saveWorkspaceUserIds,
    getWorkspaceUserIds,
  };
};
