import { useCallback, useEffect } from "react";

export default function useExplorerActions({
  attachmentSessionId,
  apiFetch,
  t,
  explorerByTab,
  setExplorerByTab,
  explorerDefaultState,
  explorerRef,
  activeWorktreeId,
  handleViewSelect,
  showToast,
  requestExplorerTreeRef,
  requestExplorerStatusRef,
  loadExplorerFileRef,
}) {
  const updateExplorerState = useCallback(
    (tabId, patch) => {
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            ...patch,
          },
        };
      });
    },
    [explorerDefaultState, setExplorerByTab]
  );

  const findExplorerNode = useCallback((nodes, targetPath) => {
    if (!Array.isArray(nodes)) {
      return null;
    }
    for (const node of nodes) {
      if (node?.path === targetPath) {
        return node;
      }
      if (node?.type === "dir" && Array.isArray(node.children)) {
        const match = findExplorerNode(node.children, targetPath);
        if (match) {
          return match;
        }
      }
    }
    return null;
  }, []);

  const updateExplorerTreeNodes = useCallback((nodes, targetPath, children) => {
    if (!Array.isArray(nodes)) {
      return nodes;
    }
    let changed = false;
    const next = nodes.map((node) => {
      if (!node) {
        return node;
      }
      if (node.path === targetPath) {
        changed = true;
        return {
          ...node,
          children,
        };
      }
      if (node.type === "dir" && node.children != null) {
        const updatedChildren = updateExplorerTreeNodes(
          node.children,
          targetPath,
          children
        );
        if (updatedChildren !== node.children) {
          changed = true;
          return {
            ...node,
            children: updatedChildren,
          };
        }
      }
      return node;
    });
    return changed ? next : nodes;
  }, []);

  const setExplorerNodeChildren = useCallback(
    (tabId, targetPath, children) => {
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const tree = Array.isArray(prev.tree) ? prev.tree : [];
        const nextTree = updateExplorerTreeNodes(tree, targetPath, children);
        if (nextTree === tree) {
          return current;
        }
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            tree: nextTree,
          },
        };
      });
    },
    [explorerDefaultState, setExplorerByTab, updateExplorerTreeNodes]
  );

  const fetchExplorerChildren = useCallback(
    async (tabId, dirPath) => {
      if (!attachmentSessionId || !tabId) {
        return [];
      }
      const pathParam = dirPath ? `&path=${encodeURIComponent(dirPath)}` : "";
      const response = await apiFetch(
        `/api/worktree/${encodeURIComponent(
          tabId
        )}/browse?session=${encodeURIComponent(attachmentSessionId)}${pathParam}`
      );
      if (!response.ok) {
        throw new Error("Failed to load directory");
      }
      const payload = await response.json().catch(() => ({}));
      const entries = Array.isArray(payload?.entries) ? payload.entries : [];
      const normalized = entries.map((entry) => ({
        ...entry,
        children: entry?.type === "dir" ? entry?.children ?? null : undefined,
      }));
      if (!dirPath) {
        updateExplorerState(tabId, {
          tree: normalized,
          loading: false,
          error: "",
          treeTruncated: false,
          treeTotal: normalized.length,
        });
      } else {
        setExplorerNodeChildren(tabId, dirPath, normalized);
      }
      return normalized;
    },
    [
      attachmentSessionId,
      apiFetch,
      setExplorerNodeChildren,
      updateExplorerState,
    ]
  );

  const normalizeOpenPath = useCallback((rawPath) => {
    if (!rawPath) {
      return "";
    }
    return rawPath
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\.\/+/, "")
      .replace(/\/+/g, "/");
  }, []);

  const expandExplorerDir = useCallback(
    (tabId, dirPath) => {
      if (!dirPath) {
        return;
      }
      const parts = dirPath.split("/").filter(Boolean);
      const expanded = [];
      let current = "";
      parts.forEach((part) => {
        current = current ? `${current}/${part}` : part;
        expanded.push(current);
      });
      updateExplorerState(tabId, {
        expandedPaths: expanded,
        selectedPath: "",
        fileContent: "",
        draftContent: "",
        fileError: "",
        fileBinary: false,
        editMode: false,
        isDirty: false,
      });
    },
    [updateExplorerState]
  );

  const openPathInExplorer = useCallback(
    async (rawPath) => {
      const tabId = activeWorktreeId || "main";
      if (!attachmentSessionId) {
        showToast(t("Session not found."), "error");
        return;
      }
      const normalized = normalizeOpenPath(rawPath);
      if (!normalized) {
        showToast(t("Path required."), "error");
        return;
      }
      let tree = explorerRef.current[tabId]?.tree;
      if (!Array.isArray(tree) || tree.length === 0) {
        try {
          await fetchExplorerChildren(tabId, "");
          tree = explorerRef.current[tabId]?.tree;
        } catch (error) {
          showToast(t("Unable to load directory."), "error");
          return;
        }
      }
      const parts = normalized.split("/").filter(Boolean);
      let currentPath = "";
      let node = null;
      for (const part of parts) {
        const nextPath = currentPath ? `${currentPath}/${part}` : part;
        node = findExplorerNode(tree, nextPath);
        if (!node) {
          showToast(t("Path not found."), "error");
          return;
        }
        if (node.type === "dir" && node.children === null) {
          try {
            await fetchExplorerChildren(tabId, node.path);
            tree = explorerRef.current[tabId]?.tree;
            node = findExplorerNode(tree, nextPath);
            if (!node) {
              showToast(t("Path not found."), "error");
              return;
            }
          } catch (error) {
            showToast(t("Unable to load directory."), "error");
            return;
          }
        }
        currentPath = nextPath;
      }
      if (!node) {
        showToast(t("Path not found."), "error");
        return;
      }
      handleViewSelect("explorer");
      requestExplorerTreeRef.current?.(tabId);
      requestExplorerStatusRef.current?.(tabId);
      if (node.type === "dir") {
        expandExplorerDir(tabId, node.path);
      } else {
        loadExplorerFileRef.current?.(tabId, node.path);
      }
    },
    [
      activeWorktreeId,
      attachmentSessionId,
      expandExplorerDir,
      fetchExplorerChildren,
      findExplorerNode,
      handleViewSelect,
      loadExplorerFileRef,
      normalizeOpenPath,
      requestExplorerStatusRef,
      requestExplorerTreeRef,
      showToast,
      t,
      explorerRef,
    ]
  );

  const requestExplorerTree = useCallback(
    async (tabId, force = false) => {
      if (!attachmentSessionId || !tabId) {
        return;
      }
      const existing = explorerRef.current[tabId];
      if (!force && existing?.tree && !existing?.error) {
        return;
      }
      if (existing?.loading) {
        return;
      }
      updateExplorerState(tabId, { loading: true, error: "" });
      try {
        await fetchExplorerChildren(tabId, "");
      } catch (error) {
        updateExplorerState(tabId, {
          loading: false,
          error: t("Unable to load the explorer."),
        });
      }
    },
    [attachmentSessionId, fetchExplorerChildren, updateExplorerState, t, explorerRef]
  );

  useEffect(() => {
    requestExplorerTreeRef.current = requestExplorerTree;
  }, [requestExplorerTree, requestExplorerTreeRef]);

  const requestExplorerStatus = useCallback(
    async (tabId, force = false) => {
      if (!attachmentSessionId || !tabId) {
        return;
      }
      const existing = explorerRef.current[tabId];
      if (!force && existing?.statusLoaded && !existing?.statusError) {
        return;
      }
      if (existing?.statusLoading) {
        return;
      }
      updateExplorerState(tabId, { statusLoading: true, statusError: "" });
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            tabId
          )}/status?session=${encodeURIComponent(attachmentSessionId)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load status");
        }
        const payload = await response.json();
        const entries = Array.isArray(payload?.entries) ? payload.entries : [];
        const statusByPath = {};
        entries.forEach((entry) => {
          if (!entry?.path || !entry?.type) {
            return;
          }
          statusByPath[entry.path] = entry.type;
        });
        updateExplorerState(tabId, {
          statusByPath,
          statusLoading: false,
          statusError: "",
          statusLoaded: true,
        });
      } catch (error) {
        updateExplorerState(tabId, {
          statusLoading: false,
          statusError: t("Unable to load Git status."),
          statusLoaded: false,
        });
      }
    },
    [attachmentSessionId, updateExplorerState, t, apiFetch, explorerRef]
  );

  useEffect(() => {
    requestExplorerStatusRef.current = requestExplorerStatus;
  }, [requestExplorerStatus, requestExplorerStatusRef]);

  const loadExplorerFile = useCallback(
    async (tabId, filePath) => {
      if (!attachmentSessionId || !tabId || !filePath) {
        return;
      }
      const currentState = explorerByTab[tabId];
      if (
        currentState?.isDirty &&
        currentState?.selectedPath &&
        currentState.selectedPath !== filePath
      ) {
        const shouldContinue = window.confirm(
          t(
            "Vous avez des modifications non sauvegardees. Continuer sans sauvegarder ?"
          )
        );
        if (!shouldContinue) {
          return;
        }
      }
      updateExplorerState(tabId, {
        selectedPath: filePath,
        fileLoading: true,
        fileError: "",
        fileBinary: false,
        fileSaveError: "",
        fileSaving: false,
        editMode: true,
        isDirty: false,
      });
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            tabId
          )}/file?session=${encodeURIComponent(
            attachmentSessionId
          )}&path=${encodeURIComponent(filePath)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load file");
        }
        const payload = await response.json();
        const content = payload?.content || "";
        updateExplorerState(tabId, {
          fileContent: content,
          draftContent: content,
          fileLoading: false,
          fileError: "",
          fileTruncated: Boolean(payload?.truncated),
          fileBinary: Boolean(payload?.binary),
        });
      } catch (error) {
        updateExplorerState(tabId, {
          fileLoading: false,
          fileError: t("Unable to load the file."),
        });
      }
    },
    [attachmentSessionId, explorerByTab, updateExplorerState, t, apiFetch]
  );

  useEffect(() => {
    loadExplorerFileRef.current = loadExplorerFile;
  }, [loadExplorerFile, loadExplorerFileRef]);

  const openFileInExplorer = useCallback(
    (filePath) => {
      if (!filePath) {
        return;
      }
      const tabId = activeWorktreeId || "main";
      handleViewSelect("explorer");
      requestExplorerTree(tabId);
      requestExplorerStatus(tabId);
      loadExplorerFileRef.current?.(tabId, filePath);
    },
    [
      activeWorktreeId,
      handleViewSelect,
      requestExplorerStatus,
      requestExplorerTree,
      loadExplorerFileRef,
    ]
  );

  const toggleExplorerDir = useCallback(
    (tabId, dirPath) => {
      if (!tabId || !dirPath) {
        return;
      }
      const currentState = explorerRef.current[tabId] || explorerDefaultState;
      const expanded = new Set(currentState.expandedPaths || []);
      const willExpand = !expanded.has(dirPath);
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const nextExpanded = new Set(prev.expandedPaths || []);
        if (nextExpanded.has(dirPath)) {
          nextExpanded.delete(dirPath);
        } else {
          nextExpanded.add(dirPath);
        }
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            expandedPaths: Array.from(nextExpanded),
          },
        };
      });
      if (willExpand) {
        fetchExplorerChildren(tabId, dirPath).catch(() => {
          updateExplorerState(tabId, {
            error: t("Unable to load the explorer."),
          });
        });
      }
    },
    [
      explorerDefaultState,
      fetchExplorerChildren,
      t,
      updateExplorerState,
      setExplorerByTab,
      explorerRef,
    ]
  );

  const toggleExplorerEditMode = useCallback(
    (tabId, nextMode) => {
      if (!tabId) {
        return;
      }
      updateExplorerState(tabId, {
        editMode: nextMode,
        fileSaveError: "",
      });
    },
    [updateExplorerState]
  );

  const updateExplorerDraft = useCallback(
    (tabId, value) => {
      if (!tabId) {
        return;
      }
      updateExplorerState(tabId, {
        draftContent: value,
        isDirty: true,
      });
    },
    [updateExplorerState]
  );

  const saveExplorerFile = useCallback(
    async (tabId) => {
      if (!attachmentSessionId || !tabId) {
        return;
      }
      const state = explorerByTab[tabId];
      if (!state?.selectedPath || state?.fileBinary) {
        return;
      }
      updateExplorerState(tabId, { fileSaving: true, fileSaveError: "" });
      try {
        const response = await apiFetch(
          `/api/worktree/${encodeURIComponent(
            tabId
          )}/file?session=${encodeURIComponent(attachmentSessionId)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: state.selectedPath,
              content: state.draftContent || "",
            }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to save file");
        }
        updateExplorerState(tabId, {
          fileContent: state.draftContent || "",
          fileSaving: false,
          fileSaveError: "",
          isDirty: false,
        });
        requestExplorerStatus(tabId, true);
      } catch (error) {
        updateExplorerState(tabId, {
          fileSaving: false,
          fileSaveError: t("Unable to save the file."),
        });
      }
    },
    [
      attachmentSessionId,
      explorerByTab,
      updateExplorerState,
      requestExplorerStatus,
      t,
      apiFetch,
    ]
  );

  return {
    updateExplorerState,
    openPathInExplorer,
    requestExplorerTree,
    requestExplorerStatus,
    loadExplorerFile,
    openFileInExplorer,
    toggleExplorerDir,
    toggleExplorerEditMode,
    updateExplorerDraft,
    saveExplorerFile,
  };
}
