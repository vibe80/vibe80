package app.vibe80.shared.network

import app.vibe80.shared.logging.AppLogger
import app.vibe80.shared.logging.LogSource
import app.vibe80.shared.models.*
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.*
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlin.concurrent.Volatile
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
    @Volatile private var refreshToken: String? = null
    private val refreshMutex = Mutex()
    private var tokenRefreshListener: ((WorkspaceTokenUpdate) -> Unit)? = null

    data class WorkspaceTokenUpdate(
        val workspaceToken: String,
        val refreshToken: String
    )

    fun setWorkspaceToken(token: String?) {
        workspaceToken = token?.takeIf { it.isNotBlank() }
    }

    fun setRefreshToken(token: String?) {
        refreshToken = token?.takeIf { it.isNotBlank() }
    }

    fun setTokenRefreshListener(listener: ((WorkspaceTokenUpdate) -> Unit)?) {
        tokenRefreshListener = listener
    }

    private fun applyAuth(builder: HttpRequestBuilder) {
        val token = workspaceToken ?: return
        builder.header("Authorization", "Bearer $token")
    }

    private suspend fun refreshWorkspaceToken(): Boolean {
        val token = refreshToken ?: return false
        return refreshMutex.withLock {
            val currentToken = refreshToken ?: return@withLock false
            if (currentToken != token) {
                AppLogger.info(
                    LogSource.API,
                    "Refresh token already rotated by another in-flight refresh"
                )
                return@withLock true
            }
            val url = "$baseUrl/api/v1/workspaces/refresh"
            AppLogger.apiRequest("POST", url)
            return@withLock try {
                val response = httpClient.post(url) {
                    contentType(ContentType.Application.Json)
                    setBody(WorkspaceRefreshRequest(refreshToken = currentToken))
                }
                val responseBody = if (!response.status.isSuccess()) {
                    readBodyTextUtf8(response)
                } else {
                    ""
                }
                AppLogger.apiResponse("POST", url, response.status.value, responseBody)
                if (response.status.isSuccess()) {
                    val payload: WorkspaceRefreshResponse = response.body()
                    setWorkspaceToken(payload.workspaceToken)
                    setRefreshToken(payload.refreshToken)
                    tokenRefreshListener?.invoke(
                        WorkspaceTokenUpdate(payload.workspaceToken, payload.refreshToken)
                    )
                    true
                } else {
                    false
                }
            } catch (e: Exception) {
                AppLogger.apiError("POST", url, e)
                false
            }
        }
    }

    suspend fun tryRefreshWorkspaceToken(): Boolean = refreshWorkspaceToken()

    private suspend fun executeWithRefresh(
        url: String,
        request: suspend () -> io.ktor.client.statement.HttpResponse
    ): io.ktor.client.statement.HttpResponse {
        if (workspaceToken.isNullOrBlank()) {
            val refreshed = refreshWorkspaceToken()
            if (!refreshed || workspaceToken.isNullOrBlank()) {
                AppLogger.warning(
                    LogSource.API,
                    "Missing workspace token before protected API call",
                    "url=$url"
                )
                throw ApiResponseException(
                    statusCode = 401,
                    statusDescription = "Unauthorized",
                    errorType = "WORKSPACE_TOKEN_MISSING",
                    errorMessage = "Missing workspace token.",
                    errorBody = null,
                    url = url
                )
            }
        }

        val response = request()
        if (response.status.value != 401) {
            return response
        }
        val refreshed = refreshWorkspaceToken()
        if (!refreshed) {
            AppLogger.warning(LogSource.API, "Token refresh failed after 401", "url=$url")
            return response
        }
        AppLogger.info(LogSource.API, "Retrying request after token refresh", "url=$url")
        return request()
    }

    private suspend fun readBodyTextUtf8(response: io.ktor.client.statement.HttpResponse): String {
        return try {
            response.body<ByteArray>().decodeToString()
        } catch (_: Exception) {
            ""
        }
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
            ?: readBodyTextUtf8(response)
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
        val url = "$baseUrl/api/v1/sessions"
        val requestBody = json.encodeToString(request)
        AppLogger.apiRequest("POST", url, requestBody)

        return try {
            val response = executeWithRefresh(url) {
                httpClient.post(url) {
                    contentType(ContentType.Application.Json)
                    setBody(request)
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
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
                        errorMessage = payload?.error ?: payload?.message,
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
        val url = "$baseUrl/api/v1/sessions/$sessionId"
        AppLogger.apiRequest("GET", url)

        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
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
     * List sessions for the current workspace
     */
    suspend fun listSessions(): Result<SessionListResponse> {
        val url = "$baseUrl/api/v1/sessions"
        AppLogger.apiRequest("GET", url)
        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("GET", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", url, e)
            Result.failure(e)
        }
    }

    /**
     * Check if session is healthy and ready
     */
    suspend fun checkHealth(sessionId: String): Result<Boolean> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/health"
        AppLogger.apiRequest("GET", url)
        return runCatching {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    applyAuth(this)
                }
            }
            val status = response.status.value
            AppLogger.apiResponse("GET", url, status)
            response.status.value in 200..299
        }.onFailure { e ->
            AppLogger.apiError("GET", url, e)
        }
    }

    /**
     * Get available models for a provider
     */
    suspend fun getModels(sessionId: String, provider: String): Result<ModelsResponse> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/models"
        AppLogger.apiRequest("GET", "$url?provider=$provider")
        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    parameter("provider", provider)
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("GET", "$url?provider=$provider", response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", "$url?provider=$provider", e)
            Result.failure(e)
        }
    }

    /**
     * Get worktree state including messages
     */
    suspend fun getWorktree(sessionId: String, worktreeId: String): Result<WorktreeGetResponse> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/worktrees/$worktreeId"
        AppLogger.apiRequest("GET", url)
        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("GET", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", url, e)
            Result.failure(e)
        }
    }

    /**
     * Get worktree diff
     */
    suspend fun getWorktreeDiff(sessionId: String, worktreeId: String): Result<WorktreeDiffResponse> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/worktrees/$worktreeId/diff"
        AppLogger.apiRequest("GET", url)
        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("GET", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", url, e)
            Result.failure(e)
        }
    }

    /**
     * List worktrees for a session
     */
    suspend fun listWorktrees(sessionId: String): Result<WorktreesListResponse> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/worktrees"
        AppLogger.apiRequest("GET", url)
        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("GET", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", url, e)
            Result.failure(e)
        }
    }

    /**
     * Create a worktree via REST API
     */
    suspend fun createWorktree(request: WorktreeCreateApiRequest): Result<WorktreeCreateResponse> {
        val url = "$baseUrl/api/v1/sessions/${request.session}/worktrees"
        val payload = WorktreeCreateRequest(
            provider = request.provider,
            context = request.context,
            sourceWorktree = request.sourceWorktree,
            parentWorktreeId = request.parentWorktreeId,
            name = request.name,
            startingBranch = request.startingBranch,
            model = request.model,
            reasoningEffort = request.reasoningEffort,
            internetAccess = request.internetAccess,
            denyGitCredentialsAccess = request.denyGitCredentialsAccess
        )
        AppLogger.apiRequest("POST", url, json.encodeToString(payload))
        return try {
            val response = executeWithRefresh(url) {
                httpClient.post(url) {
                    contentType(ContentType.Application.Json)
                    setBody(payload)
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
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

    /**
     * Get a worktree file content
     */
    suspend fun getWorktreeFile(
        sessionId: String,
        worktreeId: String,
        path: String
    ): Result<WorktreeFileResponse> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/worktrees/$worktreeId/file"
        AppLogger.apiRequest("GET", "$url?path=$path")
        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    parameter("path", path)
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("GET", "$url?path=$path", response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", "$url?path=$path", e)
            Result.failure(e)
        }
    }

    /**
     * Create a worktree
     */
    suspend fun createWorktree(
        sessionId: String,
        request: WorktreeCreateRequest
    ): Result<WorktreeCreateResponse> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/worktrees"
        AppLogger.apiRequest("POST", url, json.encodeToString(request))
        return try {
            val response = executeWithRefresh(url) {
                httpClient.post(url) {
                    contentType(ContentType.Application.Json)
                    setBody(request.copy())
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
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

    /**
     * Delete a worktree
     */
    suspend fun deleteWorktree(sessionId: String, worktreeId: String): Result<Unit> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/worktrees/$worktreeId"
        AppLogger.apiRequest("DELETE", url)
        return try {
            val response = executeWithRefresh(url) {
                httpClient.delete(url) {
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("DELETE", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(Unit)
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("DELETE", url, e)
            Result.failure(e)
        }
    }


    /**
     * List attachments for a session
     */
    suspend fun listAttachments(sessionId: String): Result<AttachmentListResponse> {
        val url = "$baseUrl/api/v1/sessions/$sessionId/attachments"
        AppLogger.apiRequest("GET", "$url?session=$sessionId")
        return try {
            val response = executeWithRefresh(url) {
                httpClient.get(url) {
                    parameter("session", sessionId)
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("GET", "$url?session=$sessionId", response.status.value, responseBody)
            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("GET", "$url?session=$sessionId", e)
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
        val url = "$baseUrl/api/v1/workspaces"
        AppLogger.apiRequest("POST", url)
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(request)
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
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
        val url = "$baseUrl/api/v1/workspaces/login"
        AppLogger.apiRequest("POST", url)
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(request)
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
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
        val url = "$baseUrl/api/v1/workspaces/$workspaceId"
        AppLogger.apiRequest("PATCH", url)
        return try {
            val response = executeWithRefresh(url) {
                httpClient.patch(url) {
                    contentType(ContentType.Application.Json)
                    setBody(request)
                    applyAuth(this)
                }
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
            } else {
                ""
            }
            AppLogger.apiResponse("PATCH", url, response.status.value, responseBody)
            if (response.status.isSuccess()) {
                val successBody = readBodyTextUtf8(response)
                val parsed = runCatching {
                    if (successBody.isBlank()) {
                        WorkspaceUpdateResponse(workspaceId = workspaceId, providers = request.providers)
                    } else {
                        errorJson.decodeFromString(WorkspaceUpdateResponse.serializer(), successBody)
                    }
                }.getOrElse {
                    WorkspaceUpdateResponse(workspaceId = workspaceId, providers = request.providers)
                }
                Result.success(parsed)
            } else {
                Result.failure(buildApiException(response, url, responseBody))
            }
        } catch (e: Exception) {
            AppLogger.apiError("PATCH", url, e)
            Result.failure(e)
        }
    }
    suspend fun consumeHandoffToken(request: HandoffConsumeRequest): Result<HandoffConsumeResponse> {
        val url = "$baseUrl/api/v1/sessions/handoff/consume"
        AppLogger.apiRequest("POST", url)
        return try {
            val response = httpClient.post(url) {
                contentType(ContentType.Application.Json)
                setBody(request)
            }
            val responseBody = if (!response.status.isSuccess()) {
                readBodyTextUtf8(response)
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
    val errorMessage: String? = null,
    val url: String,
    cause: Throwable? = null
) : Exception(
    buildMessage(statusCode, statusDescription, errorType, errorBody, errorMessage, url, cause),
    cause
) {
    companion object {
        private fun buildMessage(
            statusCode: Int?,
            statusDescription: String?,
            errorType: String?,
            errorBody: String?,
            errorMessage: String?,
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
