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

    // Async operation handles
    private var createSessionCall: SuspendWrapper<SessionState>?
    private var reconnectSessionCall: SuspendWrapper<SessionState>?

    init() {
        loadPreviousSession()
    }

    // MARK: - Previous Session

    private func loadPreviousSession() {
        previousSessionId = UserDefaults.standard.string(forKey: "lastSessionId")
    }

    func forgetSession() {
        UserDefaults.standard.removeObject(forKey: "lastSessionId")
        previousSessionId = nil
    }

    // MARK: - Session Creation

    func createSession(appState: AppState) {
        guard !repoUrl.isEmpty else {
            errorMessage = "L'URL du repository est requise"
            showError = true
            return
        }

        guard let repository = appState.sessionRepository else {
            errorMessage = "Module partagé non initialisé"
            showError = true
            return
        }

        isLoading = true

        // Build auth parameters
        let sshKeyParam: String? = authMethod == .ssh ? sshKey : nil
        let httpUserParam: String? = authMethod == .http ? httpUser : nil
        let httpPasswordParam: String? = authMethod == .http ? httpPassword : nil

        // Cancel any previous call
        createSessionCall?.cancel()
        createSessionCall = SuspendWrapper<SessionState>()

        createSessionCall?.execute(
            suspendBlock: { [repoUrl, sshKeyParam, httpUserParam, httpPasswordParam] in
                try await repository.createSession(
                    repoUrl: repoUrl,
                    sshKey: sshKeyParam,
                    httpUser: httpUserParam,
                    httpPassword: httpPasswordParam
                )
            },
            onSuccess: { [weak self] state in
                guard let self = self else { return }

                // Save session ID
                UserDefaults.standard.set(state.sessionId, forKey: "lastSessionId")

                // Update app state
                appState.setSession(sessionId: state.sessionId)

                self.isLoading = false
            },
            onError: { [weak self] error in
                guard let self = self else { return }

                var friendlyMessage: String? = nil
                if let sessionError = error as? SessionCreationException {
                    if let statusCode = sessionError.statusCode?.intValue,
                       statusCode == 403,
                       let message = sessionError.errorMessage,
                       !message.isEmpty {
                        friendlyMessage = message
                    }
                }

                self.errorMessage = friendlyMessage ?? error.localizedDescription
                self.showError = true
                self.isLoading = false
            }
        )
    }

    func resumeSession(sessionId: String, appState: AppState) {
        guard let repository = appState.sessionRepository else {
            errorMessage = "Module partagé non initialisé"
            showError = true
            return
        }

        isLoading = true

        // Cancel any previous call
        reconnectSessionCall?.cancel()
        reconnectSessionCall = SuspendWrapper<SessionState>()

        reconnectSessionCall?.execute(
            suspendBlock: {
                try await repository.reconnectSession(sessionId: sessionId)
            },
            onSuccess: { [weak self] _ in
                guard let self = self else { return }

                // Update app state
                appState.setSession(sessionId: sessionId)

                self.isLoading = false
            },
            onError: { [weak self] error in
                guard let self = self else { return }

                self.errorMessage = "Session expirée ou invalide: \(error.localizedDescription)"
                self.showError = true
                self.forgetSession()
                self.isLoading = false
            }
        )
    }

    // MARK: - Cleanup

    func cancelOperations() {
        createSessionCall?.cancel()
        reconnectSessionCall?.cancel()
    }

    deinit {
        // Note: deinit won't be called on MainActor, so we need to handle cleanup differently
        // The SuspendWrapper will be deallocated and its scope cancelled automatically
    }
}

// MARK: - LLMProvider Extension for iOS

extension LLMProvider: CaseIterable {
    public static var allCases: [LLMProvider] = [.codex, .claude]
}
