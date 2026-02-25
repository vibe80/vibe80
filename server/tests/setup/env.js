import path from "path";
import os from "os";

process.env.NODE_ENV = "test";
process.env.VIBE80_STORAGE_BACKEND = process.env.VIBE80_STORAGE_BACKEND || "sqlite";
process.env.VIBE80_DEPLOYMENT_MODE = process.env.VIBE80_DEPLOYMENT_MODE || "multi_user";
process.env.VIBE80_JWT_KEY = process.env.VIBE80_JWT_KEY || "test-jwt-key";
process.env.VIBE80_JWT_KEY_PATH =
  process.env.VIBE80_JWT_KEY_PATH || path.join(os.tmpdir(), "vibe80-jwt-test.key");
