import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";

export default function useSessionHandoff({ t, apiFetch, attachmentSessionId }) {
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [handoffQrDataUrl, setHandoffQrDataUrl] = useState("");
  const [handoffExpiresAt, setHandoffExpiresAt] = useState(null);
  const [handoffLoading, setHandoffLoading] = useState(false);
  const [handoffError, setHandoffError] = useState("");
  const [handoffRemaining, setHandoffRemaining] = useState(null);

  const buildHandoffPayload = (token, expiresAt) =>
    JSON.stringify({
      type: "vibe80_handoff",
      handoffToken: token,
      baseUrl: window.location.origin,
      expiresAt,
    });

  const requestHandoffQr = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    setHandoffLoading(true);
    setHandoffError("");
    try {
      const response = await apiFetch("/api/sessions/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: attachmentSessionId }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || t("Unable to generate the QR code."));
      }
      const data = await response.json();
      const token = data?.handoffToken;
      if (!token) {
        throw new Error(t("Invalid resume token."));
      }
      const expiresAt = data?.expiresAt ?? null;
      const payload = buildHandoffPayload(token, expiresAt);
      const qrDataUrl = await QRCode.toDataURL(payload, {
        width: 260,
        margin: 1,
      });
      setHandoffQrDataUrl(qrDataUrl);
      setHandoffExpiresAt(expiresAt);
      setHandoffOpen(true);
    } catch (error) {
      setHandoffError(error?.message || t("Error during generation."));
    } finally {
      setHandoffLoading(false);
    }
  }, [attachmentSessionId, apiFetch, t]);

  const closeHandoffQr = useCallback(() => {
    setHandoffOpen(false);
    setHandoffError("");
    setHandoffQrDataUrl("");
    setHandoffExpiresAt(null);
    setHandoffRemaining(null);
  }, []);

  useEffect(() => {
    if (!handoffOpen || !handoffExpiresAt) {
      setHandoffRemaining(null);
      return;
    }
    const expiresAtMs =
      typeof handoffExpiresAt === "number"
        ? handoffExpiresAt
        : new Date(handoffExpiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      setHandoffRemaining(null);
      return;
    }
    const tick = () => {
      const remainingMs = expiresAtMs - Date.now();
      const remainingSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
      setHandoffRemaining(remainingSeconds);
    };
    tick();
    const intervalId = setInterval(tick, 1000);
    return () => clearInterval(intervalId);
  }, [handoffOpen, handoffExpiresAt]);

  return {
    handoffOpen,
    handoffQrDataUrl,
    handoffExpiresAt,
    handoffLoading,
    handoffError,
    handoffRemaining,
    requestHandoffQr,
    closeHandoffQr,
  };
}
