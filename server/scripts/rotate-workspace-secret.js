#!/usr/bin/env node

import storage from "../src/storage/index.js";
import {
  workspaceIdPattern,
  rotateWorkspaceSecret,
} from "../src/services/workspace.js";

const printUsage = () => {
  console.error(
    [
      "Usage:",
      "  node server/scripts/rotate-workspace-secret.js --workspace-id <workspaceId> [--workspace-secret <secret>] [--json]",
      "",
      "Requirements:",
      "  - SERVER env vars must be set (e.g. STORAGE_BACKEND, DEPLOYMENT_MODE, etc.)",
    ].join("\n")
  );
};

const parseArgs = (argv) => {
  const args = {
    workspaceId: "",
    workspaceSecret: "",
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--workspace-id") {
      args.workspaceId = String(argv[i + 1] || "").trim();
      i += 1;
      continue;
    }
    if (token === "--workspace-secret") {
      args.workspaceSecret = String(argv[i + 1] || "");
      i += 1;
      continue;
    }
    if (token === "--json") {
      args.json = true;
      continue;
    }
    if (token === "-h" || token === "--help") {
      args.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    process.exit(0);
  }

  if (!args.workspaceId) {
    throw new Error("--workspace-id is required.");
  }

  if (!workspaceIdPattern.test(args.workspaceId)) {
    throw new Error(`Invalid workspaceId: ${args.workspaceId}`);
  }

  if (args.workspaceSecret.trim() === "") {
    args.workspaceSecret = "";
  }

  await storage.init();
  try {
    const result = await rotateWorkspaceSecret(args.workspaceId, {
      workspaceSecret: args.workspaceSecret || undefined,
      actor: "cli",
    });

    if (args.json) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }

    process.stdout.write(
      [
        "Workspace secret rotated successfully.",
        `workspaceId=${result.workspaceId}`,
        `workspaceSecret=${result.workspaceSecret}`,
      ].join("\n") + "\n"
    );
  } finally {
    await storage.close();
  }
};

main().catch((error) => {
  console.error(error?.message || error);
  printUsage();
  process.exit(1);
});
