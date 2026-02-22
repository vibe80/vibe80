import SwiftUI
import Combine
import Shared

@MainActor
class SessionViewModel: ObservableObject {
    static let debugErrorsFlagKey = "vibe80_debug_errors"
    @Published var entryScreen: EntryScreen = .workspaceMode
    @Published var workspaceMode: WorkspaceMode = .existing
    @Published var providerConfigMode: ProviderConfigMode = .create
    @Published var workspaceIdInput: String = ""
    @Published var workspaceSecretInput: String = ""
    @Published var workspaceId: String?
    @Published var workspaceToken: String?
    @Published var workspaceRefreshToken: String?
    @Published var workspaceCreatedId: String?
    @Published var workspaceCreatedSecret: String?
    @Published var workspaceError: String?
    @Published var workspaceBusy: Bool = false
    @Published var workspaceProviders: [String: ProviderAuthState] = [
        "codex": ProviderAuthState(authType: .apiKey),
        "claude": ProviderAuthState(authType: .setupToken)
    ]

    @Published var repoUrl: String = ""
    @Published var authMethod: AuthMethod = .none
    @Published var sshKey: String = ""
    @Published var httpUser: String = ""
    @Published var httpPassword: String = ""
    @Published var isLoading: Bool = false
    @Published var loadingState: LoadingState = .none
    @Published var resumingSessionId: String?
    @Published var sessionError: String?
    @Published var handoffBusy: Bool = false
    @Published var handoffError: String?

    @Published var hasSavedSession: Bool = false
    @Published var savedSessionId: String?
    @Published var savedSessionRepoUrl: String = ""

    // Multi-session support (P2.4)
    @Published var workspaceSessions: [SessionSummary] = []
    @Published var sessionsLoading: Bool = false
    @Published var sessionsError: String?

    private var createSessionCall: SuspendWrapper<SessionState>?
    private var reconnectSessionCall: SuspendWrapper<SessionState>?
    private var workspaceCall: SuspendWrapper<AnyObject>?
    private var handoffCall: SuspendWrapper<HandoffConsumeResponse>?
    private var sessionsCall: SuspendWrapper<AnyObject>?
    private var cancellables = Set<AnyCancellable>()

    private func errorMessage(_ error: Error) -> String {
        if let kotlinError = error as? KotlinThrowable {
            return kotlinError.message ?? String(describing: kotlinError)
        }
        return (error as NSError).localizedDescription
    }

    private func debugErrorDetails(_ context: String, _ error: Error) -> String {
        let base = errorMessage(error)
        #if DEBUG
        guard isDebugErrorsEnabled else { return base }
        let typeInfo = String(describing: type(of: error))
        if let kotlinError = error as? KotlinThrowable {
            let cause = kotlinError.cause?.message ?? "nil"
            let details = "[\(context)] type=\(typeInfo), message=\(kotlinError.message ?? "nil"), cause=\(cause)"
            print("❌ \(details)")
            return "\(base) [\(typeInfo)]"
        }
        let details = "[\(context)] type=\(typeInfo), message=\(base)"
        print("❌ \(details)")
        return "\(base) [\(typeInfo)]"
        #else
        return base
        #endif
    }

    private var isDebugErrorsEnabled: Bool {
        #if DEBUG
        if let env = ProcessInfo.processInfo.environment["VIBE80_DEBUG_ERRORS"]?.lowercased() {
            return env == "1" || env == "true" || env == "yes"
        }
        return UserDefaults.standard.bool(forKey: Self.debugErrorsFlagKey)
        #else
        return false
        #endif
    }

    init() {
        loadSavedWorkspace()
        loadSavedSession()
        observeWorkspaceTokenUpdates()
    }

