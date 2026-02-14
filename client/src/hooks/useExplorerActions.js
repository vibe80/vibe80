import { useCallback, useEffect } from "react";

const pathBasename = (value) => {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
};

const pathDirname = (value) => {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) {
    return "";
  }
  return parts.slice(0, -1).join("/");
};

const joinPath = (baseDir, name) => {
  if (!baseDir) {
    return name;
  }
  return `${baseDir}/${name}`;
};

const remapPath = (value, fromPath, toPath) => {
  if (!value || typeof value !== "string") {
    return value;
  }
  if (value === fromPath) {
    return toPath;
  }
  if (value.startsWith(`${fromPath}/`)) {
    return `${toPath}${value.slice(fromPath.length)}`;
  }
  return value;
};

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
      .replace(/\/+$/, "")
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

  const selectExplorerNode = useCallback(
    (tabId, nodePath, nodeType) => {
      if (!tabId || !nodePath) {
        return;
      }
      updateExplorerState(tabId, {
        selectedPath: nodePath,
        selectedType: nodeType || null,
      });
    },
    [updateExplorerState]
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
            new Set(
              expandedPaths.filter(
                (path) => typeof path === "string" && path.length > 0
              )
            )
          );
          for (const dirPath of uniqueExpanded) {
            await fetchExplorerChildren(tabId, dirPath);
          }
        }
      } catch {
        updateExplorerState(tabId, {
          loading: false,
          error: t("Unable to load the explorer."),
        });
      }
    },
    [attachmentSessionId, explorerRef, updateExplorerState, fetchExplorerChildren, t]
  );

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
      } catch {
        updateExplorerState(tabId, {
          statusLoading: false,
          statusError: t("Unable to load Git status."),
          statusLoaded: false,
        });
      }
    },
    [attachmentSessionId, explorerRef, updateExplorerState, apiFetch, t]
  );

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
        const prevOpenTabs = Array.isArray(prev.openTabPaths)
          ? prev.openTabPaths
          : [];
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
            selectedType: "file",
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
      } catch {
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
      requestExplorerTree,
      requestExplorerStatus,
      loadExplorerFileRef,
    ]
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
        } catch {
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
          } catch {
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
      selectExplorerNode(tabId, node.path, node.type);
      if (node.type === "dir") {
        expandExplorerDir(tabId, node.path);
      } else {
        loadExplorerFileRef.current?.(tabId, node.path);
      }
    },
    [
      activeWorktreeId,
      attachmentSessionId,
      handleViewSelect,
      requestExplorerTreeRef,
      requestExplorerStatusRef,
      normalizeOpenPath,
      fetchExplorerChildren,
      findExplorerNode,
      loadExplorerFileRef,
      selectExplorerNode,
      expandExplorerDir,
      explorerRef,
      showToast,
      t,
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
          updateExplorerState(tabId, { error: t("Unable to load the explorer.") });
        });
      }
    },
    [
      explorerRef,
      explorerDefaultState,
      setExplorerByTab,
      fetchExplorerChildren,
      updateExplorerState,
      t,
    ]
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
    [explorerRef, explorerDefaultState, setExplorerByTab]
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
      } catch {
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
      explorerRef,
      explorerDefaultState,
      setExplorerByTab,
      requestExplorerStatus,
      apiFetch,
      t,
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
        selectedType: "file",
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
        const shouldClose = window.confirm(
          t("You have unsaved changes. Continue without saving?")
        );
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
            selectedType: nextActive ? "file" : null,
            editMode: Boolean(nextActive),
          },
        };
      });
    },
    [explorerRef, explorerDefaultState, setExplorerByTab, t]
  );

  const startExplorerRename = useCallback(
    (tabId) => {
      if (!tabId) {
        return false;
      }
      const state = explorerRef.current?.[tabId] || explorerDefaultState;
      const targetPath = state.selectedPath;
      if (!targetPath) {
        return false;
      }
      updateExplorerState(tabId, {
        renamingPath: targetPath,
        renameDraft: pathBasename(targetPath),
      });
      return true;
    },
    [explorerRef, explorerDefaultState, updateExplorerState]
  );

  const cancelExplorerRename = useCallback(
    (tabId) => {
      if (!tabId) {
        return;
      }
      updateExplorerState(tabId, {
        renamingPath: null,
        renameDraft: "",
      });
    },
    [updateExplorerState]
  );

  const updateExplorerRenameDraft = useCallback(
    (tabId, value) => {
      if (!tabId) {
        return;
      }
      updateExplorerState(tabId, { renameDraft: value ?? "" });
    },
    [updateExplorerState]
  );

  const submitExplorerRename = useCallback(
    async (tabId) => {
      if (!attachmentSessionId || !tabId) {
        return false;
      }
      const state = explorerRef.current?.[tabId] || explorerDefaultState;
      const fromPath = state.renamingPath;
      const renameDraft = (state.renameDraft || "").trim();
      if (!fromPath || !renameDraft) {
        cancelExplorerRename(tabId);
        return false;
      }
      if (renameDraft.includes("/")) {
        showToast(t("Path required."), "error");
        return false;
      }
      const toPath = joinPath(pathDirname(fromPath), renameDraft);
      if (!toPath || toPath === fromPath) {
        cancelExplorerRename(tabId);
        return false;
      }

      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(tabId)}/file/rename`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromPath, toPath }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to rename path");
        }

        setExplorerByTab((current) => {
          const prev = current[tabId] || explorerDefaultState;
          const nextOpenTabs = Array.from(
            new Set(
              (prev.openTabPaths || []).map((path) => remapPath(path, fromPath, toPath))
            )
          );
          const nextFiles = {};
          Object.entries(prev.filesByPath || {}).forEach(([path, fileState]) => {
            nextFiles[remapPath(path, fromPath, toPath)] = fileState;
          });
          return {
            ...current,
            [tabId]: {
              ...explorerDefaultState,
              ...prev,
              openTabPaths: nextOpenTabs,
              filesByPath: nextFiles,
              activeFilePath: remapPath(prev.activeFilePath, fromPath, toPath),
              selectedPath: remapPath(prev.selectedPath, fromPath, toPath),
              renamingPath: null,
              renameDraft: "",
            },
          };
        });

        await requestExplorerTree(tabId, true);
        await requestExplorerStatus(tabId, true);
        showToast(t("Renamed."), "success");
        return true;
      } catch {
        showToast(t("Unable to rename."), "error");
        return false;
      }
    },
    [
      attachmentSessionId,
      explorerRef,
      explorerDefaultState,
      setExplorerByTab,
      apiFetch,
      requestExplorerTree,
      requestExplorerStatus,
      cancelExplorerRename,
      showToast,
      t,
    ]
  );

  const createExplorerFile = useCallback(
    async (tabId, rawName) => {
      if (!attachmentSessionId || !tabId) {
        return false;
      }
      const fileName = normalizeOpenPath(rawName || "");
      if (!fileName) {
        showToast(t("Path required."), "error");
        return false;
      }
      const state = explorerRef.current?.[tabId] || explorerDefaultState;
      const selectedPath = state.selectedPath || "";
      const selectedType = state.selectedType || null;
      const baseDir =
        selectedType === "dir"
          ? selectedPath
          : selectedType === "file"
            ? pathDirname(selectedPath)
            : "";
      const targetPath = joinPath(baseDir, fileName);

      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(tabId)}/file`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: targetPath, content: "" }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to create file");
        }
        await requestExplorerTree(tabId, true);
        await requestExplorerStatus(tabId, true);
        await loadExplorerFile(tabId, targetPath, true);
        showToast(t("File created."), "success");
        return true;
      } catch {
        showToast(t("Unable to create file."), "error");
        return false;
      }
    },
    [
      attachmentSessionId,
      explorerRef,
      explorerDefaultState,
      normalizeOpenPath,
      requestExplorerTree,
      requestExplorerStatus,
      loadExplorerFile,
      apiFetch,
      showToast,
      t,
    ]
  );

  const createExplorerFolder = useCallback(
    async (tabId, rawName) => {
      if (!attachmentSessionId || !tabId) {
        return false;
      }
      const folderName = normalizeOpenPath(rawName || "");
      if (!folderName) {
        showToast(t("Path required."), "error");
        return false;
      }
      const state = explorerRef.current?.[tabId] || explorerDefaultState;
      const selectedPath = state.selectedPath || "";
      const selectedType = state.selectedType || null;
      const baseDir =
        selectedType === "dir"
          ? selectedPath
          : selectedType === "file"
            ? pathDirname(selectedPath)
            : "";
      const targetPath = joinPath(baseDir, folderName);

      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(tabId)}/folder`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: targetPath }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to create folder");
        }
        await requestExplorerTree(tabId, true);
        await requestExplorerStatus(tabId, true);
        showToast(t("Folder created."), "success");
        return true;
      } catch {
        showToast(t("Unable to create folder."), "error");
        return false;
      }
    },
    [
      attachmentSessionId,
      normalizeOpenPath,
      explorerRef,
      explorerDefaultState,
      apiFetch,
      requestExplorerTree,
      requestExplorerStatus,
      showToast,
      t,
    ]
  );

  const deleteExplorerSelection = useCallback(
    async (tabId) => {
      if (!attachmentSessionId || !tabId) {
        return false;
      }
      const state = explorerRef.current?.[tabId] || explorerDefaultState;
      const selectedPath = state.selectedPath || "";
      if (!selectedPath) {
        return false;
      }
      const shouldDelete = window.confirm(
        t("Delete \"{{path}}\"? This action is irreversible.", {
          path: selectedPath,
        })
      );
      if (!shouldDelete) {
        return false;
      }

      updateExplorerState(tabId, { deletingPath: selectedPath });
      try {
        const response = await apiFetch(
          `/api/sessions/${encodeURIComponent(
            attachmentSessionId
          )}/worktrees/${encodeURIComponent(tabId)}/file/delete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: selectedPath }),
          }
        );
        if (!response.ok) {
          throw new Error("Failed to delete path");
        }

        setExplorerByTab((current) => {
          const prev = current[tabId] || explorerDefaultState;
          const nextOpenTabs = (prev.openTabPaths || []).filter(
            (path) => path !== selectedPath && !path.startsWith(`${selectedPath}/`)
          );
          const nextFiles = {};
          Object.entries(prev.filesByPath || {}).forEach(([path, fileState]) => {
            if (path === selectedPath || path.startsWith(`${selectedPath}/`)) {
              return;
            }
            nextFiles[path] = fileState;
          });
          const nextActive =
            prev.activeFilePath === selectedPath ||
            String(prev.activeFilePath || "").startsWith(`${selectedPath}/`)
              ? nextOpenTabs[nextOpenTabs.length - 1] || null
              : prev.activeFilePath;
          return {
            ...current,
            [tabId]: {
              ...explorerDefaultState,
              ...prev,
              openTabPaths: nextOpenTabs,
              filesByPath: nextFiles,
              activeFilePath: nextActive,
              selectedPath: pathDirname(selectedPath) || nextActive,
              selectedType: pathDirname(selectedPath) ? "dir" : nextActive ? "file" : null,
              renamingPath: null,
              renameDraft: "",
              deletingPath: null,
            },
          };
        });

        await requestExplorerTree(tabId, true);
        await requestExplorerStatus(tabId, true);
        showToast(t("Deleted."), "success");
        return true;
      } catch {
        updateExplorerState(tabId, { deletingPath: null });
        showToast(t("Unable to delete."), "error");
        return false;
      }
    },
    [
      attachmentSessionId,
      explorerRef,
      explorerDefaultState,
      setExplorerByTab,
      updateExplorerState,
      requestExplorerTree,
      requestExplorerStatus,
      apiFetch,
      showToast,
      t,
    ]
  );

  const toggleExplorerEditMode = useCallback(
    (tabId, nextMode) => {
      if (!tabId) {
        return;
      }
      updateExplorerState(tabId, {
        editMode: nextMode,
      });
    },
    [updateExplorerState]
  );

  useEffect(() => {
    requestExplorerTreeRef.current = requestExplorerTree;
  }, [requestExplorerTree, requestExplorerTreeRef]);

  useEffect(() => {
    requestExplorerStatusRef.current = requestExplorerStatus;
  }, [requestExplorerStatus, requestExplorerStatusRef]);

  useEffect(() => {
    loadExplorerFileRef.current = loadExplorerFile;
  }, [loadExplorerFile, loadExplorerFileRef]);

  return {
    updateExplorerState,
    selectExplorerNode,
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
    startExplorerRename,
    cancelExplorerRename,
    updateExplorerRenameDraft,
    submitExplorerRename,
    createExplorerFile,
    createExplorerFolder,
    deleteExplorerSelection,
  };
}
