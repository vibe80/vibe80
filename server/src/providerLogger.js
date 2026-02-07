import fs from "fs";
import os from "os";
import path from "path";

const isLoggingEnabled = () => {
  const value = process.env.ACTIVATE_PROVIDER_LOG;
  if (!value) {
    return false;
  }
  return !["0", "false", "off"].includes(String(value).toLowerCase());
};

export const createProviderLogger = ({ provider, sessionId, worktreeId }) => {
  if (!isLoggingEnabled()) {
    return null;
  }
  if (!sessionId) {
    return null;
  }
  const safeWorktreeId = worktreeId || "main";
  const baseDir =
    process.env.PROVIDER_LOG_DIRECTORY || path.join(os.homedir(), "logs");
  try {
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    const filePath = path.join(
      baseDir,
      `${provider}_${sessionId}_${safeWorktreeId}.log`
    );
    const stream = fs.createWriteStream(filePath, { flags: "a" });
    stream.on("error", (error) => {
      console.warn(
        `[provider-log] Failed to write ${provider} log: ${error?.message || error}`
      );
    });
    return {
      filePath,
      writeLine: (prefix, line) => {
        const text = line == null ? "" : String(line);
        if (!text) {
          return;
        }
        const lines = text.split(/\r?\n/);
        for (const entry of lines) {
          if (entry === "") {
            continue;
          }
          stream.write(`${prefix}::${entry}\n`);
        }
      },
      close: () => {
        stream.end();
      },
    };
  } catch (error) {
    console.warn(
      `[provider-log] Failed to initialize ${provider} log: ${error?.message || error}`
    );
    return null;
  }
};
