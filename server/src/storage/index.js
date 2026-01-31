import { createRedisStorage } from "./redis.js";

const backend = process.env.STORAGE_BACKEND;

if (!backend) {
  throw new Error("STORAGE_BACKEND is required (redis or sqlite).");
}

let storage = null;

if (backend === "redis") {
  storage = createRedisStorage();
} else if (backend === "sqlite") {
  throw new Error("SQLite storage backend is not implemented yet.");
} else {
  throw new Error(`Unsupported STORAGE_BACKEND: ${backend}.`);
}

export const storageBackend = backend;
export default storage;
