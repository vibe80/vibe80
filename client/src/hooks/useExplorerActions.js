import { useCallback, useEffect } from "react";

export default function useExplorerActions({
  attachmentSessionId,
  apiFetch,
  t,
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
      const response = await apiFetch(
        `/api/sessions/${encodeURIComponent(
          attachmentSessionId
        )}/worktrees/${encodeURIComponent(tabId)}/browse${dirPath ? `?path=${encodeURIComponent(dirPath)}` : ""}`
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
        if (force) {
          const expandedPaths = Array.isArray(explorerRef.current[tabId]?.expandedPaths)
            ? explorerRef.current[tabId].expandedPaths
            : [];
          const uniqueExpanded = Array.from(
            new Set(expandedPaths.filter((path) => typeof path === "string" && path.length > 0))
          );
          for (const dirPath of uniqueExpanded) {
            await fetchExplorerChildren(tabId, dirPath);
          }
        }
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
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(tabId)}/status`
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
    async (tabId, filePath, force = false) => {
      if (!attachmentSessionId || !tabId || !filePath) {
        return;
      }
      const existingState = explorerRef.current[tabId] || explorerDefaultState;
      const openTabPaths = Array.isArray(existingState.openTabPaths)
        ? existingState.openTabPaths
        : [];
      const existingFile = existingState.filesByPath?.[filePath];

      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const prevOpenTabs = Array.isArray(prev.openTabPaths) ? prev.openTabPaths : [];
        const nextOpenTabs = prevOpenTabs.includes(filePath)
          ? prevOpenTabs
          : [...prevOpenTabs, filePath];
        const prevFile = prev.filesByPath?.[filePath] || {};
        const shouldLoad = force || prevFile.content == null;
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            openTabPaths: nextOpenTabs,
            activeFilePath: filePath,
            selectedPath: filePath,
            editMode: true,
            filesByPath: {
              ...(prev.filesByPath || {}),
              [filePath]: {
                ...prevFile,
                path: filePath,
                loading: shouldLoad,
                error: "",
                saveError: "",
                saving: false,
                binary: shouldLoad ? false : Boolean(prevFile.binary),
              },
            },
          },
        };
      });

      if (!force && openTabPaths.includes(filePath) && existingFile?.content != null) {
        return;
      }

      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(
            tabId
          )}/file?path=${encodeURIComponent(filePath)}`
        );
        if (!response.ok) {
          throw new Error("Failed to load file");
        }
        const payload = await response.json();
        const content = payload?.content || "";
        setExplorerByTab((current) => {
          const prev = current[tabId] || explorerDefaultState;
          const prevFile = prev.filesByPath?.[filePath] || {};
          return {
            ...current,
            [tabId]: {
              ...explorerDefaultState,
              ...prev,
              filesByPath: {
                ...(prev.filesByPath || {}),
                [filePath]: {
                  ...prevFile,
                  path: filePath,
                  content,
                  draftContent: content,
                  loading: false,
                  error: "",
                  truncated: Boolean(payload?.truncated),
                  binary: Boolean(payload?.binary),
                  isDirty: false,
                },
              },
            },
          };
        });
      } catch (error) {
        setExplorerByTab((current) => {
          const prev = current[tabId] || explorerDefaultState;
          const prevFile = prev.filesByPath?.[filePath] || {};
          return {
            ...current,
            [tabId]: {
              ...explorerDefaultState,
              ...prev,
              filesByPath: {
                ...(prev.filesByPath || {}),
                [filePath]: {
                  ...prevFile,
                  path: filePath,
                  loading: false,
                  error: t("Unable to load the file."),
                },
              },
            },
          };
        });
      }
    },
    [
      attachmentSessionId,
      explorerDefaultState,
      explorerRef,
      setExplorerByTab,
      t,
      apiFetch,
    ]
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
    (tabId, filePath, value) => {
      if (!tabId) {
        return;
      }
      const targetPath =
        filePath ||
        explorerRef.current?.[tabId]?.activeFilePath ||
        explorerRef.current?.[tabId]?.selectedPath;
      if (!targetPath) {
        return;
      }
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const prevFile = prev.filesByPath?.[targetPath];
        if (!prevFile) {
          return current;
        }
        const nextDraft = value ?? "";
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            filesByPath: {
              ...(prev.filesByPath || {}),
              [targetPath]: {
                ...prevFile,
                draftContent: nextDraft,
                isDirty: nextDraft !== (prevFile.content || ""),
                saveError: "",
              },
            },
          },
        };
      });
    },
    [explorerDefaultState, explorerRef, setExplorerByTab]
  );

  const saveExplorerFile = useCallback(
    async (tabId, filePath) => {
      if (!attachmentSessionId || !tabId) {
        return;
      }
      const state = explorerRef.current?.[tabId];
      const targetPath = filePath || state?.activeFilePath || state?.selectedPath;
      const targetFile = targetPath ? state?.filesByPath?.[targetPath] : null;
      if (!targetPath || !targetFile || targetFile.binary) {
        return;
      }
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const prevFile = prev.filesByPath?.[targetPath];
        if (!prevFile) {
          return current;
        }
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            filesByPath: {
              ...(prev.filesByPath || {}),
              [targetPath]: {
                ...prevFile,
                saving: true,
                saveError: "",
              },
            },
          },
        };
      });
      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(tabId)}/file`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: targetPath,
              content: targetFile.draftContent || "",
            }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to save file");
        }
        setExplorerByTab((current) => {
          const prev = current[tabId] || explorerDefaultState;
          const prevFile = prev.filesByPath?.[targetPath];
          if (!prevFile) {
            return current;
          }
          return {
            ...current,
            [tabId]: {
              ...explorerDefaultState,
              ...prev,
              filesByPath: {
                ...(prev.filesByPath || {}),
                [targetPath]: {
                  ...prevFile,
                  content: prevFile.draftContent || "",
                  saving: false,
                  saveError: "",
                  isDirty: false,
                },
              },
            },
          };
        });
        requestExplorerStatus(tabId, true);
      } catch (error) {
        setExplorerByTab((current) => {
          const prev = current[tabId] || explorerDefaultState;
          const prevFile = prev.filesByPath?.[targetPath];
          if (!prevFile) {
            return current;
          }
          return {
            ...current,
            [tabId]: {
              ...explorerDefaultState,
              ...prev,
              filesByPath: {
                ...(prev.filesByPath || {}),
                [targetPath]: {
                  ...prevFile,
                  saving: false,
                  saveError: t("Unable to save the file."),
                },
              },
            },
          };
        });
      }
    },
    [
      attachmentSessionId,
      explorerDefaultState,
      explorerRef,
      setExplorerByTab,
      requestExplorerStatus,
      t,
      apiFetch,
    ]
  );

  const setActiveExplorerFile = useCallback(
    (tabId, filePath) => {
      if (!tabId || !filePath) {
        return;
      }
      updateExplorerState(tabId, {
        activeFilePath: filePath,
        selectedPath: filePath,
      });
    },
    [updateExplorerState]
  );

  const closeExplorerFile = useCallback(
    (tabId, filePath) => {
      if (!tabId || !filePath) {
        return;
      }
      const state = explorerRef.current?.[tabId] || explorerDefaultState;
      const openTabPaths = Array.isArray(state.openTabPaths) ? state.openTabPaths : [];
      if (!openTabPaths.includes(filePath)) {
        return;
      }
      const fileState = state.filesByPath?.[filePath];
      if (fileState?.isDirty) {
        const shouldClose = window.confirm(t("You have unsaved changes. Continue without saving?"));
        if (!shouldClose) {
          return;
        }
      }
      setExplorerByTab((current) => {
        const prev = current[tabId] || explorerDefaultState;
        const prevOpenTabs = Array.isArray(prev.openTabPaths) ? prev.openTabPaths : [];
        const targetIndex = prevOpenTabs.indexOf(filePath);
        if (targetIndex < 0) {
          return current;
        }
        const nextOpenTabs = prevOpenTabs.filter((path) => path !== filePath);
        const nextFiles = { ...(prev.filesByPath || {}) };
        delete nextFiles[filePath];
        let nextActive = prev.activeFilePath || null;
        if (nextActive === filePath) {
          nextActive =
            nextOpenTabs[targetIndex - 1] ||
            nextOpenTabs[targetIndex] ||
            nextOpenTabs[nextOpenTabs.length - 1] ||
            null;
        }
        return {
          ...current,
          [tabId]: {
            ...explorerDefaultState,
            ...prev,
            openTabPaths: nextOpenTabs,
            filesByPath: nextFiles,
            activeFilePath: nextActive,
            selectedPath: nextActive,
            editMode: Boolean(nextActive),
          },
        };
      });
    },
    [explorerDefaultState, explorerRef, setExplorerByTab, t]
  );

  return {
    updateExplorerState,
    openPathInExplorer,
    requestExplorerTree,
    requestExplorerStatus,
    loadExplorerFile,
    openFileInExplorer,
    setActiveExplorerFile,
    closeExplorerFile,
    toggleExplorerDir,
    toggleExplorerEditMode,
    updateExplorerDraft,
    saveExplorerFile,
  };
}
