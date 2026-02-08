import { useCallback } from "react";

export default function useChatExport({
  currentMessages,
  attachmentRepoUrl,
  repoUrl,
  isInWorktree,
  activeWorktree,
  t,
  normalizeAttachments,
  downloadTextFile,
  formatExportName,
  extractRepoName,
  setToolbarExportOpen,
}) {
  const handleExportChat = useCallback(
    (format) => {
      setToolbarExportOpen(false);
      const exportMessages = Array.isArray(currentMessages)
        ? currentMessages
        : [];
      if (!exportMessages.length) {
        return;
      }
      setToolbarExportOpen(false);
      const baseName = extractRepoName(attachmentRepoUrl || repoUrl || "");
      const tabLabel =
        isInWorktree && activeWorktree
          ? `${activeWorktree.name || t("Worktree")} (${activeWorktree.branchName || activeWorktree.id})`
          : t("Main");
      if (format === "markdown") {
        const lines = [
          `# ${t("Chat history")}`,
          "",
          `${t("Export")}: ${new Date().toISOString()}`,
          `${t("Tab")}: ${tabLabel}`,
          "",
        ];
        exportMessages.forEach((message) => {
          if (message.role === "commandExecution") {
            lines.push(`## ${t("Command")}`);
            lines.push(`\`${message.command || t("Command")}\``);
            if (message.output) {
              lines.push("```");
              lines.push(message.output);
              lines.push("```");
            }
            lines.push("");
            return;
          }
          if (message.role === "tool_result") {
            const toolName =
              message.toolResult?.name || message.toolResult?.tool || t("Tool");
            const toolOutput = message.toolResult?.output || message.text || "";
            lines.push(`## ${t("Tool result")}`);
            lines.push(`\`${toolName}\``);
            if (toolOutput) {
              lines.push("```");
              lines.push(toolOutput);
              lines.push("```");
            }
            lines.push("");
            return;
          }
          const roleLabel =
            message.role === "user" ? t("Username") : t("Assistant");
          lines.push(`## ${roleLabel}`);
          lines.push(message.text || "");
          const attachmentNames = normalizeAttachments(
            message.attachments || []
          )
            .map((item) => item?.name || item?.path)
            .filter(Boolean);
          if (attachmentNames.length) {
            lines.push(`${t("Attachments")}: ${attachmentNames.join(", ")}`);
          }
          lines.push("");
        });
        const content = lines.join("\n").trim() + "\n";
        downloadTextFile(
          formatExportName(baseName, "md"),
          content,
          "text/markdown"
        );
        return;
      }
      const payload = {
        exportedAt: new Date().toISOString(),
        repoUrl: attachmentRepoUrl || repoUrl || "",
        tab: {
          type: isInWorktree ? "worktree" : "main",
          worktreeId: activeWorktree?.id || null,
          worktreeName: activeWorktree?.name || null,
          branchName: activeWorktree?.branchName || null,
        },
        messages: exportMessages.map((message) => {
          if (message.role === "commandExecution") {
            return {
              id: message.id,
              role: message.role,
              command: message.command || "",
              output: message.output || "",
              status: message.status || "",
            };
          }
          if (message.role === "tool_result") {
            return {
              id: message.id,
              role: message.role,
              text: message.text || "",
              toolResult: message.toolResult || null,
            };
          }
          return {
            id: message.id,
            role: message.role,
            text: message.text || "",
            attachments: normalizeAttachments(message.attachments || []),
          };
        }),
      };
      downloadTextFile(
        formatExportName(baseName, "json"),
        JSON.stringify(payload, null, 2),
        "application/json"
      );
    },
    [
      activeWorktree,
      attachmentRepoUrl,
      currentMessages,
      downloadTextFile,
      extractRepoName,
      formatExportName,
      isInWorktree,
      normalizeAttachments,
      repoUrl,
      setToolbarExportOpen,
      t,
    ]
  );

  return { handleExportChat };
}
