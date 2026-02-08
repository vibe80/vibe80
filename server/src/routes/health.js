import { Router } from "express";

export default function healthRoutes(deps) {
  const { getSession, touchSession, getActiveClient, deploymentMode, debugApiWsLog } = deps;

  const router = Router();

  router.get("/health", async (req, res) => {
    const session = await getSession(req.query.session, req.workspaceId);
    if (!session) {
      res.json({ ok: true, ready: false, threadId: null, deploymentMode });
      return;
    }
    await touchSession(session);
    const activeClient = getActiveClient(session);
    res.json({
      ok: true,
      ready: activeClient?.ready || false,
      threadId: activeClient?.threadId || null,
      provider: session.activeProvider || "codex",
      deploymentMode,
    });
  });

  return router;
}
