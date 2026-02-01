package app.vibe80.shared

interface Platform {
    val name: String
}

expect fun getPlatform(): Platform
