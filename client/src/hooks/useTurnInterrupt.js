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
    if (isInWorktree && activeWorktreeId) {
      socketRef.current.send(
        JSON.stringify({
          type: "worktree_turn_interrupt",
          worktreeId: activeWorktreeId,
          turnId: currentTurnIdForActive,
        })
      );
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
    socketRef.current.send(
      JSON.stringify({ type: "turn_interrupt", turnId: currentTurnIdForActive })
    );
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
