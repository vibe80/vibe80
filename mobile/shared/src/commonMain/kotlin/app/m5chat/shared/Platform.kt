package app.m5chat.shared

interface Platform {
    val name: String
}

expect fun getPlatform(): Platform
