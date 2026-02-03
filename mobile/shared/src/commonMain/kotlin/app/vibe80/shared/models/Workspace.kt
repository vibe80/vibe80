package app.vibe80.shared.models

import kotlinx.serialization.Serializable

@Serializable
data class WorkspaceAuth(
    val type: String,
    val value: String
)

@Serializable
data class WorkspaceProviderConfig(
    val enabled: Boolean,
    val auth: WorkspaceAuth? = null
)

@Serializable
data class WorkspaceCreateRequest(
    val providers: Map<String, WorkspaceProviderConfig>
)

@Serializable
data class WorkspaceCreateResponse(
    val workspaceId: String,
    val workspaceSecret: String
)

@Serializable
data class WorkspaceLoginRequest(
    val workspaceId: String,
    val workspaceSecret: String
)

@Serializable
data class WorkspaceLoginResponse(
    val workspaceToken: String,
    val refreshToken: String,
    val expiresIn: Long,
    val refreshExpiresIn: Long
)

@Serializable
data class WorkspaceRefreshRequest(
    val refreshToken: String
)

@Serializable
data class WorkspaceRefreshResponse(
    val workspaceToken: String,
    val refreshToken: String,
    val expiresIn: Long,
    val refreshExpiresIn: Long
)

@Serializable
data class WorkspaceUpdateRequest(
    val providers: Map<String, WorkspaceProviderConfig>
)

@Serializable
data class WorkspaceUpdateResponse(
    val workspaceId: String,
    val providers: Map<String, WorkspaceProviderConfig>
)
