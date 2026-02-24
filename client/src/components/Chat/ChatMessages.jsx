import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCode,
  faCodeBranch,
  faCommentDots,
  faDice,
  faTowerBroadcast,
  faKey,
  faTriangleExclamation,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";

const getAnnotatableLines = (text) => {
  const lines = String(text || "").split(/\r?\n/);
  const results = [];
  let inCodeFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || !trimmed) {
      continue;
    }
    const isTableSeparator = /^[:\-\s|]+$/.test(trimmed) && trimmed.includes("|");
    const isTableRowLike =
      (trimmed.startsWith("|") && trimmed.endsWith("|")) || isTableSeparator;
    if (isTableRowLike) {
      continue;
    }
    results.push({
      lineIndex: index,
      lineText: rawLine,
    });
  }
  return results;
};

export default function ChatMessages({
  t,
  activePane,
  listRef,
  showChatInfoPanel,
  repoTitle,
  activeBranchLabel,
  shortSha,
  activeCommit,
  showProviderMeta,
  activeProviderLabel,
  activeModelLabel,
  showInternetAccess,
  showGitCredentialsShared,
  activeTaskLabel,
  currentMessages,
  chatHistoryWindow,
  activeChatKey,
  setShowOlderMessagesByTab,
  showChatCommands,
  showToolResults,
  commandPanelOpen,
  setCommandPanelOpen,
  toolResultPanelOpen,
  setToolResultPanelOpen,
  renderMessageAttachments,
  currentProcessing,
  currentInteractionBlocked,
  currentActivity,
  extractVibe80Blocks,
  handleChoiceClick,
  choiceSelections,
  openVibe80Form,
  copyTextToClipboard,
  openFileInExplorer,
  setInput,
  inputRef,
  markBacklogItemDone,
  setBacklogMessagePage,
  activeWorktreeId,
  BACKLOG_PAGE_SIZE,
  MAX_USER_DISPLAY_LENGTH,
  getTruncatedText,
  annotationMode,
  scopedAnnotations,
  setAnnotationDraft,
  removeAnnotation,
  addOrFocusAnnotation,
}) {
  return (
    <main className={`chat ${activePane === "chat" ? "" : "is-hidden"}`}>
      <div className="chat-scroll" ref={listRef}>
        <div
          className={`chat-scroll-inner ${showChatInfoPanel ? "has-meta" : ""}`}
        >
          <div
            className={`chat-history-grid ${showChatInfoPanel ? "has-meta" : ""} ${
              annotationMode ? "has-annotations" : ""
            }`}
          >
            {showChatInfoPanel && (
              <div className="chat-meta-rail">
                <div className="chat-meta-card">
                  <div className="chat-meta-section chat-meta-repo">
                    <div className="chat-meta-repo-title">
                      <span className="chat-meta-repo-name">{repoTitle}</span>
                    </div>
                    <div className="chat-meta-repo-branch-line">
                      <span className="chat-meta-repo-icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faCodeBranch} />
                      </span>
                      <span className="chat-meta-repo-branch">
                        {activeBranchLabel}
                      </span>
                    </div>
                    <div className="chat-meta-repo-commit">
                      <span className="chat-meta-hash">{shortSha}</span>
                      <span className="chat-meta-message">
                        {activeCommit?.message || ""}
                      </span>
                    </div>
                  </div>

                  {showProviderMeta && (
                    <div className="chat-meta-section chat-meta-provider">
                      <span className="chat-meta-provider-icon" aria-hidden="true">
                        <FontAwesomeIcon icon={faDice} />
                      </span>
                      <span className="chat-meta-provider-label">
                        {activeProviderLabel}
                      </span>
                      <span className="chat-meta-provider-sep">•</span>
                      <span className="chat-meta-provider-model">
                        {activeModelLabel}
                      </span>
                    </div>
                  )}

                  {(showInternetAccess ||
                    showGitCredentialsShared ||
                    activeTaskLabel) && (
                    <div className="chat-meta-section chat-meta-permissions">
                      {showInternetAccess && (
                        <div className="chat-meta-permission">
                          <span
                            className="chat-meta-permission-icon is-internet"
                            aria-hidden="true"
                          >
                            <FontAwesomeIcon icon={faTowerBroadcast} />
                          </span>
                          <span>{t("Internet access enabled")}</span>
                        </div>
                      )}
                      {showGitCredentialsShared && (
                        <div className="chat-meta-permission">
                          <span
                            className="chat-meta-permission-icon is-credentials"
                            aria-hidden="true"
                          >
                            <FontAwesomeIcon icon={faKey} />
                          </span>
                          <span>{t("Git credentials shared")}</span>
                        </div>
                      )}
                      {activeTaskLabel && (
                        <span className="chat-meta-task">
                          <span
                            className="chat-meta-task-loader"
                            aria-hidden="true"
                          />
                          <ReactMarkdown
                            className="chat-meta-task-text"
                            remarkPlugins={[remarkGfm]}
                            components={{
                              p: ({ children }) => <span>{children}</span>,
                            }}
                          >
                            {activeTaskLabel}
                          </ReactMarkdown>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="chat-history">
              {currentMessages.length === 0 && (
                <div className="empty">
                  <p>{t("Send a message to start a session.")}</p>
                </div>
              )}
              {chatHistoryWindow.hiddenCount > 0 && (
                <button
                  type="button"
                  className="chat-history-reveal"
                  onClick={() =>
                    setShowOlderMessagesByTab((current) => ({
                      ...current,
                      [activeChatKey]: true,
                    }))
                  }
                >
                  {t("View previous messages ({{count}})", {
                    count: chatHistoryWindow.hiddenCount,
                  })}
                </button>
              )}
              {chatHistoryWindow.visibleMessages.map((message) => {
                if (message?.groupType === "commandExecution") {
                  return (
                    <div key={message.id} className="bubble command-execution">
                      {message.items.map((item) => {
                        const commandTitle = t("Command: {{command}}", {
                          command: item.command || t("Command"),
                        });
                        const showLoader = item.status !== "completed";
                        const isExpandable =
                          item.isExpandable || Boolean(item.output);
                        const summaryContent = (
                          <>
                            {showLoader && (
                              <span
                                className="loader command-execution-loader"
                                title={t("Execution in progress")}
                              >
                                <span className="dot" />
                                <span className="dot" />
                                <span className="dot" />
                              </span>
                            )}
                            <span className="command-execution-title">
                              {commandTitle}
                            </span>
                          </>
                        );
                        return (
                          <div key={item.id}>
                            {isExpandable ? (
                              <details
                                className="command-execution-panel"
                                open={Boolean(commandPanelOpen[item.id])}
                                onToggle={(event) => {
                                  const isOpen = event.currentTarget.open;
                                  setCommandPanelOpen((prev) => ({
                                    ...prev,
                                    [item.id]: isOpen,
                                  }));
                                }}
                              >
                                <summary className="command-execution-summary">
                                  {summaryContent}
                                </summary>
                                <pre className="command-execution-output">
                                  {item.output || ""}
                                </pre>
                              </details>
                            ) : (
                              <div className="command-execution-summary is-static">
                                {summaryContent}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                if (message?.groupType === "toolResult") {
                  return (
                    <div key={message.id} className="bubble command-execution">
                      {message.items.map((item) => {
                        const isActionResult = item?.type === "action_result";
                        const actionRequest = item?.action?.request || "";
                        const actionArg = item?.action?.arg || "";
                        const commandLabel = `${actionRequest}${actionArg ? ` ${actionArg}` : ""}`.trim();
                        const toolTitle = isActionResult
                          ? t("User command : {{command}}", {
                              command: commandLabel || t("Command"),
                            })
                          : t("Tool: {{tool}}", {
                              tool:
                                item.toolResult?.name ||
                                item.toolResult?.tool ||
                                "Tool",
                            });
                        const output = isActionResult
                          ? item?.action?.output || item.text || ""
                          : item.toolResult?.output || item.text || "";
                        const isExpandable = Boolean(output);
                        const summaryContent = (
                          <span className="command-execution-title">
                            <span
                              className="command-execution-tool-icon"
                              aria-hidden="true"
                            >
                              <FontAwesomeIcon icon={faCode} />
                            </span>
                            <span>{toolTitle}</span>
                          </span>
                        );
                        const panelKey = `tool-${item.id}`;
                        const isPanelOpen = isActionResult
                          ? toolResultPanelOpen[panelKey] !== false
                          : Boolean(toolResultPanelOpen[panelKey]);
                        return (
                          <div key={item.id}>
                            {isExpandable ? (
                              <details
                                className="command-execution-panel"
                                open={isPanelOpen}
                                onToggle={(event) => {
                                  const isOpen = event.currentTarget.open;
                                  setToolResultPanelOpen((prev) => ({
                                    ...prev,
                                    [panelKey]: isOpen,
                                  }));
                                }}
                              >
                                <summary className="command-execution-summary">
                                  {summaryContent}
                                </summary>
                                <pre className="command-execution-output">
                                  {output}
                                </pre>
                              </details>
                            ) : (
                              <div className="command-execution-summary is-static">
                                {summaryContent}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                if (message?.type === "backlog_view") {
                  const backlogItems = Array.isArray(message.backlog?.items)
                    ? message.backlog.items
                    : [];
                  const pendingItems = backlogItems.filter((item) => !item?.done);
                  const totalPages = Math.max(
                    1,
                    Math.ceil(pendingItems.length / BACKLOG_PAGE_SIZE)
                  );
                  const requestedPage = Number.isFinite(message.backlog?.page)
                    ? message.backlog.page
                    : 0;
                  const currentPage = Math.min(
                    Math.max(0, requestedPage),
                    totalPages - 1
                  );
                  const startIndex = currentPage * BACKLOG_PAGE_SIZE;
                  const pageItems = pendingItems.slice(
                    startIndex,
                    startIndex + BACKLOG_PAGE_SIZE
                  );
                  const backlogScopeId =
                    activeWorktreeId && activeWorktreeId !== "main"
                      ? activeWorktreeId
                      : "main";
                  return (
                    <div key={message.id} className="bubble backlog">
                      <details
                        className="command-execution-panel backlog-panel"
                        open
                      >
                        <summary className="command-execution-summary">
                          <span className="command-execution-title">
                            {t("Backlog")}
                          </span>
                        </summary>
                        <div className="backlog-view">
                          {pageItems.length === 0 ? (
                            <div className="backlog-empty">
                              {t("No pending tasks at the moment.")}
                            </div>
                          ) : (
                            <div className="backlog-list">
                              {pageItems.map((item) => (
                                <div key={item.id} className="backlog-row">
                                  <input
                                    type="checkbox"
                                    className="backlog-checkbox"
                                    onChange={() => markBacklogItemDone(item.id)}
                                  />
                                  <button
                                    type="button"
                                    className="backlog-text"
                                    title={item.text}
                                    onClick={() => {
                                      setInput(item.text || "");
                                      inputRef.current?.focus();
                                    }}
                                  >
                                    {item.text}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {totalPages > 1 ? (
                            <div className="backlog-pagination">
                              <button
                                type="button"
                                className="backlog-page-button"
                                disabled={currentPage === 0}
                                onClick={() =>
                                  setBacklogMessagePage(
                                    backlogScopeId,
                                    message.id,
                                    Math.max(0, currentPage - 1)
                                  )
                                }
                              >
                                {t("Previous")}
                              </button>
                              <span className="backlog-page-status">
                                {currentPage + 1} / {totalPages}
                              </span>
                              <button
                                type="button"
                                className="backlog-page-button"
                                disabled={currentPage >= totalPages - 1}
                                onClick={() =>
                                  setBacklogMessagePage(
                                    backlogScopeId,
                                    message.id,
                                    Math.min(totalPages - 1, currentPage + 1)
                                  )
                                }
                              >
                                {t("Next")}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </details>
                    </div>
                  );
                }
                const isLongUserMessage =
                  message.role === "user" &&
                  (message.text || "").length > MAX_USER_DISPLAY_LENGTH;
                if (isLongUserMessage) {
                  const truncatedText = getTruncatedText(
                    message.text,
                    MAX_USER_DISPLAY_LENGTH
                  );
                  return (
                    <div key={message.id} className={`bubble ${message.role}`}>
                      <div className="plain-text">{truncatedText}</div>
                      {renderMessageAttachments(message.attachments)}
                    </div>
                  );
                }

                return (
                  <div key={message.id} className={`bubble ${message.role}`}>
                    {(() => {
                      const rawText = message.text || "";
                      const isWarning = rawText.startsWith("⚠️");
                      const warningText = rawText.replace(/^⚠️\s*/, "");
                      const { cleanedText, blocks, filerefs } =
                        extractVibe80Blocks(
                          isWarning ? warningText : rawText,
                          t
                        );
                      const showAnnotationSource =
                        annotationMode && message.role === "assistant";
                      const content = (
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ node, ...props }) => (
                              <a {...props} target="_blank" rel="noopener noreferrer" />
                            ),
                            code: ({
                              node,
                              inline,
                              className,
                              children,
                              ...props
                            }) => {
                              const raw = Array.isArray(children)
                                ? children.join("")
                                : String(children);
                              const text = raw.replace(/\n$/, "");
                              if (!inline) {
                                return (
                                  <code className={className} {...props}>
                                    {children}
                                  </code>
                                );
                              }
                              const trimmed = text.trim();
                              const isRelativePath =
                                Boolean(trimmed) &&
                                !trimmed.startsWith("/") &&
                                !trimmed.startsWith("~") &&
                                !/^[a-zA-Z]+:\/\//.test(trimmed) &&
                                !trimmed.includes("\\") &&
                                !trimmed.includes(" ") &&
                                (trimmed.startsWith("./") ||
                                  trimmed.startsWith("../") ||
                                  trimmed.includes("/") ||
                                  /^[\w.-]+$/.test(trimmed));
                              return (
                                <span
                                  className={`inline-code${
                                    isRelativePath ? " inline-code--link" : ""
                                  }`}
                                >
                                  {isRelativePath ? (
                                    <button
                                      type="button"
                                      className="inline-code-link"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setInput(`/open ${trimmed}`);
                                        inputRef.current?.focus();
                                      }}
                                    >
                                      <code className={className} {...props}>
                                        {text}
                                      </code>
                                    </button>
                                  ) : (
                                    <code className={className} {...props}>
                                      {text}
                                    </code>
                                  )}
                                  <button
                                    type="button"
                                    className="code-copy"
                                    aria-label={t("Copy code")}
                                    title={t("Copy")}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      copyTextToClipboard(text);
                                    }}
                                  >
                                    <FontAwesomeIcon icon={faCopy} />
                                  </button>
                                </span>
                              );
                            },
                          }}
                        >
                          {cleanedText}
                        </ReactMarkdown>
                      );
                      return (
                        <>
                          {showAnnotationSource ? (
                            <div className="annotation-line-source-list">
                              {getAnnotatableLines(cleanedText).map((entry) => (
                                <div
                                  key={`${message.id}-${entry.lineIndex}`}
                                  className="annotation-line-source-row"
                                >
                                  <div className="annotation-line-source-text">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkGfm]}
                                      components={{
                                        p: ({ children }) => <span>{children}</span>,
                                        a: ({ node, ...props }) => (
                                          <a
                                            {...props}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          />
                                        ),
                                      }}
                                    >
                                      {entry.lineText}
                                    </ReactMarkdown>
                                  </div>
                                  <button
                                    type="button"
                                    className="annotation-line-source-button"
                                    aria-label={t("Annotate line")}
                                    title={t("Annotate line")}
                                    onClick={() =>
                                      addOrFocusAnnotation({
                                        messageId: message.id,
                                        lineIndex: entry.lineIndex,
                                        lineText: entry.lineText,
                                      })
                                    }
                                  >
                                    <FontAwesomeIcon icon={faCommentDots} />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : isWarning ? (
                            <div className="warning-message">
                              <span className="warning-icon" aria-hidden="true">
                                <FontAwesomeIcon icon={faTriangleExclamation} />
                              </span>
                              <div className="warning-body">{content}</div>
                            </div>
                          ) : (
                            content
                          )}
                          {filerefs.length && !message?.isStreaming ? (
                            <ul className="fileref-list">
                              {filerefs.map((pathRef) => (
                                <li
                                  key={`${message.id}-fileref-${pathRef}`}
                                  className="fileref-item"
                                >
                                  <button
                                    type="button"
                                    className="fileref-link"
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      openFileInExplorer(pathRef);
                                    }}
                                  >
                                    {pathRef}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          {blocks.map((block, index) => {
                            const blockKey = `${message.id}-${index}`;
                            if (block.type === "form") {
                              return (
                                <div className="vibe80-form" key={blockKey}>
                                  <button
                                    type="button"
                                    className="vibe80-form-button"
                                    onClick={() => openVibe80Form(block, blockKey)}
                                  >
                                    {block.question || t("Open form")}
                                  </button>
                                </div>
                              );
                            }

                            const selectedIndex = choiceSelections[blockKey];
                            const choicesWithIndex = block.choices.map(
                              (choice, choiceIndex) => ({
                                choice,
                                choiceIndex,
                              })
                            );
                            const orderedChoices =
                              selectedIndex === undefined
                                ? choicesWithIndex
                                : [
                                    choicesWithIndex.find(
                                      ({ choiceIndex }) =>
                                        choiceIndex === selectedIndex
                                    ),
                                    ...choicesWithIndex.filter(
                                      ({ choiceIndex }) =>
                                        choiceIndex !== selectedIndex
                                    ),
                                  ].filter(Boolean);

                            const isInline = block.type === "yesno";
                            return (
                              <div
                                className={`choices ${isInline ? "is-inline" : ""}`}
                                key={blockKey}
                              >
                                {block.question && (
                                  <div className="choices-question">
                                    {block.question}
                                  </div>
                                )}
                                <div
                                  className={`choices-list ${
                                    selectedIndex !== undefined ? "is-selected" : ""
                                  } ${isInline ? "is-inline" : ""}`}
                                >
                                  {orderedChoices.map(
                                    ({ choice, choiceIndex }) => {
                                      const isSelected =
                                        selectedIndex === choiceIndex;
                                      return (
                                        <button
                                          type="button"
                                          key={`${blockKey}-${choiceIndex}`}
                                          onClick={() =>
                                            handleChoiceClick(
                                              choice,
                                              blockKey,
                                              choiceIndex
                                            )
                                          }
                                          disabled={currentInteractionBlocked}
                                          className={`choice-button ${
                                            isSelected
                                              ? "is-selected"
                                              : selectedIndex !== undefined
                                                ? "is-muted"
                                                : ""
                                          }`}
                                        >
                                          <ReactMarkdown
                                            remarkPlugins={[remarkGfm]}
                                            components={{
                                              p: ({ node, ...props }) => (
                                                <span {...props} />
                                              ),
                                              a: ({ node, ...props }) => (
                                                <a
                                                  {...props}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                />
                                              ),
                                            }}
                                          >
                                            {choice}
                                          </ReactMarkdown>
                                        </button>
                                      );
                                    }
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          {renderMessageAttachments(message.attachments)}
                        </>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
            {annotationMode ? (
              <div className="chat-annotation-rail">
                <div className="chat-annotation-card">
                  <div className="chat-annotation-title">{t("Annotations")}</div>
                  <div className="chat-annotation-subtitle">
                    {t("Only sent with the next message.")}
                  </div>
                  {scopedAnnotations.length === 0 ? (
                    <div className="chat-annotation-empty">
                      {t("No annotations yet.")}
                    </div>
                  ) : (
                    <div className="chat-annotation-list">
                      {scopedAnnotations.map((annotation) => (
                        <div
                          className="chat-annotation-item"
                          key={annotation.annotationKey}
                        >
                          <div className="chat-annotation-quote">
                            &gt; {annotation.lineText}
                          </div>
                          <textarea
                            className="chat-annotation-input"
                            value={annotation.annotationText}
                            placeholder={t("Write annotation...")}
                            rows={3}
                            onChange={(event) =>
                              setAnnotationDraft(
                                annotation.annotationKey,
                                event.target.value
                              )
                            }
                          />
                          <button
                            type="button"
                            className="chat-annotation-remove"
                            onClick={() => removeAnnotation(annotation.annotationKey)}
                          >
                            {t("Delete")}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {currentProcessing && (
        <div className="bubble assistant typing">
          <div className="typing-indicator">
            <div className="loader" title={currentActivity || t("Processing...")}>
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
            <span className="typing-text">
              {currentActivity || t("Processing...")}
            </span>
          </div>
        </div>
      )}
    </main>
  );
}
