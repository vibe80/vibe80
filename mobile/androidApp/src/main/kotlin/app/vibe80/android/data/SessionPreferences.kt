package app.vibe80.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "session_prefs")

class SessionPreferences(private val context: Context) {

    companion object {
        private val KEY_SESSION_ID = stringPreferencesKey("session_id")
        private val KEY_REPO_URL = stringPreferencesKey("repo_url")
        private val KEY_PROVIDER = stringPreferencesKey("provider")
        private val KEY_BASE_URL = stringPreferencesKey("base_url")
        private val KEY_CLAUDE_CONFIG = stringPreferencesKey("claude_config")
        private val KEY_CODEX_CONFIG = stringPreferencesKey("codex_config")
    }

    data class SavedSession(
        val sessionId: String,
        val repoUrl: String,
        val provider: String,
        val baseUrl: String
    )

    data class LLMConfig(
        val claudeConfig: String? = null,
        val codexConfig: String? = null
    )

    val savedSession: Flow<SavedSession?> = context.dataStore.data.map { preferences ->
        val sessionId = preferences[KEY_SESSION_ID]
        val repoUrl = preferences[KEY_REPO_URL]
        val provider = preferences[KEY_PROVIDER]
        val baseUrl = preferences[KEY_BASE_URL]

        if (sessionId != null && repoUrl != null && provider != null && baseUrl != null) {
            SavedSession(sessionId, repoUrl, provider, baseUrl)
        } else {
            null
        }
    }

    val llmConfig: Flow<LLMConfig> = context.dataStore.data.map { preferences ->
        LLMConfig(
            claudeConfig = preferences[KEY_CLAUDE_CONFIG],
            codexConfig = preferences[KEY_CODEX_CONFIG]
        )
    }

    suspend fun saveSession(
        sessionId: String,
        repoUrl: String,
        provider: String,
        baseUrl: String
    ) {
        context.dataStore.edit { preferences ->
            preferences[KEY_SESSION_ID] = sessionId
            preferences[KEY_REPO_URL] = repoUrl
            preferences[KEY_PROVIDER] = provider
            preferences[KEY_BASE_URL] = baseUrl
        }
    }

    suspend fun saveClaudeConfig(configJson: String) {
        context.dataStore.edit { preferences ->
            preferences[KEY_CLAUDE_CONFIG] = configJson
        }
    }

    suspend fun saveCodexConfig(configJson: String) {
        context.dataStore.edit { preferences ->
            preferences[KEY_CODEX_CONFIG] = configJson
        }
    }

    suspend fun clearClaudeConfig() {
        context.dataStore.edit { preferences ->
            preferences.remove(KEY_CLAUDE_CONFIG)
        }
    }

    suspend fun clearCodexConfig() {
        context.dataStore.edit { preferences ->
            preferences.remove(KEY_CODEX_CONFIG)
        }
    }

    suspend fun getClaudeConfig(): String? {
        return context.dataStore.data.first()[KEY_CLAUDE_CONFIG]
    }

    suspend fun getCodexConfig(): String? {
        return context.dataStore.data.first()[KEY_CODEX_CONFIG]
    }

    suspend fun clearSession() {
        context.dataStore.edit { preferences ->
            preferences.remove(KEY_SESSION_ID)
            preferences.remove(KEY_REPO_URL)
            preferences.remove(KEY_PROVIDER)
            preferences.remove(KEY_BASE_URL)
        }
    }
}
