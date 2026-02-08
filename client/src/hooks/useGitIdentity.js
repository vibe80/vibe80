import { useCallback, useEffect, useState } from "react";

export default function useGitIdentity({ t, apiFetch, attachmentSessionId }) {
  const [gitIdentityName, setGitIdentityName] = useState("");
  const [gitIdentityEmail, setGitIdentityEmail] = useState("");
  const [gitIdentityGlobal, setGitIdentityGlobal] = useState({
    name: "",
    email: "",
  });
  const [gitIdentityRepo, setGitIdentityRepo] = useState({
    name: "",
    email: "",
  });
  const [gitIdentityLoading, setGitIdentityLoading] = useState(false);
  const [gitIdentitySaving, setGitIdentitySaving] = useState(false);
  const [gitIdentityError, setGitIdentityError] = useState("");
  const [gitIdentityMessage, setGitIdentityMessage] = useState("");

  const loadGitIdentity = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    setGitIdentityLoading(true);
    setGitIdentityError("");
    setGitIdentityMessage("");
    try {
      const response = await apiFetch(
        `/api/session/${encodeURIComponent(attachmentSessionId)}/git-identity`
      );
      if (!response.ok) {
        throw new Error(t("Unable to load Git identity."));
      }
      const payload = await response.json();
      const globalName = payload?.global?.name || "";
      const globalEmail = payload?.global?.email || "";
      const repoName = payload?.repo?.name || "";
      const repoEmail = payload?.repo?.email || "";
      setGitIdentityGlobal({ name: globalName, email: globalEmail });
      setGitIdentityRepo({ name: repoName, email: repoEmail });
      setGitIdentityName(repoName || globalName);
      setGitIdentityEmail(repoEmail || globalEmail);
    } catch (error) {
      setGitIdentityError(error?.message || t("Error during loading."));
    } finally {
      setGitIdentityLoading(false);
    }
  }, [attachmentSessionId, apiFetch, t]);

  const handleSaveGitIdentity = useCallback(async () => {
    if (!attachmentSessionId) {
      return;
    }
    const name = gitIdentityName.trim();
    const email = gitIdentityEmail.trim();
    if (!name || !email) {
      setGitIdentityError(t("Name and email required."));
      return;
    }
    setGitIdentitySaving(true);
    setGitIdentityError("");
    setGitIdentityMessage("");
    try {
      const response = await apiFetch(
        `/api/session/${encodeURIComponent(attachmentSessionId)}/git-identity`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email }),
        }
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || t("Update failed."));
      }
      const payload = await response.json().catch(() => ({}));
      const repoName = payload?.repo?.name || name;
      const repoEmail = payload?.repo?.email || email;
      setGitIdentityRepo({ name: repoName, email: repoEmail });
      setGitIdentityMessage(t("Repository Git identity updated."));
    } catch (error) {
      setGitIdentityError(error?.message || t("Update failed."));
    } finally {
      setGitIdentitySaving(false);
    }
  }, [
    attachmentSessionId,
    apiFetch,
    gitIdentityEmail,
    gitIdentityName,
    t,
  ]);

  useEffect(() => {
    if (!attachmentSessionId) {
      return;
    }
    loadGitIdentity();
  }, [attachmentSessionId, loadGitIdentity]);

  return {
    gitIdentityName,
    gitIdentityEmail,
    gitIdentityGlobal,
    gitIdentityRepo,
    gitIdentityLoading,
    gitIdentitySaving,
    gitIdentityError,
    gitIdentityMessage,
    setGitIdentityName,
    setGitIdentityEmail,
    loadGitIdentity,
    handleSaveGitIdentity,
  };
}
