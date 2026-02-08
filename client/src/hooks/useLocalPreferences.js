import { useEffect } from "react";

export default function useLocalPreferences({
  authMode,
  llmProvider,
  selectedProviders,
  openAiAuthMode,
  showChatCommands,
  showToolResults,
  chatFullWidth,
  notificationsEnabled,
  themeMode,
  composerInputMode,
  repoHistory,
  debugMode,
  setLlmProvider,
  setOpenAiLoginError,
  setClaudeLoginError,
  AUTH_MODE_KEY,
  LLM_PROVIDER_KEY,
  LLM_PROVIDERS_KEY,
  OPENAI_AUTH_MODE_KEY,
  CHAT_COMMANDS_VISIBLE_KEY,
  TOOL_RESULTS_VISIBLE_KEY,
  CHAT_FULL_WIDTH_KEY,
  NOTIFICATIONS_ENABLED_KEY,
  THEME_MODE_KEY,
  COMPOSER_INPUT_MODE_KEY,
  REPO_HISTORY_KEY,
  DEBUG_MODE_KEY,
}) {
  useEffect(() => {
    try {
      localStorage.setItem(AUTH_MODE_KEY, authMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [AUTH_MODE_KEY, authMode]);

  useEffect(() => {
    try {
      localStorage.setItem(LLM_PROVIDER_KEY, llmProvider);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [LLM_PROVIDER_KEY, llmProvider]);

  useEffect(() => {
    try {
      localStorage.setItem(LLM_PROVIDERS_KEY, JSON.stringify(selectedProviders));
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [LLM_PROVIDERS_KEY, selectedProviders]);

  useEffect(() => {
    setOpenAiLoginError("");
    setClaudeLoginError("");
  }, [llmProvider, setClaudeLoginError, setOpenAiLoginError]);

  useEffect(() => {
    if (selectedProviders.includes(llmProvider)) {
      return;
    }
    const fallback = selectedProviders[0] || "codex";
    if (fallback !== llmProvider) {
      setLlmProvider(fallback);
    }
  }, [selectedProviders, llmProvider, setLlmProvider]);

  useEffect(() => {
    try {
      localStorage.setItem(OPENAI_AUTH_MODE_KEY, openAiAuthMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [OPENAI_AUTH_MODE_KEY, openAiAuthMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_COMMANDS_VISIBLE_KEY,
        showChatCommands ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [CHAT_COMMANDS_VISIBLE_KEY, showChatCommands]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TOOL_RESULTS_VISIBLE_KEY,
        showToolResults ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [TOOL_RESULTS_VISIBLE_KEY, showToolResults]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAT_FULL_WIDTH_KEY,
        chatFullWidth ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [CHAT_FULL_WIDTH_KEY, chatFullWidth]);

  useEffect(() => {
    try {
      localStorage.setItem(
        NOTIFICATIONS_ENABLED_KEY,
        notificationsEnabled ? "true" : "false"
      );
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [NOTIFICATIONS_ENABLED_KEY, notificationsEnabled]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_MODE_KEY, themeMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [THEME_MODE_KEY, themeMode]);

  useEffect(() => {
    try {
      localStorage.setItem(COMPOSER_INPUT_MODE_KEY, composerInputMode);
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [COMPOSER_INPUT_MODE_KEY, composerInputMode]);

  useEffect(() => {
    try {
      localStorage.setItem(REPO_HISTORY_KEY, JSON.stringify(repoHistory));
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [REPO_HISTORY_KEY, repoHistory]);

  useEffect(() => {
    try {
      localStorage.setItem(DEBUG_MODE_KEY, debugMode ? "true" : "false");
    } catch (error) {
      // Ignore storage errors (private mode, quota).
    }
  }, [DEBUG_MODE_KEY, debugMode]);
}
