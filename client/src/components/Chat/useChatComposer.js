import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export default function useChatComposer({
  t,
  input,
  setInput,
  inputRef,
  composerInputMode,
  handleSendMessageRef,
  attachmentSession,
  apiFetch,
  normalizeAttachments,
  setDraftAttachments,
  draftAttachments,
  setAttachmentsLoading,
  setAttachmentsError,
  showToast,
  uploadInputRef,
  attachmentsLoading,
  conversationRef,
  composerRef,
  isMobileLayout,
}) {
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandSelection, setCommandSelection] = useState(null);
  const [isDraggingAttachments, setIsDraggingAttachments] = useState(false);
  const dragCounterRef = useRef(0);

  const commandOptions = useMemo(
    () => [
      {
        id: "todo",
        label: "/todo",
        description: t("Add to backlog"),
        insert: "/todo ",
      },
      {
        id: "backlog",
        label: "/backlog",
        description: t("Show backlog"),
        insert: "/backlog",
      },
      {
        id: "open",
        label: "/open",
        description: t("Open path"),
        insert: "/open ",
      },
      {
        id: "run",
        label: "/run",
        description: t("Run shell command"),
        insert: "/run ",
      },
      {
        id: "screenshot",
        label: "/screenshot",
        description: t("Capture screenshot"),
        insert: "/screenshot",
      },
      {
        id: "git",
        label: "/git",
        description: t("Run git command"),
        insert: "/git ",
      },
      {
        id: "diff",
        label: "/diff",
        description: t("Open diff view"),
        insert: "/diff",
      },
    ],
    [t]
  );

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) {
      return commandOptions;
    }
    return commandOptions.filter((cmd) =>
      cmd.label.toLowerCase().includes(query)
    );
  }, [commandOptions, commandQuery]);

  useEffect(() => {
    if (!commandMenuOpen) {
      setCommandSelection(null);
      return;
    }
    if (!filteredCommands.length) {
      setCommandSelection(null);
      return;
    }
    setCommandSelection((current) =>
      filteredCommands.some((cmd) => cmd.id === current)
        ? current
        : filteredCommands[0].id
    );
  }, [commandMenuOpen, filteredCommands]);

  const handleInputChange = useCallback(
    (event) => {
      const { value } = event.target;
      setInput(value);
      if (value.startsWith("/") && !value.includes(" ")) {
        setCommandMenuOpen(true);
        setCommandQuery(value.slice(1));
      } else {
        setCommandMenuOpen(false);
        setCommandQuery("");
      }
      if (!inputRef.current) {
        return;
      }
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
    },
    [inputRef, setInput]
  );

  const handleComposerKeyDown = useCallback(
    (event) => {
      if (composerInputMode !== "single") {
        return;
      }
      if (commandMenuOpen) {
        if (event.key === "Escape") {
          event.preventDefault();
          setCommandMenuOpen(false);
          return;
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (!filteredCommands.length) {
            return;
          }
          const index = filteredCommands.findIndex(
            (cmd) => cmd.id === commandSelection
          );
          const nextIndex =
            index === -1 || index === filteredCommands.length - 1
              ? 0
              : index + 1;
          setCommandSelection(filteredCommands[nextIndex].id);
          return;
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          if (!filteredCommands.length) {
            return;
          }
          const index = filteredCommands.findIndex(
            (cmd) => cmd.id === commandSelection
          );
          const nextIndex =
            index <= 0 ? filteredCommands.length - 1 : index - 1;
          setCommandSelection(filteredCommands[nextIndex].id);
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          if (commandSelection) {
            event.preventDefault();
            const selected = filteredCommands.find(
              (cmd) => cmd.id === commandSelection
            );
            if (selected) {
              setInput(selected.insert);
              setCommandMenuOpen(false);
              setCommandQuery("");
              inputRef.current?.focus();
            }
            return;
          }
        }
      }
      if (event.isComposing) {
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSendMessageRef.current?.();
      }
    },
    [
      composerInputMode,
      commandMenuOpen,
      filteredCommands,
      commandSelection,
      handleSendMessageRef,
      inputRef,
      setInput,
    ]
  );

  useEffect(() => {
    if (!inputRef.current) {
      return;
    }
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${inputRef.current.scrollHeight}px`;
  }, [input, isMobileLayout, inputRef]);

  useEffect(() => {
    if (!conversationRef.current || !composerRef.current) {
      return undefined;
    }
    const updateComposerSpace = () => {
      if (!conversationRef.current || !composerRef.current) {
        return;
      }
      const rect = composerRef.current.getBoundingClientRect();
      const extra = isMobileLayout ? 12 : 16;
      conversationRef.current.style.setProperty(
        "--composer-space",
        `${Math.ceil(rect.height + extra)}px`
      );
    };
    updateComposerSpace();
    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(updateComposerSpace);
      observer.observe(composerRef.current);
    }
    window.addEventListener("resize", updateComposerSpace);
    return () => {
      window.removeEventListener("resize", updateComposerSpace);
      if (observer) {
        observer.disconnect();
      }
    };
  }, [isMobileLayout, draftAttachments.length, conversationRef, composerRef]);

  const uploadFiles = useCallback(
    async (files) => {
      if (!files.length || !attachmentSession?.sessionId) {
        return;
      }
      try {
        setAttachmentsLoading(true);
        setAttachmentsError("");
        const formData = new FormData();
        files.forEach((file) => formData.append("files", file));
        const response = await apiFetch(
          `/api/attachments/upload?session=${encodeURIComponent(
            attachmentSession.sessionId
          )}`,
          {
            method: "POST",
            body: formData,
          }
        );
        if (!response.ok) {
          throw new Error("Upload failed.");
        }
        const data = await response.json();
        const uploaded = normalizeAttachments(data.files || []);
        setDraftAttachments((current) => [...current, ...uploaded]);
      } catch (error) {
        setAttachmentsError(error.message || t("Unable to upload attachments."));
      } finally {
        setAttachmentsLoading(false);
      }
    },
    [
      apiFetch,
      attachmentSession?.sessionId,
      normalizeAttachments,
      setAttachmentsError,
      setAttachmentsLoading,
      setDraftAttachments,
      t,
    ]
  );

  const captureScreenshot = useCallback(async () => {
    if (!attachmentSession?.sessionId) {
      showToast(t("Session not found."), "error");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      showToast(t("Screenshot failed."), "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "never" },
        audio: false,
      });
      const video = document.createElement("video");
      video.srcObject = stream;
      await new Promise((resolve) => {
        video.onloadedmetadata = () => resolve();
      });
      await video.play();
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1;
      canvas.height = video.videoHeight || 1;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        throw new Error("Canvas unavailable");
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach((track) => track.stop());
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error("Blob failed")),
          "image/png"
        );
      });
      const filename = `screenshot-${Date.now()}.png`;
      const file = new File([blob], filename, { type: "image/png" });
      await uploadFiles([file]);
      showToast(t("Screenshot captured."));
    } catch (error) {
      showToast(error?.message || t("Screenshot failed."), "error");
    }
  }, [attachmentSession?.sessionId, showToast, t, uploadFiles]);

  const onUploadAttachments = useCallback(
    async (event) => {
      const files = Array.from(event.target.files || []);
      await uploadFiles(files);
      event.target.value = "";
    },
    [uploadFiles]
  );

  const onPasteAttachments = useCallback(
    async (event) => {
      if (!attachmentSession?.sessionId) {
        return;
      }
      const items = Array.from(event.clipboardData?.items || []);
      const files = items
        .filter((item) => item.kind === "file")
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) {
        return;
      }
      event.preventDefault();
      await uploadFiles(files);
    },
    [attachmentSession?.sessionId, uploadFiles]
  );

  const onDragOverComposer = useCallback(
    (event) => {
      if (!attachmentSession?.sessionId) {
        return;
      }
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
      }
    },
    [attachmentSession?.sessionId]
  );

  const onDragEnterComposer = useCallback(
    (event) => {
      if (!attachmentSession?.sessionId) {
        return;
      }
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
        dragCounterRef.current += 1;
        setIsDraggingAttachments(true);
      }
    },
    [attachmentSession?.sessionId]
  );

  const onDragLeaveComposer = useCallback(
    (event) => {
      if (!attachmentSession?.sessionId) {
        return;
      }
      if (event.dataTransfer?.types?.includes("Files")) {
        event.preventDefault();
        dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
        if (dragCounterRef.current === 0) {
          setIsDraggingAttachments(false);
        }
      }
    },
    [attachmentSession?.sessionId]
  );

  const onDropAttachments = useCallback(
    async (event) => {
      if (!attachmentSession?.sessionId) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      dragCounterRef.current = 0;
      setIsDraggingAttachments(false);
      const files = Array.from(event.dataTransfer?.files || []);
      if (!files.length) {
        return;
      }
      await uploadFiles(files);
    },
    [attachmentSession?.sessionId, uploadFiles]
  );

  const removeDraftAttachment = useCallback(
    (identifier) => {
      if (!identifier) {
        return;
      }
      setDraftAttachments((current) =>
        current.filter((item) => {
          const key = item?.path || item?.name;
          return key !== identifier;
        })
      );
    },
    [setDraftAttachments]
  );

  const triggerAttachmentPicker = useCallback(() => {
    if (!attachmentSession || attachmentsLoading) {
      return;
    }
    requestAnimationFrame(() => {
      uploadInputRef.current?.click();
    });
  }, [attachmentSession, attachmentsLoading, uploadInputRef]);

  const onSubmit = useCallback((event) => {
    event.preventDefault();
    handleSendMessageRef.current?.();
  }, [handleSendMessageRef]);

  return {
    commandMenuOpen,
    setCommandMenuOpen,
    commandQuery,
    setCommandQuery,
    commandSelection,
    filteredCommands,
    isDraggingAttachments,
    handleInputChange,
    handleComposerKeyDown,
    onSubmit,
    onUploadAttachments,
    onPasteAttachments,
    onDragOverComposer,
    onDragEnterComposer,
    onDragLeaveComposer,
    onDropAttachments,
    removeDraftAttachment,
    triggerAttachmentPicker,
    captureScreenshot,
  };
}
