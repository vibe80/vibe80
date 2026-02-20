import SwiftUI
import Shared

@main
struct Vibe80App: App {
    @StateObject private var appState = AppState()

    init() {
        NotificationManager.shared.requestAuthorization()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
        }
    }
}

/// Global app state managing session and navigation
class AppState: ObservableObject {
    @Published var currentSessionId: String?
    @Published var isConnected: Bool = false
    @Published var isInitialized: Bool = false

    /// Shared dependencies from KMP module
    private(set) var dependencies: SharedDependencies?

    /// Convenience accessor for SessionRepository
    var sessionRepository: SessionRepository? {
        dependencies?.sessionRepository
    }

    init() {
        setupSharedModule()
    }

    private func setupSharedModule() {
        // Initialize Koin with server base URL
        // In production, this should come from a configuration file or environment
        let baseUrl = getServerUrl()
        KoinHelper.shared.start(baseUrl: baseUrl)

        // Get dependencies
        dependencies = SharedDependencies()
        isInitialized = true
    }

    /// Get server URL from configuration
    /// Override this for different environments (dev, staging, prod)
    private func getServerUrl() -> String {
        // Check for environment override
        if let envUrl = ProcessInfo.processInfo.environment["VIBE80_SERVER_URL"] {
            return envUrl
        }

        // Check UserDefaults for custom server
        if let savedUrl = UserDefaults.standard.string(forKey: "serverUrl"), !savedUrl.isEmpty {
            return savedUrl
        }

        // Default server URL - change this for your deployment
        #if DEBUG
        return "https://app.vibe80.io"
        #else
        return "https://app.vibe80.io"
        #endif
    }

    func setSession(sessionId: String) {
        currentSessionId = sessionId
        isConnected = true
    }

    func clearSession() {
        currentSessionId = nil
        isConnected = false
        sessionRepository?.disconnect()
    }

    deinit {
        KoinHelper.shared.stop()
    }
}

// MARK: - Server URL Configuration

extension AppState {
    /// Update server URL and reinitialize Koin
    func updateServerUrl(_ url: String) {
        UserDefaults.standard.set(url, forKey: "serverUrl")

        // Reinitialize Koin with new URL
        KoinHelper.shared.stop()
        KoinHelper.shared.start(baseUrl: url)
        dependencies = SharedDependencies()
    }
}
