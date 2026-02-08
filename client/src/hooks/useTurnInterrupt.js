import { useCallback } from "react";

export default function useTurnInterrupt({
  activeWorktreeId,
  isInWorktree,
  currentTurnIdForActive,
  socketRef,
  setWorktrees,
  setActivity,
}) {
  const interruptTurn = useCallback(() => {
    if (!currentTurnIdForActive || !socketRef.current) {
      return;
    }
    const payload = {
      type: "turn_interrupt",
      turnId: currentTurnIdForActive,
      worktreeId: isInWorktree && activeWorktreeId ? activeWorktreeId : undefined,
    };
    socketRef.current.send(JSON.stringify(payload));
    if (isInWorktree && activeWorktreeId) {
      setWorktrees((current) => {
        const next = new Map(current);
        const wt = next.get(activeWorktreeId);
        if (wt) {
          next.set(activeWorktreeId, { ...wt, activity: "Interruption..." });
        }
        return next;
      });
      return;
    }
    setActivity("Interruption...");
  }, [
    activeWorktreeId,
    currentTurnIdForActive,
    isInWorktree,
    setActivity,
    setWorktrees,
    socketRef,
  ]);

  return { interruptTurn };
}
