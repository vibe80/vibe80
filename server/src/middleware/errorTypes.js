export function errorTypesMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (
      res.statusCode >= 400 &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      !body.error_type
    ) {
      const message = String(body.error || body.message || "");
      const normalized = message.toLowerCase();
      let errorType = `HTTP_${res.statusCode}`;
      if (res.statusCode === 401) {
        if (normalized.includes("missing workspace token")) {
          errorType = "WORKSPACE_TOKEN_MISSING";
        } else if (normalized.includes("invalid workspace token")) {
          errorType = "WORKSPACE_TOKEN_INVALID";
        } else {
          errorType = "UNAUTHORIZED";
        }
      } else if (res.statusCode === 403) {
        if (normalized.includes("invalid workspace credentials")) {
          errorType = "WORKSPACE_CREDENTIALS_INVALID";
        } else if (normalized.includes("provider not enabled")) {
          errorType = "PROVIDER_NOT_ENABLED";
        } else {
          errorType = "FORBIDDEN";
        }
      } else if (res.statusCode === 404) {
        if (normalized.includes("session not found")) {
          errorType = "SESSION_NOT_FOUND";
        } else if (normalized.includes("worktree not found")) {
          errorType = "WORKTREE_NOT_FOUND";
        } else {
          errorType = "NOT_FOUND";
        }
      } else if (res.statusCode === 400) {
        if (normalized.includes("invalid workspaceid")) {
          errorType = "WORKSPACE_ID_INVALID";
        } else if (normalized.includes("repourl is required")) {
          errorType = "REPO_URL_REQUIRED";
        } else if (normalized.includes("invalid provider")) {
          errorType = "PROVIDER_INVALID";
        } else if (normalized.includes("invalid session")) {
          errorType = "SESSION_INVALID";
        } else if (normalized.includes("branch is required")) {
          errorType = "BRANCH_REQUIRED";
        } else {
          errorType = "BAD_REQUEST";
        }
      } else if (res.statusCode >= 500) {
        errorType = "INTERNAL_ERROR";
      }
      body = { ...body, error_type: errorType };
    }
    return originalJson(body);
  };
  next();
}
