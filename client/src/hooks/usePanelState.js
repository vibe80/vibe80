import { useState } from "react";

export default function usePanelState() {
  const [commandPanelOpen, setCommandPanelOpen] = useState({});
  const [toolResultPanelOpen, setToolResultPanelOpen] = useState({});

  return {
    commandPanelOpen,
    setCommandPanelOpen,
    toolResultPanelOpen,
    setToolResultPanelOpen,
  };
}
