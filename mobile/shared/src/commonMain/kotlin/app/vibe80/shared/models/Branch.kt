package app.vibe80.shared.models

import kotlinx.serialization.Serializable

@Serializable
data class BranchInfo(
    val current: String,
    val remote: String,
    val branches: List<String>
)

@Serializable
data class BranchSwitchRequest(
    val session: String,
    val branch: String
)

@Serializable
data class BranchSwitchResponse(
    val success: Boolean,
    val branch: String,
    val message: String? = null
)

@Serializable
data class RepoDiff(
    val status: String,
    val diff: String
)
