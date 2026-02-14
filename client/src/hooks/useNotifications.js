import { useCallback, useEffect, useRef } from "react";

export default function useNotifications({ notificationsEnabled, t }) {
  const lastNotifiedIdRef = useRef(null);
  const audioContextRef = useRef(null);
  const soundEnabled = notificationsEnabled;

  const ensureNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      return "unsupported";
    }
    if (Notification.permission === "default") {
      try {
        return await Notification.requestPermission();
      } catch (error) {
        return Notification.permission;
      }
    }
    return Notification.permission;
  }, []);

  const primeAudioContext = useCallback(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    let ctx = audioContextRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioContextRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
  }, []);

  const playNotificationSound = useCallback(() => {
    if (!soundEnabled) {
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    let ctx = audioContextRef.current;
    if (!ctx) {
      ctx = new AudioContext();
      audioContextRef.current = ctx;
    }
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 740;
    gain.gain.value = 0.0001;
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.26);
  }, [soundEnabled]);

  const stripMarkdownForNotification = useCallback((value) => {
    if (!value) {
      return "";
    }
    let output = String(value);
    const vibe80Marker = output.match(/<!--\s*vibe80:/i);
    if (typeof vibe80Marker?.index === "number") {
      output = output.slice(0, vibe80Marker.index);
    }
    output = output.replace(/```([\s\S]*?)```/g, "$1");
    output = output.replace(/`([^`]+)`/g, "$1");
    output = output.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1");
    output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
    output = output.replace(/^\s{0,3}#{1,6}\s+/gm, "");
    output = output.replace(/^\s{0,3}>\s?/gm, "");
    output = output.replace(/^\s{0,3}[-*+]\s+/gm, "");
    output = output.replace(/^\s{0,3}\d+\.\s+/gm, "");
    output = output.replace(/[*_~]{1,3}/g, "");
    output = output.replace(/\s+/g, " ").trim();
    return output;
  }, []);

  const maybeNotify = useCallback(
    (message) => {
      if (!notificationsEnabled) {
        return;
      }
      if (!("Notification" in window)) {
        return;
      }
      if (Notification.permission !== "granted") {
        return;
      }
      if (!message?.id || lastNotifiedIdRef.current === message.id) {
        return;
      }
      if (!document.hidden) {
        return;
      }
      lastNotifiedIdRef.current = message.id;
      const body = stripMarkdownForNotification(message.text || "").slice(
        0,
        180
      );
      try {
        new Notification(t("New message"), { body });
      } catch (error) {
        // Ignore notification failures (permissions or browser quirks).
      }
      playNotificationSound();
    },
    [notificationsEnabled, playNotificationSound, stripMarkdownForNotification, t]
  );

  useEffect(() => {
    if (!notificationsEnabled) {
      return;
    }
    void ensureNotificationPermission();
    primeAudioContext();
  }, [ensureNotificationPermission, primeAudioContext, notificationsEnabled]);

  return {
    ensureNotificationPermission,
    maybeNotify,
    lastNotifiedIdRef,
  };
}
