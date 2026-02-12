import { useCallback, useEffect, useMemo, useState } from "react";

const MAX_UNTRACKED_FILE_PANELS = 100;

const parseStatusLine = (line) => {
  const raw = String(line || "").trim();
  if (!raw) return null;
  const code = raw.slice(0, 2);
  let path = raw.slice(3).trim();
  if (!code || !path) return null;
  if ((code.startsWith("R") || code.startsWith("C")) && path.includes(" -> ")) {
    path = path.split(" -> ").pop()?.trim() || path;
  }
  if (path.startsWith("\"") && path.endsWith("\"")) {
    try {
      path = JSON.parse(path);
    } catch {
      // Keep raw quoted path if parsing fails.
    }
  }
  return { code, path };
};

export default function useRepoStatus({
  apiFetch,
  attachmentSessionId,
  currentBranch,
  activeWorktreeId,
  parseDiff,
  setWorktrees,
  worktrees,
  t,
}) {
  const [repoDiff, setRepoDiff] = useState({ status: "", diff: "" });
  const [repoLastCommit, setRepoLastCommit] = useState(null);
  const [untrackedFilePanels, setUntrackedFilePanels] = useState([]);
  const [untrackedLoading, setUntrackedLoading] = useState(false);
  const [worktreeLastCommitById, setWorktreeLastCommitById] = useState(
    new Map()
  );

  const currentDiff = useMemo(() => {
    if (activeWorktreeId && activeWorktreeId !== "main") {
      const wt = worktrees.get(activeWorktreeId);
      return wt?.diff || { status: "", diff: "" };
    }
    return repoDiff;
  }, [activeWorktreeId, worktrees, repoDiff]);

  const diffFiles = useMemo(() => {
    if (!currentDiff.diff) {
      return [];
    }
    try {
      return parseDiff(currentDiff.diff);
    } catch {
      return [];
    }
  }, [currentDiff.diff, parseDiff]);

  const diffStatusLines = useMemo(
    () =>
      (currentDiff.status || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [currentDiff.status]
  );
  const parsedStatusEntries = useMemo(
    () => diffStatusLines.map(parseStatusLine).filter(Boolean),
    [diffStatusLines]
  );
  const untrackedRoots = useMemo(() => {
    const seen = new Set();
    const result = [];
    parsedStatusEntries.forEach((entry) => {
      if (entry.code !== "??") return;
      const normalized = String(entry.path || "").trim().replace(/\\/g, "/");
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      result.push(normalized);
    });
    return result;
  }, [parsedStatusEntries]);

  const hasCurrentChanges = useMemo(
    () => diffStatusLines.length > 0 || Boolean((currentDiff.diff || "").trim()),
    [diffStatusLines.length, currentDiff.diff]
  );

  useEffect(() => {
    if (!attachmentSessionId) {
      setUntrackedFilePanels([]);
      setUntrackedLoading(false);
      return;
    }
    if (!untrackedRoots.length) {
      setUntrackedFilePanels([]);
      setUntrackedLoading(false);
      return;
    }

    let cancelled = false;
    const worktreeId =
      activeWorktreeId && activeWorktreeId !== "main" ? activeWorktreeId : "main";

    const load = async () => {
      setUntrackedLoading(true);
      const queue = [...untrackedRoots];
      const visited = new Set();
      const panels = [];

      while (
        queue.length > 0 &&
        panels.length < MAX_UNTRACKED_FILE_PANELS &&
        !cancelled
      ) {
        const currentPath = String(queue.shift() || "").trim();
        if (!currentPath || visited.has(currentPath)) {
          continue;
        }
        visited.add(currentPath);

        const shouldBrowseFirst = currentPath.endsWith("/");

        if (!shouldBrowseFirst) {
          try {
            const fileResponse = await apiFetch(
              `/api/sessions/${encodeURIComponent(
                attachmentSessionId
              )}/worktrees/${encodeURIComponent(worktreeId)}/file?path=${encodeURIComponent(
                currentPath
              )}`
            );
            if (fileResponse.ok) {
              const payload = await fileResponse.json().catch(() => ({}));
              panels.push({
                path: currentPath,
                binary: Boolean(payload?.binary),
                content: payload?.content || "",
                truncated: Boolean(payload?.truncated),
                error: false,
              });
              continue;
            }
          } catch {
            // Fall through to directory probe.
          }
        }

        try {
          const browseResponse = await apiFetch(
            `/api/sessions/${encodeURIComponent(
              attachmentSessionId
            )}/worktrees/${encodeURIComponent(worktreeId)}/browse?path=${encodeURIComponent(
              currentPath
            )}`
          );
          if (!browseResponse.ok) {
            panels.push({
              path: currentPath,
              binary: false,
              content: "",
              truncated: false,
              error: true,
            });
            continue;
          }
          const payload = await browseResponse.json().catch(() => ({}));
          const entries = Array.isArray(payload?.entries) ? payload.entries : [];
          entries.forEach((entry) => {
            if (!entry?.path) return;
            queue.push(entry.path);
          });
        } catch {
          panels.push({
            path: currentPath,
            binary: false,
            content: "",
            truncated: false,
            error: true,
          });
        }
      }

      if (cancelled) return;
      setUntrackedFilePanels(panels);
      setUntrackedLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeWorktreeId, apiFetch, attachmentSessionId, untrackedRoots]);

  const loadRepoLastCommit = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    try {
      const response = await apiFetch(
        `/api/sessions/${encodeURIComponent(attachmentSessionId)}/last-commit`
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t("Unable to load the latest commit."));
      }
      const commit = payload.commit || {};
      setRepoLastCommit({
        branch: payload.branch || "",
        sha: commit.sha || "",
        message: commit.message || "",
      });
    } catch (error) {
      setRepoLastCommit(null);
    }
  }, [attachmentSessionId, apiFetch, t]);

  const loadWorktreeLastCommit = useCallback(
    async (worktreeId) => {
      if (!attachmentSessionId || !worktreeId) {
        return;
      }
      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(worktreeId)}/commits?limit=1`
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || t("Unable to load the commit."));
        }
        const commit = Array.isArray(payload.commits)
          ? payload.commits[0]
          : null;
        if (!commit?.sha) {
          return;
        }
        setWorktreeLastCommitById((current) => {
          const next = new Map(current);
          next.set(worktreeId, { sha: commit.sha, message: commit.message || "" });
          return next;
        });
      } catch {
        // Ignore worktree commit errors.
      }
    },
    [attachmentSessionId, apiFetch, t]
  );

  const requestWorktreeDiff = useCallback(
    async (worktreeId) => {
      if (!attachmentSessionId || !worktreeId) {
        return;
      }
      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(worktreeId)}/diff`
        );
        if (!response.ok) {
          return;
        }
        const payload = await response.json();
        if (!payload) {
          return;
        }
        setWorktrees((current) => {
          const next = new Map(current);
          const wt = next.get(worktreeId);
          if (wt) {
            next.set(worktreeId, {
              ...wt,
              diff: {
                status: payload.status || "",
                diff: payload.diff || "",
              },
            });
          }
          return next;
        });
      } catch {
        // Ignore diff refresh failures.
      }
    },
    [attachmentSessionId, apiFetch, setWorktrees]
  );

  const requestRepoDiff = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    try {
      const response = await apiFetch(
        `/api/sessions/${encodeURIComponent(attachmentSessionId)}/diff`
      );
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      if (!payload) {
        return;
      }
      setRepoDiff({
        status: payload.status || "",
        diff: payload.diff || "",
      });
    } catch {
      // Ignore diff refresh failures.
    }
  }, [attachmentSessionId, apiFetch]);

  useEffect(() => {
    if (!attachmentSessionId) {
      setRepoLastCommit(null);
      setWorktreeLastCommitById(new Map());
      return;
    }
    loadRepoLastCommit();
  }, [attachmentSessionId, loadRepoLastCommit]);

  useEffect(() => {
    if (!attachmentSessionId) {
      return;
    }
    void loadRepoLastCommit();
  }, [attachmentSessionId, currentBranch, loadRepoLastCommit]);

  return {
    currentDiff,
    diffFiles,
    diffStatusLines,
    hasCurrentChanges,
    untrackedFilePanels,
    untrackedLoading,
    loadRepoLastCommit,
    loadWorktreeLastCommit,
    repoDiff,
    repoLastCommit,
    requestRepoDiff,
    requestWorktreeDiff,
    setRepoDiff,
    setRepoLastCommit,
    setWorktreeLastCommitById,
    worktreeLastCommitById,
  };
}
