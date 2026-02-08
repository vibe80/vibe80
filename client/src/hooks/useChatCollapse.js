import { useMemo, useState } from "react";

export default function useChatCollapse({
  activeChatKey,
  displayedGroupedMessages,
  CHAT_COLLAPSE_THRESHOLD,
  CHAT_COLLAPSE_VISIBLE,
}) {
  const [showOlderMessagesByTab, setShowOlderMessagesByTab] = useState({});
  const showOlderMessages = Boolean(showOlderMessagesByTab[activeChatKey]);
  const collapsedMessages = useMemo(() => {
    const total = displayedGroupedMessages.length;
    const shouldCollapse = !showOlderMessages && total > CHAT_COLLAPSE_THRESHOLD;
    if (!shouldCollapse) {
      return {
        visibleMessages: displayedGroupedMessages,
        hiddenCount: 0,
        isCollapsed: false,
      };
    }
    const visibleMessages = displayedGroupedMessages.slice(
      Math.max(0, total - CHAT_COLLAPSE_VISIBLE)
    );
    return {
      visibleMessages,
      hiddenCount: Math.max(0, total - visibleMessages.length),
      isCollapsed: true,
    };
  }, [
    displayedGroupedMessages,
    showOlderMessages,
    CHAT_COLLAPSE_THRESHOLD,
    CHAT_COLLAPSE_VISIBLE,
  ]);

  return {
    showOlderMessagesByTab,
    setShowOlderMessagesByTab,
    showOlderMessages,
    collapsedMessages,
  };
}
