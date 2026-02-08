import { useEffect, useRef, useState } from "react";

export default function useToolbarExport() {
  const [toolbarExportOpen, setToolbarExportOpen] = useState(false);
  const toolbarExportRef = useRef(null);

  useEffect(() => {
    if (!toolbarExportOpen) {
      return;
    }
    const handlePointerDown = (event) => {
      const target = event.target;
      if (toolbarExportRef.current?.contains(target)) {
        return;
      }
      setToolbarExportOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [toolbarExportOpen]);

  return {
    toolbarExportOpen,
    setToolbarExportOpen,
    toolbarExportRef,
  };
}
