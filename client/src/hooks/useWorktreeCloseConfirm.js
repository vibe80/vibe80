import { useCallback, useState } from "react";

export default function useWorktreeCloseConfirm({
  closeConfirm,
  setCloseConfirm,
  setActiveWorktreeId,
  activeWorktreeIdRef,
  closeWorktree,
}) {
  const [closeConfirmDeleting, setCloseConfirmDeleting] = useState(false);

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
    if (closeConfirmDeleting) {
      return;
    }
    setCloseConfirm(null);
  }, [closeConfirmDeleting, setCloseConfirm]);

  const handleConfirmDelete = useCallback(async () => {
    if (!closeConfirm?.worktreeId || closeConfirmDeleting) {
      return;
    }
    setCloseConfirmDeleting(true);
    try {
      if (activeWorktreeIdRef.current === closeConfirm.worktreeId) {
        setActiveWorktreeId("main");
      }
      await closeWorktree(closeConfirm.worktreeId);
      setCloseConfirm(null);
    } finally {
      setCloseConfirmDeleting(false);
    }
  }, [
    activeWorktreeIdRef,
    closeConfirm,
    closeConfirmDeleting,
    closeWorktree,
    setActiveWorktreeId,
    setCloseConfirm,
  ]);

  return {
    openCloseConfirm,
    closeCloseConfirm,
    handleConfirmDelete,
    closeConfirmDeleting,
  };
}
