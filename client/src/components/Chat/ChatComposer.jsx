import React from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faXmark } from "@fortawesome/free-solid-svg-icons";
import { Command, CommandList, CommandItem } from "cmdk";

export default function ChatComposer({
  t,
  activePane,
  isDraggingAttachments,
  onSubmit,
  onDragEnterComposer,
  onDragOverComposer,
  onDragLeaveComposer,
  onDropAttachments,
  composerRef,
  draftAttachments,
  getAttachmentExtension,
  formatAttachmentSize,
  removeDraftAttachment,
  commandMenuOpen,
  filteredCommands,
  setInput,
  setCommandMenuOpen,
  setCommandQuery,
  inputRef,
  commandSelection,
  triggerAttachmentPicker,
  attachmentSession,
  attachmentsLoading,
  isMobileLayout,
  uploadInputRef,
  onUploadAttachments,
  input,
  handleInputChange,
  handleComposerKeyDown,
  onPasteAttachments,
  composerInputMode,
  canInterrupt,
  interruptTurn,
  connected,
  isCodexReady,
  interactionBlocked,
  attachmentsError,
}) {
  if (activePane !== "chat") {
    return null;
  }

  return (
    <form
      className={`composer composer--sticky ${
        isDraggingAttachments ? "is-dragging" : ""
      }`}
      onSubmit={onSubmit}
      onDragEnter={onDragEnterComposer}
      onDragOver={onDragOverComposer}
      onDragLeave={onDragLeaveComposer}
      onDrop={onDropAttachments}
      ref={composerRef}
    >
      <div className="composer-inner">
        {draftAttachments.length ? (
          <div
            className="composer-attachments"
            aria-label={t("Selected attachments")}
          >
            {draftAttachments.map((attachment) => {
              const label = attachment?.name || attachment?.path || "";
              const key = attachment?.path || attachment?.name || label;
              const extension = getAttachmentExtension(attachment, t);
              const sizeLabel =
                attachment?.lineCount || attachment?.lines
                  ? t("{{count}} lines", {
                      count: attachment.lineCount || attachment.lines,
                    })
                  : formatAttachmentSize(attachment?.size, t);
              return (
                <div className="attachment-card" key={key}>
                  <div className="attachment-card-body">
                    <div className="attachment-card-title">{label}</div>
                    {sizeLabel ? (
                      <div className="attachment-card-meta">{sizeLabel}</div>
                    ) : null}
                  </div>
                  <div className="attachment-card-footer">
                    <span className="attachment-card-type">{extension}</span>
                    <button
                      type="button"
                      className="attachment-card-remove"
                      aria-label={t("Remove {{label}}", {
                        label,
                      })}
                      onClick={() =>
                        removeDraftAttachment(
                          attachment?.path || attachment?.name
                        )
                      }
                    >
                      <FontAwesomeIcon icon={faXmark} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {commandMenuOpen && (
          <div className="composer-command-menu">
            <Command className="command-menu" shouldFilter={false}>
              <CommandList>
                {filteredCommands.length ? (
                  filteredCommands.map((cmd) => (
                    <CommandItem
                      key={cmd.id}
                      onSelect={() => {
                        setInput(cmd.insert);
                        setCommandMenuOpen(false);
                        setCommandQuery("");
                        inputRef.current?.focus();
                      }}
                      className={`command-item${
                        cmd.id === commandSelection ? " is-selected" : ""
                      }`}
                    >
                      <span className="command-item-label">{cmd.label}</span>
                      <span className="command-item-desc">
                        {cmd.description}
                      </span>
                    </CommandItem>
                  ))
                ) : (
                  <div className="command-empty">{t("No commands found.")}</div>
                )}
              </CommandList>
            </Command>
          </div>
        )}
        <div className="composer-main">
          <button
            type="button"
            className="icon-button composer-attach-button"
            aria-label={t("Add attachment")}
            onClick={triggerAttachmentPicker}
            disabled={!attachmentSession || attachmentsLoading}
          >
            ＋
            {isMobileLayout ? (
              <span className="attachment-badge">{draftAttachments.length}</span>
            ) : null}
          </button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            onChange={onUploadAttachments}
            disabled={!attachmentSession || attachmentsLoading}
            className="visually-hidden"
          />
          <textarea
            className={`composer-input ${
              composerInputMode === "single" ? "is-single" : "is-multi"
            }`}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleComposerKeyDown}
            onPaste={onPasteAttachments}
            placeholder={t("Write your message…")}
            rows={composerInputMode === "single" ? 1 : 2}
            ref={inputRef}
          />
          {canInterrupt ? (
            <button
              type="button"
              className="primary stop-button"
              onClick={interruptTurn}
              aria-label={t("Stop")}
              title={t("Stop")}
            >
              <span className="stop-icon">⏹</span>
            </button>
          ) : (
            <button
              type="submit"
              className="primary send-button"
              disabled={
                !connected || !input.trim() || !isCodexReady || interactionBlocked
              }
              aria-label={t("Send")}
              title={t("Send")}
            >
              <span className="send-icon">➤</span>
            </button>
          )}
        </div>

        {attachmentsError && (
          <div className="attachments-error composer-attachments-error">
            {attachmentsError}
          </div>
        )}
      </div>
    </form>
  );
}
