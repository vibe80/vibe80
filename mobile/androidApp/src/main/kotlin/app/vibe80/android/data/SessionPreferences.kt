package app.vibe80.android.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "session_prefs")

class SessionPreferences(private val context: Context) {

    companion object {
        private val KEY_SESSION_ID = stringPreferencesKey("session_id")
        private val KEY_REPO_URL = stringPreferencesKey("repo_url")
        private val KEY_PROVIDER = stringPreferencesKey("provider")
        private val KEY_BASE_URL = stringPreferencesKey("base_url")
        private val KEY_WORKSPACE_ID = stringPreferencesKey("workspace_id")
        private val KEY_WORKSPACE_SECRET = stringPreferencesKey("workspace_secret")
        private val KEY_WORKSPACE_TOKEN = stringPreferencesKey("workspace_token")
    }

    data class SavedSession(
        val sessionId: String,
        val repoUrl: String,
        val provider: String,
        val baseUrl: String
    )

    data class SavedWorkspace(
        val workspaceId: String,
        val workspaceSecret: String,
        val workspaceToken: String? = null
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

    val savedWorkspace: Flow<SavedWorkspace?> = context.dataStore.data.map { preferences ->
        val workspaceId = preferences[KEY_WORKSPACE_ID]
        val workspaceSecret = preferences[KEY_WORKSPACE_SECRET]
        val workspaceToken = preferences[KEY_WORKSPACE_TOKEN]
        if (workspaceId != null && workspaceSecret != null) {
            SavedWorkspace(workspaceId, workspaceSecret, workspaceToken)
        } else {
            null
        }
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

    suspend fun saveWorkspace(
        workspaceId: String,
        workspaceSecret: String,
        workspaceToken: String?
    ) {
        context.dataStore.edit { preferences ->
            preferences[KEY_WORKSPACE_ID] = workspaceId
            preferences[KEY_WORKSPACE_SECRET] = workspaceSecret
            if (workspaceToken.isNullOrBlank()) {
                preferences.remove(KEY_WORKSPACE_TOKEN)
            } else {
                preferences[KEY_WORKSPACE_TOKEN] = workspaceToken
            }
        }
    }

    suspend fun saveWorkspaceToken(workspaceToken: String?) {
        context.dataStore.edit { preferences ->
            if (workspaceToken.isNullOrBlank()) {
                preferences.remove(KEY_WORKSPACE_TOKEN)
            } else {
                preferences[KEY_WORKSPACE_TOKEN] = workspaceToken
            }
        }
    }

    suspend fun clearWorkspace() {
        context.dataStore.edit { preferences ->
            preferences.remove(KEY_WORKSPACE_ID)
            preferences.remove(KEY_WORKSPACE_SECRET)
            preferences.remove(KEY_WORKSPACE_TOKEN)
        }
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
