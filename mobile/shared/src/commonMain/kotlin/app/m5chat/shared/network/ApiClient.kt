package app.m5chat.shared.network

import app.m5chat.shared.logging.AppLogger
import app.m5chat.shared.models.*
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.*
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

class ApiClient(
    private val httpClient: HttpClient,
    private val baseUrl: String
) {
    private val json = Json { prettyPrint = false }

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
            }
            val responseBody = try { response.bodyAsText() } catch (e: Exception) { "" }
            AppLogger.apiResponse("POST", url, response.status.value, responseBody)

            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(
                    SessionCreationException(
                        statusCode = response.status.value,
                        statusDescription = response.status.description,
                        errorBody = responseBody,
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
            val response = httpClient.get(url)
            val responseBody = try { response.bodyAsText() } catch (e: Exception) { "" }
            AppLogger.apiResponse("GET", url, response.status.value, responseBody)

            if (response.status.isSuccess()) {
                Result.success(response.body())
            } else {
                Result.failure(
                    SessionGetException(
                        statusCode = response.status.value,
                        statusDescription = response.status.description,
                        errorBody = responseBody,
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
            }
            response.status.value in 200..299
        }
    }

    /**
     * Get list of remote branches
     */
    suspend fun getBranches(sessionId: String): Result<BranchInfo> {
        return runCatching {
            httpClient.get("$baseUrl/api/branches") {
                parameter("session", sessionId)
            }.body()
        }
    }

    /**
     * Fetch latest branches from remote
     */
    suspend fun fetchBranches(sessionId: String): Result<BranchInfo> {
        return runCatching {
            httpClient.post("$baseUrl/api/branches/fetch") {
                contentType(ContentType.Application.Json)
                setBody(mapOf("session" to sessionId))
            }.body()
        }
    }

    /**
     * Switch to a different branch
     */
    suspend fun switchBranch(sessionId: String, branch: String): Result<BranchSwitchResponse> {
        return runCatching {
            httpClient.post("$baseUrl/api/branches/switch") {
                contentType(ContentType.Application.Json)
                setBody(BranchSwitchRequest(session = sessionId, branch = branch))
            }.body()
        }
    }

    /**
     * Get available models for a provider
     */
    suspend fun getModels(sessionId: String, provider: String): Result<List<String>> {
        return runCatching {
            httpClient.get("$baseUrl/api/models") {
                parameter("session", sessionId)
                parameter("provider", provider)
            }.body()
        }
    }

    /**
     * Get worktree diff
     */
    suspend fun getWorktreeDiff(sessionId: String, worktreeId: String): Result<WorktreeDiffResponse> {
        return runCatching {
            httpClient.get("$baseUrl/api/worktree/$worktreeId/diff") {
                parameter("session", sessionId)
            }.body()
        }
    }

    /**
     * Merge a worktree
     */
    suspend fun mergeWorktree(worktreeId: String): Result<Unit> {
        return runCatching {
            httpClient.post("$baseUrl/api/worktree/$worktreeId/merge")
            Unit
        }
    }

    /**
     * Abort a merge in progress
     */
    suspend fun abortMerge(worktreeId: String): Result<Unit> {
        return runCatching {
            httpClient.post("$baseUrl/api/worktree/$worktreeId/abort-merge")
            Unit
        }
    }

    /**
     * List attachments for a session
     */
    suspend fun listAttachments(sessionId: String): Result<AttachmentListResponse> {
        return runCatching {
            httpClient.get("$baseUrl/api/attachments") {
                parameter("session", sessionId)
            }.body()
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
}

/**
 * Exception thrown when session creation fails with detailed debug info
 */
class SessionCreationException(
    val statusCode: Int? = null,
    val statusDescription: String? = null,
    val errorBody: String? = null,
    val url: String,
    cause: Throwable? = null
) : Exception(buildMessage(statusCode, statusDescription, errorBody, url, cause), cause) {
    companion object {
        private fun buildMessage(
            statusCode: Int?,
            statusDescription: String?,
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
    val url: String,
    cause: Throwable? = null
) : Exception(buildMessage(statusCode, statusDescription, errorBody, url, cause), cause) {
    companion object {
        private fun buildMessage(
            statusCode: Int?,
            statusDescription: String?,
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
