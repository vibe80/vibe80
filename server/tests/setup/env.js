import path from "path";
import os from "os";

process.env.NODE_ENV = "test";
process.env.STORAGE_BACKEND = process.env.STORAGE_BACKEND || "sqlite";
process.env.DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE || "multi_user";
process.env.JWT_KEY = process.env.JWT_KEY || "test-jwt-key";
process.env.JWT_KEY_PATH =
  process.env.JWT_KEY_PATH || path.join(os.tmpdir(), "vibe80-jwt-test.key");
