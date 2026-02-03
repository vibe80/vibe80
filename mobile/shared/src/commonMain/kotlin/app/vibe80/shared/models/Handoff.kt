package app.vibe80.shared.models

import kotlinx.serialization.Serializable

@Serializable
data class HandoffConsumeRequest(
    val handoffToken: String
)

@Serializable
data class HandoffConsumeResponse(
    val workspaceId: String,
    val workspaceToken: String,
    val refreshToken: String,
    val expiresIn: Long,
    val refreshExpiresIn: Long,
    val sessionId: String
)
