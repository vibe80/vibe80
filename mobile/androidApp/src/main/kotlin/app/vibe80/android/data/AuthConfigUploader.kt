package app.vibe80.android.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Uploads LLM provider authentication configuration files to the server.
 *
 * The server expects:
 * - POST /api/auth-file for Codex auth.json
 * - POST /api/claude-auth-file for Claude credentials.json
 *
 * Both endpoints accept multipart form data with a single "file" field.
 */
class AuthConfigUploader(private val baseUrl: String) {

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    /**
     * Upload Codex auth.json configuration to the server.
     * @param configJson The raw JSON content of auth.json
     * @return Result with success or error message
     */
    suspend fun uploadCodexConfig(configJson: String): Result<Unit> = withContext(Dispatchers.IO) {
        uploadConfig(configJson, "/api/auth-file", "auth.json")
    }

    /**
     * Upload Claude credentials.json configuration to the server.
     * @param configJson The raw JSON content of credentials.json
     * @return Result with success or error message
     */
    suspend fun uploadClaudeConfig(configJson: String): Result<Unit> = withContext(Dispatchers.IO) {
        uploadConfig(configJson, "/api/claude-auth-file", "credentials.json")
    }

    private fun uploadConfig(configJson: String, endpoint: String, filename: String): Result<Unit> {
        return try {
            // Validate JSON before sending
            try {
                JSONObject(configJson)
            } catch (e: Exception) {
                return Result.failure(AuthConfigException("Invalid JSON format in $filename"))
            }

            val mediaType = "application/json".toMediaType()
            val requestBody = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("file", filename, configJson.toRequestBody(mediaType))
                .build()

            val request = Request.Builder()
                .url("$baseUrl$endpoint")
                .post(requestBody)
                .build()

            val response = client.newCall(request).execute()
            val responseBody = response.body?.string()

            if (response.isSuccessful) {
                Result.success(Unit)
            } else {
                val errorMessage = try {
                    responseBody?.let { JSONObject(it).optString("error", "Unknown error") }
                        ?: "Upload failed with status ${response.code}"
                } catch (e: Exception) {
                    responseBody ?: "Upload failed with status ${response.code}"
                }
                Result.failure(AuthConfigException(errorMessage))
            }
        } catch (e: Exception) {
            Result.failure(AuthConfigException("Network error: ${e.message}"))
        }
    }
}

/**
 * Exception thrown when auth config upload fails
 */
class AuthConfigException(message: String) : Exception(message)
