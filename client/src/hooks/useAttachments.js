import { useCallback, useEffect, useState } from "react";

export default function useAttachments({
  attachmentSessionId,
  workspaceToken,
  normalizeAttachments,
  isImageAttachment,
  getAttachmentName,
  attachmentIcon,
  t,
}) {
  const [draftAttachments, setDraftAttachments] = useState([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentsError, setAttachmentsError] = useState("");
  const [attachmentPreview, setAttachmentPreview] = useState(null);

  const getAttachmentUrl = useCallback(
    (attachment) => {
      if (!attachmentSessionId) {
        return "";
      }
      const url = new URL("/api/attachments/file", window.location.origin);
      url.searchParams.set("session", attachmentSessionId);
      if (workspaceToken) {
        url.searchParams.set("token", workspaceToken);
      }
      if (attachment?.path) {
        url.searchParams.set("path", attachment.path);
      } else if (attachment?.name) {
        url.searchParams.set("name", attachment.name);
      }
      return url.toString();
    },
    [attachmentSessionId, workspaceToken]
  );

  const renderMessageAttachments = useCallback(
    (attachments = []) => {
      const normalized = normalizeAttachments(attachments);
      if (!normalized.length) {
        return null;
      }
      return (
        <div className="bubble-attachments">
          {normalized.map((attachment) => {
            const name = getAttachmentName(attachment);
            const url = getAttachmentUrl(attachment);
            const key = attachment?.path || attachment?.name || name;
            if (isImageAttachment(attachment)) {
              return (
                <button
                  type="button"
                  key={key}
                  className="attachment-card attachment-card--image"
                  onClick={() =>
                    url ? setAttachmentPreview({ url, name }) : null
                  }
                  disabled={!url}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={name || t("Attached image")}
                      className="attachment-thumb"
                      loading="lazy"
                    />
                  ) : (
                    <div className="attachment-thumb attachment-thumb--empty" />
                  )}
                  <span className="attachment-name">{name}</span>
                </button>
              );
            }
            if (url) {
              return (
                <a
                  key={key}
                  className="attachment-card"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="attachment-icon" aria-hidden="true">
                    {attachmentIcon}
                  </span>
                  <span className="attachment-name">{name}</span>
                </a>
              );
            }
            return (
              <div key={key} className="attachment-card">
                <span className="attachment-icon" aria-hidden="true">
                  {attachmentIcon}
                </span>
                <span className="attachment-name">{name}</span>
              </div>
            );
          })}
        </div>
      );
    },
    [getAttachmentName, getAttachmentUrl, isImageAttachment, normalizeAttachments, t]
  );

  useEffect(() => {
    if (!attachmentSessionId) {
      setDraftAttachments([]);
    }
  }, [attachmentSessionId]);

  return {
    attachmentPreview,
    attachmentsError,
    attachmentsLoading,
    draftAttachments,
    getAttachmentUrl,
    renderMessageAttachments,
    setAttachmentPreview,
    setAttachmentsError,
    setAttachmentsLoading,
    setDraftAttachments,
  };
}