    private func observeWorkspaceTokenUpdates() {
        NotificationCenter.default.publisher(for: .workspaceTokensDidUpdate)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self = self else { return }
                if let token = notification.userInfo?["workspaceToken"] as? String {
                    self.workspaceToken = token
                }
                if let refreshToken = notification.userInfo?["workspaceRefreshToken"] as? String {
                    self.workspaceRefreshToken = refreshToken
                }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .workspaceAuthInvalid)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] notification in
                guard let self = self else { return }
                let message = notification.userInfo?["message"] as? String
                self.clearWorkspace()
                self.clearSavedSession()
                self.workspaceSessions = []
                self.sessionsLoading = false
                self.workspaceBusy = false
                self.handoffBusy = false
                self.isLoading = false
                self.loadingState = .none
                self.resumingSessionId = nil
                self.workspaceError = message
                self.sessionError = nil
                self.sessionsError = nil
                self.handoffError = nil
                self.entryScreen = .workspaceMode
            }
            .store(in: &cancellables)
    }

    // MARK: - Navigation / State

    func selectWorkspaceMode(_ mode: WorkspaceMode) {
        workspaceMode = mode
        providerConfigMode = .create
        workspaceError = nil
        entryScreen = mode == .existing ? .workspaceCredentials : .providerConfig
    }

    func toggleProvider(_ provider: String, enabled: Bool) {
        var updated = workspaceProviders
        var current = updated[provider] ?? ProviderAuthState()
        current.enabled = enabled
        updated[provider] = current
        workspaceProviders = updated
    }

    func updateProviderAuthType(_ provider: String, authType: ProviderAuthType) {
        var updated = workspaceProviders
        var current = updated[provider] ?? ProviderAuthState()
        if provider == "codex", authType == .setupToken {
            current.authType = .apiKey
        } else {
            current.authType = authType
        }
        updated[provider] = current
        workspaceProviders = updated
    }

    func updateProviderAuthValue(_ provider: String, authValue: String) {
        var updated = workspaceProviders
        var current = updated[provider] ?? ProviderAuthState()
        current.authValue = authValue
        updated[provider] = current
        workspaceProviders = updated
    }

    func openWorkspaceModeSelection() {
        entryScreen = .workspaceMode
        providerConfigMode = .create
        workspaceError = nil
    }

    func openProviderConfigForUpdate() {
        entryScreen = .providerConfig
        providerConfigMode = .update
        workspaceError = nil
    }

    func openStartSession() {
        entryScreen = .startSession
        sessionError = nil
    }

    func backToJoinSession() {
        entryScreen = .joinSession
        providerConfigMode = .create
        sessionError = nil
    }

    func continueFromWorkspaceCreated() {
        entryScreen = .joinSession
    }

    func openQrScan() {
        entryScreen = .qrScan
        handoffError = nil
    }

    func closeQrScan() {
        entryScreen = .workspaceMode
        handoffError = nil
    }

    // MARK: - Workspace persistence

    private func loadSavedWorkspace() {
        let defaults = UserDefaults.standard
        guard let workspaceId = defaults.string(forKey: "workspaceId"),
              let workspaceSecret = defaults.string(forKey: "workspaceSecret") else {
            entryScreen = .workspaceMode
            return
        }

        self.workspaceId = workspaceId
        workspaceIdInput = workspaceId
        workspaceSecretInput = workspaceSecret
        workspaceToken = defaults.string(forKey: "workspaceToken")
        workspaceRefreshToken = defaults.string(forKey: "workspaceRefreshToken")
        entryScreen = .joinSession
    }

    private func saveWorkspace(
        workspaceId: String,
        workspaceSecret: String,
        workspaceToken: String?,
        refreshToken: String?
    ) {
        let defaults = UserDefaults.standard
        defaults.set(workspaceId, forKey: "workspaceId")
        defaults.set(workspaceSecret, forKey: "workspaceSecret")
        defaults.set(workspaceToken, forKey: "workspaceToken")
        defaults.set(refreshToken, forKey: "workspaceRefreshToken")
    }

    func clearWorkspace() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "workspaceId")
        defaults.removeObject(forKey: "workspaceSecret")
        defaults.removeObject(forKey: "workspaceToken")
        defaults.removeObject(forKey: "workspaceRefreshToken")
        workspaceId = nil
        workspaceToken = nil
        workspaceRefreshToken = nil
        entryScreen = .workspaceMode
    }

    func leaveWorkspace(appState: AppState) {
        appState.sessionRepository?.setWorkspaceToken(token: nil)
        appState.sessionRepository?.setRefreshToken(token: nil)
        appState.clearSession()
        clearWorkspace()
        clearSavedSession()
        workspaceSessions = []
        sessionsError = nil
        sessionsLoading = false
        sessionError = nil
        handoffError = nil
    }

    // MARK: - Workspace actions

    func submitWorkspaceCredentials(appState: AppState) {
        let workspaceId = workspaceIdInput.trimmingCharacters(in: .whitespacesAndNewlines)
        let workspaceSecret = workspaceSecretInput.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !workspaceId.isEmpty, !workspaceSecret.isEmpty else {
            workspaceError = "Workspace ID et secret requis."
            return
        }

        loginWorkspace(
            workspaceId: workspaceId,
            workspaceSecret: workspaceSecret,
            appState: appState,
            navigateOnSuccess: true
        )
    }

    func submitProviderConfig(appState: AppState) {
        guard let repository = appState.sessionRepository else {
            workspaceError = "Module partagé non initialisé"
            return
        }

        let providers: [String: WorkspaceProviderConfig]
        do {
            providers = try buildWorkspaceProviders()
        } catch {
            workspaceError = error.localizedDescription
            return
        }

        workspaceBusy = true
        workspaceError = nil

        if providerConfigMode == .create {
            Task { [weak self] in
                do {
                    guard let self = self else { return }
                    let created = try await repository.createWorkspaceOrThrow(
                        request: WorkspaceCreateRequest(providers: providers)
                    )
                    self.workspaceCreatedId = created.workspaceId
                    self.workspaceCreatedSecret = created.workspaceSecret
                    self.workspaceIdInput = created.workspaceId
                    self.workspaceSecretInput = created.workspaceSecret
                    self.loginWorkspace(
                        workspaceId: created.workspaceId,
                        workspaceSecret: created.workspaceSecret,
                        appState: appState,
                        navigateOnSuccess: false
                    )
                    self.workspaceBusy = false
                    self.entryScreen = .workspaceCreated
                } catch {
                    self?.workspaceBusy = false
                    self?.workspaceError = self?.debugErrorDetails("createWorkspace", error)
                }
            }
        } else {
            guard let workspaceId = workspaceId else {
                workspaceError = "Workspace introuvable."
                workspaceBusy = false
                return
            }
            Task { [weak self] in
                do {
                    _ = try await repository.updateWorkspaceOrCurrent(
                        workspaceId: workspaceId,
                        request: WorkspaceUpdateRequest(providers: providers)
                    )
                    self?.workspaceBusy = false
                    self?.entryScreen = .joinSession
                } catch {
                    self?.workspaceBusy = false
                    self?.workspaceError = self?.debugErrorDetails("updateWorkspace", error)
                }
            }
        }
    }

    private func loginWorkspace(
        workspaceId: String,
        workspaceSecret: String,
        appState: AppState,
        navigateOnSuccess: Bool
    ) {
        guard let repository = appState.sessionRepository else {
            workspaceError = "Module partagé non initialisé"
            return
        }

        workspaceBusy = true
        workspaceError = nil

        Task { [weak self] in
            do {
                let loginResponse = try await repository.loginWorkspaceOrThrow(
                    request: WorkspaceLoginRequest(
                        workspaceId: workspaceId,
                        workspaceSecret: workspaceSecret
                    )
                )
                guard let self = self else { return }
                repository.setWorkspaceToken(token: loginResponse.workspaceToken)
                repository.setRefreshToken(token: loginResponse.refreshToken)
                self.saveWorkspace(
                    workspaceId: workspaceId,
                    workspaceSecret: workspaceSecret,
                    workspaceToken: loginResponse.workspaceToken,
                    refreshToken: loginResponse.refreshToken
                )
                self.workspaceId = workspaceId
                self.workspaceToken = loginResponse.workspaceToken
                self.workspaceRefreshToken = loginResponse.refreshToken
                self.workspaceBusy = false
                if navigateOnSuccess {
                    self.entryScreen = .joinSession
                }
            } catch {
                self?.workspaceBusy = false
                self?.workspaceError = self?.debugErrorDetails("loginWorkspace", error)
            }
        }
    }

    private func buildWorkspaceProviders() throws -> [String: WorkspaceProviderConfig] {
        var result: [String: WorkspaceProviderConfig] = [:]
        for (provider, state) in workspaceProviders {
            guard state.enabled else { continue }
            let trimmed = state.authValue.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else {
                throw NSError(domain: "Vibe80", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Clé requise pour \(provider)."
                ])
            }

            let authType: String
            let authValue: String
            switch state.authType {
            case .apiKey:
                authType = "api_key"
                authValue = trimmed
            case .authJsonB64:
                authType = "auth_json_b64"
                authValue = Data(trimmed.utf8).base64EncodedString()
            case .setupToken:
                authType = "setup_token"
                authValue = trimmed
            }

            result[provider] = WorkspaceProviderConfig(
                enabled: true,
                auth: WorkspaceAuth(type: authType, value: authValue)
            )
        }
        return result
    }

    // MARK: - Saved Sessions

    private func loadSavedSession() {
        let defaults = UserDefaults.standard
        savedSessionId = defaults.string(forKey: "lastSessionId")
        savedSessionRepoUrl = defaults.string(forKey: "lastRepoUrl") ?? ""
        hasSavedSession = savedSessionId != nil
        repoUrl = savedSessionRepoUrl
    }

    func clearSavedSession() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: "lastSessionId")
        defaults.removeObject(forKey: "lastRepoUrl")
        defaults.removeObject(forKey: "lastProvider")
        defaults.removeObject(forKey: "lastBaseUrl")
        savedSessionId = nil
        savedSessionRepoUrl = ""
        hasSavedSession = false
        resumingSessionId = nil
    }

    // MARK: - Session actions

    func createSession(appState: AppState) {
        guard !repoUrl.isEmpty else {
            sessionError = "L'URL du repository est requise"
            return
        }

        guard let repository = appState.sessionRepository else {
            sessionError = "Module partagé non initialisé"
            return
        }

        isLoading = true
        loadingState = .cloning
        sessionError = nil

        let sshKeyParam: String? = authMethod == .ssh ? sshKey : nil
        let httpUserParam: String? = authMethod == .http ? httpUser : nil
        let httpPasswordParam: String? = authMethod == .http ? httpPassword : nil

        Task { [weak self] in
            do {
                guard let self = self else { return }
                let state = try await repository.createSessionOrThrow(
                    repoUrl: self.repoUrl,
                    sshKey: sshKeyParam,
                    httpUser: httpUserParam,
                    httpPassword: httpPasswordParam
                )
                let defaults = UserDefaults.standard
                defaults.set(state.sessionId, forKey: "lastSessionId")
                defaults.set(self.repoUrl, forKey: "lastRepoUrl")
                defaults.set(state.activeProvider.name, forKey: "lastProvider")
                defaults.set("", forKey: "lastBaseUrl")
                self.savedSessionId = state.sessionId
                self.savedSessionRepoUrl = self.repoUrl
                self.hasSavedSession = true
                self.isLoading = false
                self.loadingState = .none
                appState.setSession(sessionId: state.sessionId)
            } catch {
                self?.sessionError = self?.debugErrorDetails("createSession", error)
                self?.isLoading = false
                self?.loadingState = .none
            }
        }
    }

    func resumeSession(appState: AppState) {
        guard !isLoading else { return }
        guard let repository = appState.sessionRepository else {
            sessionError = "Module partagé non initialisé"
            return
        }
        guard let sessionId = savedSessionId else {
            sessionError = "Aucune session sauvegardée."
            return
        }

        isLoading = true
        loadingState = .resuming
        resumingSessionId = sessionId
        sessionError = nil

        Task { [weak self] in
            do {
                let repoOverride = self?.savedSessionRepoUrl.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try await repository.reconnectSessionOrThrow(
                    sessionId: sessionId,
                    repoUrlOverride: (repoOverride?.isEmpty == false) ? repoOverride : nil
                )
                self?.isLoading = false
                self?.loadingState = .none
                self?.resumingSessionId = nil
                appState.setSession(sessionId: sessionId)
            } catch {
                self?.sessionError = self?.errorMessage(error)
                self?.isLoading = false
                self?.loadingState = .none
                self?.resumingSessionId = nil
                self?.clearSavedSession()
            }
        }
    }

    // MARK: - Multi-session (P2.4)

    func loadWorkspaceSessions(appState: AppState) {
        guard let repository = appState.sessionRepository else { return }

        sessionsLoading = true
        sessionsError = nil

        Task { [weak self] in
            do {
                let listResponse = try await repository.listSessionsOrEmpty()
                guard let self = self else { return }
                self.workspaceSessions = listResponse.sessions
                self.sessionsLoading = false
            } catch {
                self?.sessionsError = self?.errorMessage(error)
                self?.sessionsLoading = false
            }
        }
    }

    func resumeWorkspaceSession(sessionId: String, repoUrl: String?, appState: AppState) {
        guard !isLoading else { return }
        guard let repository = appState.sessionRepository else {
            sessionError = "Module partagé non initialisé"
            return
        }

        isLoading = true
        loadingState = .resuming
        resumingSessionId = sessionId
        sessionError = nil

        // Save as last session
        let defaults = UserDefaults.standard
        defaults.set(sessionId, forKey: "lastSessionId")
        defaults.set(repoUrl ?? "", forKey: "lastRepoUrl")
        savedSessionId = sessionId
        savedSessionRepoUrl = repoUrl ?? ""
        hasSavedSession = true

        Task { [weak self] in
            do {
                let repoOverride = repoUrl?.trimmingCharacters(in: .whitespacesAndNewlines)
                _ = try await repository.reconnectSessionOrThrow(
                    sessionId: sessionId,
                    repoUrlOverride: (repoOverride?.isEmpty == false) ? repoOverride : nil
                )
                self?.isLoading = false
                self?.loadingState = .none
                self?.resumingSessionId = nil
                appState.setSession(sessionId: sessionId)
            } catch {
                self?.sessionError = self?.errorMessage(error)
                self?.isLoading = false
                self?.loadingState = .none
                self?.resumingSessionId = nil
            }
        }
    }

    func consumeHandoffPayload(_ payload: String, appState: AppState) {
        guard let repository = appState.sessionRepository else {
            handoffError = "Module partagé non initialisé"
            return
        }

        guard let data = payload.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(HandoffQrPayload.self, from: data),
              !parsed.handoffToken.isEmpty else {
            handoffError = "QR code invalide."
            return
        }

        handoffBusy = true
        handoffError = nil

        Task { [weak self] in
            do {
                let response = try await repository.consumeHandoffTokenOrThrow(handoffToken: parsed.handoffToken)
                guard let self = self else { return }
                repository.setWorkspaceToken(token: response.workspaceToken)
                repository.setRefreshToken(token: response.refreshToken)
                self.saveWorkspace(
                    workspaceId: response.workspaceId,
                    workspaceSecret: "",
                    workspaceToken: response.workspaceToken,
                    refreshToken: response.refreshToken
                )
                self.workspaceId = response.workspaceId
                self.workspaceToken = response.workspaceToken
                self.workspaceRefreshToken = response.refreshToken
                self.entryScreen = .joinSession
                do {
                    _ = try await repository.reconnectSessionOrThrow(sessionId: response.sessionId)
                    self.handoffBusy = false
                    appState.setSession(sessionId: response.sessionId)
                } catch {
                    self.handoffBusy = false
                    self.handoffError = self.errorMessage(error)
                }
            } catch {
                self?.handoffBusy = false
                self?.handoffError = self?.errorMessage(error)
            }
        }
    }
}

enum EntryScreen {
    case workspaceMode
    case workspaceCredentials
    case providerConfig
    case workspaceCreated
    case joinSession
    case startSession
    case qrScan
}

enum WorkspaceMode {
    case existing
    case new
}

enum ProviderConfigMode {
    case create
    case update
}

enum ProviderAuthType {
    case apiKey
    case authJsonB64
    case setupToken
}

struct ProviderAuthState {
    var enabled: Bool = false
    var authType: ProviderAuthType = .apiKey
    var authValue: String = ""
}

enum LoadingState {
    case none
    case cloning
    case resuming
}

private struct HandoffQrPayload: Codable {
    let handoffToken: String
    let baseUrl: String?
    let expiresAt: Double?
    let type: String?
}

enum AuthMethod: String, CaseIterable {
    case none
    case ssh
    case http
}
