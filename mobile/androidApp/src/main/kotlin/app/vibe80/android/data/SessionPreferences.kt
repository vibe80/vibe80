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
        private val KEY_WORKSPACE_ID = stringPreferencesKey("workspace_id")
        private val KEY_WORKSPACE_SECRET = stringPreferencesKey("workspace_secret")
        private val KEY_WORKSPACE_TOKEN = stringPreferencesKey("workspace_token")
        private val KEY_WORKSPACE_REFRESH_TOKEN = stringPreferencesKey("workspace_refresh_token")
    }

    data class SavedWorkspace(
        val workspaceId: String,
        val workspaceSecret: String,
        val workspaceToken: String? = null,
        val workspaceRefreshToken: String? = null
    )

    val savedWorkspace: Flow<SavedWorkspace?> = context.dataStore.data.map { preferences ->
        val workspaceId = preferences[KEY_WORKSPACE_ID]
        val workspaceSecret = preferences[KEY_WORKSPACE_SECRET]
        val workspaceToken = preferences[KEY_WORKSPACE_TOKEN]
        val workspaceRefreshToken = preferences[KEY_WORKSPACE_REFRESH_TOKEN]
        if (workspaceId != null && workspaceSecret != null) {
            SavedWorkspace(workspaceId, workspaceSecret, workspaceToken, workspaceRefreshToken)
        } else {
            null
        }
    }

    suspend fun saveWorkspace(
        workspaceId: String,
        workspaceSecret: String,
        workspaceToken: String?,
        workspaceRefreshToken: String? = null
    ) {
        context.dataStore.edit { preferences ->
            preferences[KEY_WORKSPACE_ID] = workspaceId
            preferences[KEY_WORKSPACE_SECRET] = workspaceSecret
            if (workspaceToken.isNullOrBlank()) {
                preferences.remove(KEY_WORKSPACE_TOKEN)
            } else {
                preferences[KEY_WORKSPACE_TOKEN] = workspaceToken
            }
            if (workspaceRefreshToken.isNullOrBlank()) {
                preferences.remove(KEY_WORKSPACE_REFRESH_TOKEN)
            } else {
                preferences[KEY_WORKSPACE_REFRESH_TOKEN] = workspaceRefreshToken
            }
        }
    }

    suspend fun saveWorkspaceToken(workspaceToken: String?, refreshToken: String? = null) {
        context.dataStore.edit { preferences ->
            if (workspaceToken.isNullOrBlank()) {
                preferences.remove(KEY_WORKSPACE_TOKEN)
            } else {
                preferences[KEY_WORKSPACE_TOKEN] = workspaceToken
            }
            if (refreshToken.isNullOrBlank()) {
                preferences.remove(KEY_WORKSPACE_REFRESH_TOKEN)
            } else {
                preferences[KEY_WORKSPACE_REFRESH_TOKEN] = refreshToken
            }
        }
    }

    suspend fun clearWorkspace() {
        context.dataStore.edit { preferences ->
            preferences.remove(KEY_WORKSPACE_ID)
            preferences.remove(KEY_WORKSPACE_SECRET)
            preferences.remove(KEY_WORKSPACE_TOKEN)
            preferences.remove(KEY_WORKSPACE_REFRESH_TOKEN)
        }
    }

}
