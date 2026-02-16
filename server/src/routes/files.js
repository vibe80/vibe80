import path from "path";
import fs from "fs";
import { Router } from "express";
import { runAsCommand } from "../runAs.js";
import { sanitizeFilename } from "../helpers.js";
import {
  getSession,
  touchSession,
  runSessionCommandOutput,
  upload,
} from "../services/session.js";

export default function fileRoutes() {
  const router = Router();

  router.get("/sessions/:sessionId/attachments/file", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);
    const rawPath = req.query.path;
    const rawName = req.query.name;
    if (!rawPath && !rawName) {
      res.status(400).json({ error: "Attachment path is required." });
      return;
    }
    const candidatePath = rawPath
      ? path.resolve(rawPath)
      : path.resolve(session.attachmentsDir, sanitizeFilename(rawName));
    const relative = path.relative(session.attachmentsDir, candidatePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      res.status(400).json({ error: "Invalid attachment path." });
      return;
    }
    try {
      const data = await runSessionCommandOutput(session, "/bin/cat", [candidatePath], {
        binary: true,
      });
      if (rawName) {
        res.setHeader("Content-Disposition", `attachment; filename="${sanitizeFilename(rawName)}"`);
      }
      res.send(data);
    } catch (error) {
      res.status(404).json({ error: "Attachment not found." });
    }
  });

  router.get("/sessions/:sessionId/attachments", async (req, res) => {
    const sessionId = req.params.sessionId;
    const session = await getSession(sessionId, req.workspaceId);
    if (!session) {
      res.status(400).json({ error: "Invalid session." });
      return;
    }
    await touchSession(session);
    try {
      const output = await runSessionCommandOutput(
        session,
        "/usr/bin/find",
        [session.attachmentsDir, "-maxdepth", "1", "-mindepth", "1", "-type", "f", "-printf", "%f\t%s\0"],
        { binary: true }
      );
      const files = output
        .toString("utf8")
        .split("\0")
        .filter(Boolean)
        .map((line) => {
          const [name, sizeRaw] = line.split("\t");
          return {
            name,
            path: path.join(session.attachmentsDir, name),
            size: Number.parseInt(sizeRaw, 10),
          };
        });
      res.json({ files });
    } catch (error) {
      res.status(500).json({ error: "Failed to list attachments." });
    }
  });

  router.post(
    "/sessions/:sessionId/attachments/upload",
    upload.array("files"),
    async (req, res) => {
      const sessionId = req.params.sessionId;
      const session = await getSession(sessionId, req.workspaceId);
      if (!session) {
        res.status(400).json({ error: "Invalid session." });
        return;
      }
      await touchSession(session);
      const uploaded = [];
      for (const file of req.files || []) {
        const targetPath = path.join(session.attachmentsDir, file.filename);
        const inputStream = fs.createReadStream(file.path);
        await runAsCommand(session.workspaceId, "/usr/bin/tee", [targetPath], {
          input: inputStream,
        });
        await fs.promises.rm(file.path, { force: true });
        uploaded.push({
          name: file.filename,
          path: targetPath,
          size: file.size,
        });
      }
      res.json({ files: uploaded });
    }
  );

  return router;
}
