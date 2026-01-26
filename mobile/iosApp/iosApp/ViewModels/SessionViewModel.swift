import SwiftUI
import Combine
import shared

/// ViewModel for SessionView - handles session creation and resumption
@MainActor
class SessionViewModel: ObservableObject {
    // Form state
    @Published var repoUrl: String = ""
    @Published var authMethod: AuthMethod = .none
    @Published var sshKey: String = ""
    @Published var httpUser: String = ""
    @Published var httpPassword: String = ""
    @Published var selectedProvider: LLMProvider = .codex

    // UI state
    @Published var isLoading: Bool = false
    @Published var showError: Bool = false
    @Published var errorMessage: String = ""
    @Published var previousSessionId: String?

    // Shared module references
    private var sessionRepository: SessionRepository?

    init() {
        loadPreviousSession()
    }

    // MARK: - Previous Session

    private func loadPreviousSession() {
        // Load from UserDefaults
        previousSessionId = UserDefaults.standard.string(forKey: "lastSessionId")
    }

    func forgetSession() {
        UserDefaults.standard.removeObject(forKey: "lastSessionId")
        previousSessionId = nil
    }

    // MARK: - Session Creation

    func createSession(appState: AppState) {
        guard !repoUrl.isEmpty else { return }

        isLoading = true

        Task {
            do {
                // Call shared module to create session
                // This will be implemented when KMP framework is integrated
                let sessionId = try await createSessionAsync()

                // Save session ID
                UserDefaults.standard.set(sessionId, forKey: "lastSessionId")

                // Update app state
                appState.setSession(sessionId: sessionId)
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }

            isLoading = false
        }
    }

    func resumeSession(sessionId: String, appState: AppState) {
        isLoading = true

        Task {
            do {
                // Call shared module to reconnect
                try await reconnectSessionAsync(sessionId: sessionId)

                // Update app state
                appState.setSession(sessionId: sessionId)
            } catch {
                errorMessage = "Session expirée ou invalide"
                showError = true
                forgetSession()
            }

            isLoading = false
        }
    }

    // MARK: - Async Wrappers for KMP

    /// Wrapper for KMP session creation
    /// When integrated with KMP, this will call sessionRepository.createSession()
    private func createSessionAsync() async throws -> String {
        // TODO: Integrate with KMP shared module
        // For now, simulate API call
        try await Task.sleep(nanoseconds: 1_000_000_000)

        // This would be replaced with actual KMP call:
        // let request = SessionCreateRequest(
        //     repoUrl: repoUrl,
        //     provider: selectedProvider.name.lowercased(),
        //     sshKey: authMethod == .ssh ? sshKey : nil,
        //     httpUser: authMethod == .http ? httpUser : nil,
        //     httpPassword: authMethod == .http ? httpPassword : nil
        // )
        // let result = try await sessionRepository?.createSession(request: request)
        // return result.sessionId

        return "mock-session-\(UUID().uuidString.prefix(8))"
    }

    /// Wrapper for KMP session reconnection
    private func reconnectSessionAsync(sessionId: String) async throws {
        // TODO: Integrate with KMP shared module
        try await Task.sleep(nanoseconds: 500_000_000)

        // This would be replaced with actual KMP call:
        // try await sessionRepository?.reconnectSession(sessionId: sessionId)
    }
}

// MARK: - LLMProvider Extension for iOS

extension LLMProvider: CaseIterable {
    public static var allCases: [LLMProvider] = [.codex, .claude]
}
