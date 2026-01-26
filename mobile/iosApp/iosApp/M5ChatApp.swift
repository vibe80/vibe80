import SwiftUI
import shared

@main
struct M5ChatApp: App {
    @StateObject private var appState = AppState()

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

    private var sessionRepository: SessionRepository?

    init() {
        // Initialize shared module
        setupSharedModule()
    }

    private func setupSharedModule() {
        // SharedModule initialization will be done here
        // The Koin DI from shared module needs to be initialized
    }

    func setSession(sessionId: String) {
        currentSessionId = sessionId
    }

    func clearSession() {
        currentSessionId = nil
        isConnected = false
    }
}
