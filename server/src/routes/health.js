import { Router } from "express";

export default function healthRoutes(deps) {
  const { deploymentMode } = deps;

  const router = Router();

  router.get("/health", async (req, res) => {
    res.json({ ok: true, ready: true, deploymentMode });
  });

  return router;
}
