package app.m5chat.shared

import app.m5chat.shared.di.sharedModule
import app.m5chat.shared.network.ApiClient
import app.m5chat.shared.network.WebSocketManager
import app.m5chat.shared.repository.SessionRepository
import org.koin.core.component.KoinComponent
import org.koin.core.component.inject
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin

/**
 * Helper object for initializing Koin from iOS.
 * Call KoinHelper.start(baseUrl) from Swift AppDelegate or AppState.
 */
object KoinHelper {

    /**
     * Initialize Koin with the shared module.
     * @param baseUrl The server base URL (e.g., "https://m5chat.example.com")
     */
    fun start(baseUrl: String) {
        startKoin {
            modules(sharedModule(baseUrl))
        }
    }

    /**
     * Stop Koin (call on app termination if needed)
     */
    fun stop() {
        stopKoin()
    }
}

/**
 * Provides access to shared module dependencies from iOS.
 * Usage in Swift:
 *   let provider = SharedDependencies()
 *   let repository = provider.sessionRepository
 */
class SharedDependencies : KoinComponent {
    val sessionRepository: SessionRepository by inject()
    val apiClient: ApiClient by inject()
    val webSocketManager: WebSocketManager by inject()
}
