import { useCallback } from "react";

export default function useWorktreeCloseConfirm({
  closeConfirm,
  setCloseConfirm,
  setActiveWorktreeId,
  activeWorktreeIdRef,
  closeWorktree,
  sendWorktreeMessage,
  mergeTargetBranch,
  t,
}) {
  const openCloseConfirm = useCallback(
    (worktreeId) => {
      if (!worktreeId || worktreeId === "main") {
        return;
      }
      setCloseConfirm({ worktreeId });
    },
    [setCloseConfirm]
  );

  const closeCloseConfirm = useCallback(() => {
    setCloseConfirm(null);
  }, [setCloseConfirm]);

  const handleConfirmMerge = useCallback(() => {
    if (!closeConfirm?.worktreeId) {
      return;
    }
    sendWorktreeMessage(
      closeConfirm.worktreeId,
      t("Merge into {{branch}}", { branch: mergeTargetBranch }),
      []
    );
    setCloseConfirm(null);
  }, [closeConfirm, mergeTargetBranch, sendWorktreeMessage, setCloseConfirm, t]);

  const handleConfirmDelete = useCallback(async () => {
    if (!closeConfirm?.worktreeId) {
      return;
    }
    if (activeWorktreeIdRef.current === closeConfirm.worktreeId) {
      setActiveWorktreeId("main");
    }
    await closeWorktree(closeConfirm.worktreeId);
    setCloseConfirm(null);
  }, [
    activeWorktreeIdRef,
    closeConfirm,
    closeWorktree,
    setActiveWorktreeId,
    setCloseConfirm,
  ]);

  return {
    openCloseConfirm,
    closeCloseConfirm,
    handleConfirmMerge,
    handleConfirmDelete,
  };
}
