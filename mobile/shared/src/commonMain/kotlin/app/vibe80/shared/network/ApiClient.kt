package app.vibe80.shared.network

import app.vibe80.shared.logging.AppLogger
import app.vibe80.shared.models.*
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.*
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.encodeToString
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class ApiClient(
    private val httpClient: HttpClient,
    private val baseUrl: String
) {
    private val json = Json { prettyPrint = false }
    private val errorJson = Json {
        ignoreUnknownKeys = true
        isLenient = true
        prettyPrint = false
    }
    @Volatile private var workspaceToken: String? = null

    fun setWorkspaceToken(token: String?) {
        workspaceToken = token?.takeIf { it.isNotBlank() }
    }

    private fun applyAuth(builder: HttpRequestBuilder) {
        val token = workspaceToken ?: return
        builder.header("Authorization", "Bearer $token")
    }

    private fun parseErrorPayload(bodyText: String): ApiErrorPayload? {
        if (bodyText.isBlank()) return null
        return try {
            errorJson.decodeFromString(ApiErrorPayload.serializer(), bodyText)
        } catch (_: Exception) {
            null
        }
    }

    private suspend fun buildApiException(
        response: io.ktor.client.statement.HttpResponse,
        url: String,
        responseBodyOverride: String? = null
    ): ApiResponseException {
        val responseBody = responseBodyOverride
            ?: runCatching { response.bodyAsText() }.getOrDefault("")
        val payload = parseErrorPayload(responseBody)
        return ApiResponseException(
            statusCode = response.status.value,
            statusDescription = response.status.description,
            errorType = payload?.error_type,
            errorMessage = payload?.error ?: payload?.message,
            errorBody = responseBody,
            url = url
        )
    }

    /**
     * Create a new session by cloning a repository
     */
    suspend fun createSession(request: SessionCreateRequest): Result<SessionCreateResponse> {
        val url = "$baseUrl/api/session"
        val requestBody = json.encodeToString(request)
        AppLogger.apiRequest("POST", url, requestBody)

        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(request)
                applyAuth(this)
            }
            val responseBody = if (!response.status.isSuccess()) {
                try { response.bodyAsText() } catch (_: Exception) { "" }
            } else {
                ""
            }
            AppLogger.apiResponse("POST", url, response.status.value, responseBody)

            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                val payload = parseErrorPayload(responseBody)
                Result.failure(
                    SessionCreationException(
                        statusCode = response.status.value,
                        statusDescription = response.status.description,
                        errorBody = responseBody,
                        errorType = payload?.error_type,
                        url = url
                    )
                )
            }
        } catch (e: Exception) {
            AppLogger.apiError("POST", url, e)
            Result.failure(
                SessionCreationException(
                    cause = e,
                    url = url
                )
            )
        }
    }

    /**
     * Get session state including messages and diff
     */
    suspend fun getSession(sessionId: String): Result<SessionGetResponse> {
        val url = "$baseUrl/api/session/$sessionId"
        AppLogger.apiRequest("GET", url)

        return try {
            val response = httpClient.get(url) {
                applyAuth(this)
            }
            val responseBody = if (!response.status.isSuccess()) {
                try { response.bodyAsText() } catch (_: Exception) { "" }
            } else {
                ""
            }
            AppLogger.apiResponse("GET", url, response.status.value, responseBody)

            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                val payload = parseErrorPayload(responseBody)
                Result.failure(
                    SessionGetException(
                        statusCode = response.status.value,
                        statusDescription = response.status.description,
                        errorBody = responseBody,
                        errorType = payload?.error_type,
                        url = url
                    )
                )
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", url, e)
            Result.failure(SessionGetException(cause = e, url = url))
        }
    }

    /**
     * Check if session is healthy and ready
     */
    suspend fun checkHealth(sessionId: String): Result<Boolean> {
        return runCatching {
            val response = httpClient.get("$baseUrl/api/health") {
                parameter("session", sessionId)
                applyAuth(this)
            }
            response.status.value in 200..299
        }
    }

    /**
     * Get list of remote branches
     */
    suspend fun getBranches(sessionId: String): Result<BranchInfo> {
        val url = "$baseUrl/api/branches"
        return try {
            val response = httpClient.get(url) {
                parameter("session", sessionId)
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Fetch latest branches from remote
     */
    suspend fun fetchBranches(sessionId: String): Result<BranchInfo> {
        val url = "$baseUrl/api/branches/fetch"
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(mapOf("session" to sessionId))
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Switch to a different branch
     */
    suspend fun switchBranch(sessionId: String, branch: String): Result<BranchSwitchResponse> {
        val url = "$baseUrl/api/branches/switch"
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(BranchSwitchRequest(session = sessionId, branch = branch))
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get available models for a provider
     */
    suspend fun getModels(sessionId: String, provider: String): Result<ModelsResponse> {
        val url = "$baseUrl/api/models"
        return try {
            val response = httpClient.get(url) {
                parameter("session", sessionId)
                parameter("provider", provider)
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Get worktree diff
     */
    suspend fun getWorktreeDiff(sessionId: String, worktreeId: String): Result<WorktreeDiffResponse> {
        val url = "$baseUrl/api/worktree/$worktreeId/diff"
        return try {
            val response = httpClient.get(url) {
                parameter("session", sessionId)
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Merge a worktree
     */
    suspend fun mergeWorktree(worktreeId: String): Result<Unit> {
        val url = "$baseUrl/api/worktree/$worktreeId/merge"
        return try {
            val response = httpClient.post(url) {
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(Unit)
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Delete a worktree
     */
    suspend fun deleteWorktree(sessionId: String, worktreeId: String): Result<Unit> {
        val url = "$baseUrl/api/worktree/$worktreeId"
        return try {
            val response = httpClient.delete(url) {
                parameter("session", sessionId)
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(Unit)
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Abort a merge in progress
     */
    suspend fun abortMerge(worktreeId: String): Result<Unit> {
        val url = "$baseUrl/api/worktree/$worktreeId/abort-merge"
        return try {
            val response = httpClient.post(url) {
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(Unit)
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * List attachments for a session
     */
    suspend fun listAttachments(sessionId: String): Result<AttachmentListResponse> {
        val url = "$baseUrl/api/attachments"
        return try {
            val response = httpClient.get(url) {
                parameter("session", sessionId)
                applyAuth(this)
            }
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Upload attachments - platform-specific implementation required
     * This is a placeholder that returns empty list
     */
    suspend fun uploadAttachments(
        sessionId: String,
        files: List<Pair<String, String>>
    ): Result<List<Attachment>> {
        // This needs platform-specific implementation
        // Android will use OkHttp multipart
        return Result.success(emptyList())
    }

    /**
     * Get base URL for platform-specific upload implementation
     */
    fun getBaseUrl(): String = baseUrl

    suspend fun createWorkspace(request: WorkspaceCreateRequest): Result<WorkspaceCreateResponse> {
        val url = "$baseUrl/api/workspaces"
        AppLogger.apiRequest("POST", url)
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(request)
            }
            val responseBody = if (!response.status.isSuccess()) {
                try { response.bodyAsText() } catch (_: Exception) { "" }
            } else {
                ""
            }
            AppLogger.apiResponse("POST", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("POST", url, e)
            Result.failure(e)
        }
    }

    suspend fun loginWorkspace(request: WorkspaceLoginRequest): Result<WorkspaceLoginResponse> {
        val url = "$baseUrl/api/workspaces/login"
        AppLogger.apiRequest("POST", url)
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(request)
            }
            val responseBody = if (!response.status.isSuccess()) {
                try { response.bodyAsText() } catch (_: Exception) { "" }
            } else {
                ""
            }
            AppLogger.apiResponse("POST", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("POST", url, e)
            Result.failure(e)
        }
    }

    suspend fun updateWorkspace(workspaceId: String, request: WorkspaceUpdateRequest): Result<WorkspaceUpdateResponse> {
        val url = "$baseUrl/api/workspaces/$workspaceId"
        AppLogger.apiRequest("PATCH", url)
        return try {
            val response = httpClient.patch(url) {
                contentType(ContentType.Application.Json)
                setBody(request)
                applyAuth(this)
            }
            val responseBody = if (!response.status.isSuccess()) {
                try { response.bodyAsText() } catch (_: Exception) { "" }
            } else {
                ""
            }
            AppLogger.apiResponse("PATCH", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("PATCH", url, e)
            Result.failure(e)
        }
    }
}

@Serializable
data class ApiErrorPayload(
    val error: String? = null,
    val message: String? = null,
    val error_type: String? = null
)

class ApiResponseException(
    val statusCode: Int? = null,
    val statusDescription: String? = null,
    val errorType: String? = null,
    val errorMessage: String? = null,
    val errorBody: String? = null,
    val url: String,
    cause: Throwable? = null
) : Exception(buildMessage(statusCode, statusDescription, errorType, errorMessage, errorBody, url, cause), cause) {
    companion object {
        private fun buildMessage(
            statusCode: Int?,
            statusDescription: String?,
            errorType: String?,
            errorMessage: String?,
            errorBody: String?,
            url: String,
            cause: Throwable?
        ): String {
            return buildString {
                append("Échec requête API\n")
                append("URL: $url\n")
                if (statusCode != null) {
                    append("Status: $statusCode")
                    if (statusDescription != null) {
                        append(" ($statusDescription)")
                    }
                    append("\n")
                }
                if (!errorType.isNullOrBlank()) {
                    append("Type: $errorType\n")
                }
                if (!errorMessage.isNullOrBlank()) {
                    append("Message: $errorMessage\n")
                }
                if (!errorBody.isNullOrBlank()) {
                    append("Réponse: ${errorBody.take(500)}\n")
                }
                if (cause != null) {
                    append("Cause: ${cause::class.simpleName}: ${cause.message}")
                }
            }.trim()
        }
    }
}

/**
 * Exception thrown when session creation fails with detailed debug info
 */
class SessionCreationException(
    val statusCode: Int? = null,
    val statusDescription: String? = null,
    val errorBody: String? = null,
    val errorType: String? = null,
    val url: String,
    cause: Throwable? = null
) : Exception(buildMessage(statusCode, statusDescription, errorType, errorBody, url, cause), cause) {
    companion object {
        private fun buildMessage(
            statusCode: Int?,
            statusDescription: String?,
            errorType: String?,
            errorBody: String?,
            url: String,
            cause: Throwable?
        ): String {
            return buildString {
                append("Échec création session\n")
                append("URL: $url\n")
                if (statusCode != null) {
                    append("Status: $statusCode")
                    if (statusDescription != null) {
                        append(" ($statusDescription)")
                    }
                    append("\n")
                }
                if (!errorType.isNullOrBlank()) {
                    append("Type: $errorType\n")
                }
                if (!errorBody.isNullOrBlank()) {
                    append("Réponse: ${errorBody.take(500)}\n")
                }
                if (cause != null) {
                    append("Cause: ${cause::class.simpleName}: ${cause.message}")
                }
            }.trim()
        }
    }
}

/**
 * Exception thrown when session fetch fails with detailed debug info
 */
class SessionGetException(
    val statusCode: Int? = null,
    val statusDescription: String? = null,
    val errorBody: String? = null,
    val errorType: String? = null,
    val url: String,
    cause: Throwable? = null
) : Exception(buildMessage(statusCode, statusDescription, errorType, errorBody, url, cause), cause) {
    companion object {
        private fun buildMessage(
            statusCode: Int?,
            statusDescription: String?,
            errorType: String?,
            errorBody: String?,
            url: String,
            cause: Throwable?
        ): String {
            return buildString {
                append("Échec récupération session\n")
                append("URL: $url\n")
                if (statusCode != null) {
                    append("Status: $statusCode")
                    if (statusDescription != null) {
                        append(" ($statusDescription)")
                    }
                    append("\n")
                }
                if (!errorType.isNullOrBlank()) {
                    append("Type: $errorType\n")
                }
                if (!errorBody.isNullOrBlank()) {
                    append("Réponse: ${errorBody.take(500)}\n")
                }
                if (cause != null) {
                    append("Cause: ${cause::class.simpleName}: ${cause.message}")
                }
            }.trim()
        }
    }
}
