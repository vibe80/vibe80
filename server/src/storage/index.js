import { createRedisStorage } from "./redis.js";
import { createSqliteStorage } from "./sqlite.js";

const backend = process.env.VIBE80_STORAGE_BACKEND || "sqlite";

let storage = null;

if (backend === "redis") {
  storage = createRedisStorage();
} else if (backend === "sqlite") {
  storage = createSqliteStorage();
} else {
  throw new Error(`Unsupported VIBE80_STORAGE_BACKEND: ${backend}.`);
}

export const storageBackend = backend;
export default storage;
