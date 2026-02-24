import SwiftUI
import Shared

@main
struct Vibe80App: App {
    static let SHOW_LOGS_BUTTON = false
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
    private var workspaceTokenObserver: WorkspaceTokenObserver?
    private var workspaceAuthInvalidObserver: WorkspaceAuthInvalidObserver?

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
        syncWorkspaceTokensToRepository()
        observeWorkspaceTokenUpdates()
        observeWorkspaceAuthInvalid()
        isInitialized = true
    }

    private func syncWorkspaceTokensToRepository() {
        let defaults = UserDefaults.standard
        let workspaceToken = defaults.string(forKey: "workspaceToken")
        let workspaceRefreshToken = defaults.string(forKey: "workspaceRefreshToken")
        dependencies?.sessionRepository.setWorkspaceToken(token: workspaceToken)
        dependencies?.sessionRepository.setRefreshToken(token: workspaceRefreshToken)
    }

    private func observeWorkspaceTokenUpdates() {
        workspaceTokenObserver?.close()
        guard let observer = dependencies?.workspaceTokenObserver() else { return }
        workspaceTokenObserver = observer
        observer.subscribe { [weak self] workspaceToken, refreshToken in
            let defaults = UserDefaults.standard
            defaults.set(workspaceToken, forKey: "workspaceToken")
            defaults.set(refreshToken, forKey: "workspaceRefreshToken")
            self?.dependencies?.sessionRepository.setWorkspaceToken(token: workspaceToken)
            self?.dependencies?.sessionRepository.setRefreshToken(token: refreshToken)
            NotificationCenter.default.post(
                name: .workspaceTokensDidUpdate,
                object: nil,
                userInfo: [
                    "workspaceToken": workspaceToken,
                    "workspaceRefreshToken": refreshToken
                ]
            )
        }
    }

    private func observeWorkspaceAuthInvalid() {
        workspaceAuthInvalidObserver?.close()
        guard let observer = dependencies?.workspaceAuthInvalidObserver() else { return }
        workspaceAuthInvalidObserver = observer
        observer.subscribe { [weak self] message in
            guard let self = self else { return }
            self.sessionRepository?.setWorkspaceToken(token: nil)
            self.sessionRepository?.setRefreshToken(token: nil)
            self.clearSession()
            self.clearStoredWorkspaceData()
            NotificationCenter.default.post(
                name: .workspaceAuthInvalid,
                object: nil,
                userInfo: ["message": message]
            )
        }
    }

    private func clearStoredWorkspaceData() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "workspaceId")
        defaults.removeObject(forKey: "workspaceSecret")
        defaults.removeObject(forKey: "workspaceToken")
        defaults.removeObject(forKey: "workspaceRefreshToken")
        defaults.removeObject(forKey: "lastSessionId")
        defaults.removeObject(forKey: "lastRepoUrl")
        defaults.removeObject(forKey: "lastProvider")
        defaults.removeObject(forKey: "lastBaseUrl")
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
        workspaceTokenObserver?.close()
        workspaceAuthInvalidObserver?.close()
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
        syncWorkspaceTokensToRepository()
        observeWorkspaceTokenUpdates()
        observeWorkspaceAuthInvalid()
    }
}

extension Notification.Name {
    static let workspaceTokensDidUpdate = Notification.Name("workspaceTokensDidUpdate")
    static let workspaceAuthInvalid = Notification.Name("workspaceAuthInvalid")
}
