package app.m5chat.shared.network

import app.m5chat.shared.models.*
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.*
import io.ktor.http.ContentType
import io.ktor.http.contentType

class ApiClient(
    private val httpClient: HttpClient,
    private val baseUrl: String
) {
    /**
     * Create a new session by cloning a repository
     */
    suspend fun createSession(request: SessionCreateRequest): Result<SessionCreateResponse> {
        return runCatching {
            httpClient.post("$baseUrl/api/session") {
                contentType(ContentType.Application.Json)
                setBody(request)
            }.body()
        }
    }

    /**
     * Get session state including messages and diff
     */
    suspend fun getSession(sessionId: String): Result<SessionGetResponse> {
        return runCatching {
            httpClient.get("$baseUrl/api/session/$sessionId").body()
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
    suspend fun getWorktreeDiff(worktreeId: String): Result<WorktreeDiffResponse> {
        return runCatching {
            httpClient.get("$baseUrl/api/worktree/$worktreeId/diff").body()
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
