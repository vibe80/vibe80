import { useCallback } from "react";

export default function useWorktreeCloseConfirm({
  closeConfirm,
  setCloseConfirm,
  setActiveWorktreeId,
  activeWorktreeIdRef,
  closeWorktree,
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
    handleConfirmDelete,
  };
}
