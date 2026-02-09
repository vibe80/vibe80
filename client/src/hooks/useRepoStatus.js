import { useCallback, useEffect, useMemo, useState } from "react";

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

  const hasCurrentChanges = useMemo(
    () => diffStatusLines.length > 0 || Boolean((currentDiff.diff || "").trim()),
    [diffStatusLines.length, currentDiff.diff]
  );

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
