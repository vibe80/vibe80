import path from "path";
import { getWorkspaceHome, runAsCommand } from "../runAs.js";

export const buildClaudeThreadRelativeDirectory = (cwd) =>
  String(cwd || "")
    .trim()
    .replaceAll("/", "-");

export const resolveClaudeThreadDirectory = (workspaceId, cwd) => {
  const workspaceHome = getWorkspaceHome(workspaceId);
  const threadRelativeDirectory = buildClaudeThreadRelativeDirectory(cwd);
  return path.join(workspaceHome, ".claude", "projects", threadRelativeDirectory);
};

export const copyClaudeThreadDirectory = async (workspaceId, sourceCwd, targetCwd) => {
  const sourceThreadDirectory = resolveClaudeThreadDirectory(workspaceId, sourceCwd);
  const targetThreadDirectory = resolveClaudeThreadDirectory(workspaceId, targetCwd);
  const targetParent = path.dirname(targetThreadDirectory);

  await runAsCommand(workspaceId, "/bin/mkdir", ["-p", targetParent]);
  await runAsCommand(workspaceId, "/bin/rm", ["-rf", targetThreadDirectory]);
  await runAsCommand(workspaceId, "/bin/mkdir", ["-p", targetThreadDirectory]);
  await runAsCommand(
    workspaceId,
    "/bin/cp",
    ["-a", `${sourceThreadDirectory}/.`, targetThreadDirectory]
  );

  return {
    sourceThreadDirectory,
    targetThreadDirectory,
  };
};
