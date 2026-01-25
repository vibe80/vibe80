package app.m5chat.android.data

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
    }

    data class SavedSession(
        val sessionId: String,
        val repoUrl: String,
        val provider: String,
        val baseUrl: String
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

    suspend fun clearSession() {
        context.dataStore.edit { preferences ->
            preferences.remove(KEY_SESSION_ID)
            preferences.remove(KEY_REPO_URL)
            preferences.remove(KEY_PROVIDER)
            preferences.remove(KEY_BASE_URL)
        }
    }
}
