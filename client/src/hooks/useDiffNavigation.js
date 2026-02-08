import { useCallback } from "react";

export default function useDiffNavigation({
  activeWorktreeId,
  handleViewSelect,
  requestWorktreeDiff,
  requestRepoDiff,
}) {
  const handleDiffSelect = useCallback(() => {
    handleViewSelect("diff");
    if (activeWorktreeId && activeWorktreeId !== "main") {
      requestWorktreeDiff(activeWorktreeId);
    } else {
      requestRepoDiff();
    }
  }, [activeWorktreeId, handleViewSelect, requestRepoDiff, requestWorktreeDiff]);

  return { handleDiffSelect };
}
