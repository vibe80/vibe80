import SwiftUI
import Combine
import Shared

enum ComposerActionMode: String {
    case llm
    case shell
    case git
}

/// ViewModel for ChatView - manages chat state and WebSocket communication
@MainActor
class ChatViewModel: ObservableObject {
    // Messages
    @Published var messages: [ChatMessage] = []
    @Published var currentStreamingMessage: String?
    @Published var isProcessing: Bool = false

    // Input
    @Published var inputText: String = ""

    // Connection
    @Published var connectionState: ConnectionState = .disconnected

    // Provider
    @Published var activeProvider: LLMProvider = .codex

    // Diff
    @Published var repoDiff: RepoDiff?

    // Worktrees
    @Published var worktrees: [Worktree] = []
    @Published var activeWorktreeId: String = "main"

    // Worktree-specific state
    @Published var worktreeMessages: [String: [ChatMessage]] = [:]
    @Published var worktreeStreamingMessages: [String: String] = [:]
    @Published var worktreeProcessing: [String: Bool] = [:]
    @Published var providerModels: [String: [ProviderModel]] = [:]
    @Published var selectedModelByWorktree: [String: String] = [:]
    @Published var actionModeByWorktree: [String: ComposerActionMode] = [:]

    // Error handling (P2.1)
    @Published var currentError: AppError?

    // Vibe80 block submission tracking (P2.2)
    @Published var submittedFormMessageIds: Set<String> = []
    @Published var submittedYesNoMessageIds: Set<String> = []

    // File sheet state (P2.2)
    @Published var showFileSheet = false
    @Published var fileSheetPath: String = ""
    @Published var fileSheetContent: String = ""
    @Published var fileSheetLoading = false
    @Published var fileSheetError: String?
    @Published var fileSheetBinary = false
    @Published var fileSheetTruncated = false

    // Upload progress (P2.6)
    @Published var uploadingAttachments = false

    // Computed properties
    var hasUncommittedChanges: Bool {
        guard let diff = repoDiff else { return false }
        return !diff.diff.isEmpty || !diff.status.isEmpty
    }

    var sortedWorktrees: [Worktree] {
        worktrees.sorted { w1, w2 in
            if w1.id == "main" { return true }
            if w2.id == "main" { return false }
            return w1.createdAt < w2.createdAt
        }
    }

    /// Get messages for current active worktree
    var activeWorktreeMessages: [ChatMessage] {
        if activeWorktreeId == "main" {
            return messages
        }
        return worktreeMessages[activeWorktreeId] ?? []
    }

    /// Get streaming message for current active worktree
    var activeStreamingMessage: String? {
        if activeWorktreeId == "main" {
            return currentStreamingMessage
        }
        return worktreeStreamingMessages[activeWorktreeId]
    }

    /// Check if current worktree is processing
    var isActiveWorktreeProcessing: Bool {
        if activeWorktreeId == "main" {
            return isProcessing
        }
        return worktreeProcessing[activeWorktreeId] ?? false
    }

    var activeActionMode: ComposerActionMode {
        actionModeByWorktree[activeWorktreeId] ?? .llm
    }

    var activeSelectedModel: String? {
        selectedModelByWorktree[activeWorktreeId]
    }

    var activeProviderKey: String {
        let provider = worktrees.first(where: { $0.id == activeWorktreeId })?.provider ?? activeProvider
        return provider.name.lowercased()
    }

    var activeModels: [ProviderModel] {
        providerModels[activeProviderKey] ?? []
    }

    // Private
    private var sessionId: String?
    private weak var appState: AppState?

    // Flow subscriptions
    private var messagesWrapper: FlowWrapper<NSArray>?
    private var streamingMessageWrapper: FlowWrapper<NSString>?
    private var processingWrapper: FlowWrapper<KotlinBoolean>?
    private var connectionStateWrapper: FlowWrapper<ConnectionState>?
    private var sessionStateWrapper: FlowWrapper<SessionState>?
    private var repoDiffWrapper: FlowWrapper<RepoDiff>?
    private var worktreesWrapper: FlowWrapper<NSDictionary>?
    private var worktreeMessagesWrapper: FlowWrapper<NSDictionary>?
    private var worktreeStreamingWrapper: FlowWrapper<NSDictionary>?
    private var worktreeProcessingWrapper: FlowWrapper<NSDictionary>?
    private var errorWrapper: FlowWrapper<AppError>?
    private var fileCall: SuspendWrapper<AnyObject>?
    private var sessionListCall: SuspendWrapper<AnyObject>?

    private func errorMessage(_ error: Error) -> String {
        if let kotlinError = error as? KotlinThrowable {
            return kotlinError.message ?? String(describing: kotlinError)
        }
        return (error as NSError).localizedDescription
    }

    private func reportNetworkError(_ repository: SessionRepository, error: Error) {
        repository.reportError(
            error: AppError.companion.network(
                message: errorMessage(error),
                details: nil,
                canRetry: true
            )
        )
    }

    private func requireValue<T>(_ value: Any?, as type: T.Type, context: String) throws -> T {
        if let typed = value as? T {
            return typed
        }
        throw NSError(
            domain: "Vibe80",
            code: -1,
            userInfo: [NSLocalizedDescriptionKey: "Réponse invalide (\(context))"]
        )
    }

    private func toKotlinBoolean(_ value: Bool?) -> KotlinBoolean? {
        guard let value else { return nil }
        return KotlinBoolean(bool: value)
    }

    // MARK: - Initialization

    func setup(appState: AppState) {
        self.appState = appState
        subscribeToFlows()
    }

    private func subscribeToFlows() {
        guard let repository = appState?.sessionRepository else { return }

        // Subscribe to messages
        messagesWrapper = FlowWrapper(flow: repository.messages)
        messagesWrapper?.subscribe { [weak self] messages in
            let newMessages = (messages as? [ChatMessage]) ?? []
            let oldCount = self?.messages.count ?? 0
            self?.messages = newMessages

            // Notify for new assistant messages when backgrounded (P2.5)
            if newMessages.count > oldCount {
                let newOnes = newMessages.suffix(newMessages.count - oldCount)
                for msg in newOnes where msg.role == .assistant {
                    NotificationManager.shared.notifyMessage(
                        title: "Vibe80",
                        body: msg.text,
                        sessionId: self?.sessionId,
                        worktreeId: self?.activeWorktreeId
                    )
                }
            }
        }

        // Subscribe to streaming message
        streamingMessageWrapper = FlowWrapper(flow: repository.currentStreamingMessage)
        streamingMessageWrapper?.subscribe { [weak self] message in
            self?.currentStreamingMessage = message as String?
        }

        // Subscribe to processing state
        processingWrapper = FlowWrapper(flow: repository.processing)
        processingWrapper?.subscribe { [weak self] processing in
            self?.isProcessing = processing?.boolValue ?? false
        }

        // Subscribe to connection state
        connectionStateWrapper = FlowWrapper(flow: repository.connectionState)
        connectionStateWrapper?.subscribe { [weak self] state in
            self?.connectionState = state ?? .disconnected
        }

        // Subscribe to session state for provider
        sessionStateWrapper = FlowWrapper(flow: repository.sessionState)
        sessionStateWrapper?.subscribe { [weak self] state in
            if let activeProvider = state?.activeProvider {
                self?.activeProvider = activeProvider
            }
        }

        // Subscribe to repo diff
        repoDiffWrapper = FlowWrapper(flow: repository.repoDiff)
        repoDiffWrapper?.subscribe { [weak self] diff in
            self?.repoDiff = diff
        }

        // Subscribe to worktrees
        worktreesWrapper = FlowWrapper(flow: repository.worktrees)
        worktreesWrapper?.subscribe { [weak self] worktreesDict in
            if let dict = worktreesDict as? [String: Worktree] {
                self?.worktrees = Array(dict.values)
            }
        }

        // Subscribe to worktree messages
        worktreeMessagesWrapper = FlowWrapper(flow: repository.worktreeMessages)
        worktreeMessagesWrapper?.subscribe { [weak self] messagesDict in
            if let dict = messagesDict as? [String: [ChatMessage]] {
                self?.worktreeMessages = dict
            }
        }

        // Subscribe to worktree streaming
        worktreeStreamingWrapper = FlowWrapper(flow: repository.worktreeStreamingMessages)
        worktreeStreamingWrapper?.subscribe { [weak self] streamingDict in
            if let dict = streamingDict as? [String: String] {
                self?.worktreeStreamingMessages = dict
            }
        }

        // Subscribe to worktree processing
        worktreeProcessingWrapper = FlowWrapper(flow: repository.worktreeProcessing)
        worktreeProcessingWrapper?.subscribe { [weak self] processingDict in
            if let dict = processingDict as? [String: Bool] {
                self?.worktreeProcessing = dict
            }
        }

        // Subscribe to errors (P2.1)
        errorWrapper = FlowWrapper(flow: repository.lastError)
        errorWrapper?.subscribe { [weak self] error in
            // Skip TURN_ERROR — logged but not shown to user (matching Android)
            if let error, error.type == .turnError {
                return
            }
            self?.currentError = error
        }
    }

    // MARK: - Error Handling (P2.1)

    func dismissError() {
        currentError = nil
        appState?.sessionRepository?.clearError()
    }

    // MARK: - Vibe80 Block Tracking (P2.2)

    func markFormSubmitted(_ messageId: String) {
        submittedFormMessageIds.insert(messageId)
    }

    func markYesNoSubmitted(_ messageId: String) {
        submittedYesNoMessageIds.insert(messageId)
    }

    func openFileRef(_ path: String) {
        guard let repository = appState?.sessionRepository,
              let sessionId else { return }

        fileSheetPath = path
        fileSheetContent = ""
        fileSheetError = nil
        fileSheetBinary = false
        fileSheetTruncated = false
        fileSheetLoading = true
        showFileSheet = true

        let worktreeId = activeWorktreeId
        Task { [weak self] in
            do {
                guard let self = self else { return }
                let fileResponseAny = try await repository.getWorktreeFile(
                    sessionId: sessionId,
                    worktreeId: worktreeId,
                    path: path
                )
                let fileResponse = try self.requireValue(
                    fileResponseAny,
                    as: WorktreeFileResponse.self,
                    context: "getWorktreeFile"
                )
                self.fileSheetContent = fileResponse.content
                self.fileSheetBinary = fileResponse.binary
                self.fileSheetTruncated = fileResponse.truncated
                self.fileSheetLoading = false
            } catch {
                self?.fileSheetError = self?.errorMessage(error)
                self?.fileSheetLoading = false
            }
        }
    }

    // MARK: - Connection

    func connect(sessionId: String) {
        self.sessionId = sessionId
        // Reset submission tracking for new sessions
        submittedFormMessageIds.removeAll()
        submittedYesNoMessageIds.removeAll()
        loadDiff()
    }

    func disconnect() {
        appState?.sessionRepository?.disconnect()
        closeAllSubscriptions()
    }

    private func closeAllSubscriptions() {
        messagesWrapper?.close()
        streamingMessageWrapper?.close()
        processingWrapper?.close()
        connectionStateWrapper?.close()
        sessionStateWrapper?.close()
        repoDiffWrapper?.close()
        worktreesWrapper?.close()
        worktreeMessagesWrapper?.close()
        worktreeStreamingWrapper?.close()
        worktreeProcessingWrapper?.close()
        errorWrapper?.close()
    }

    // MARK: - Messages

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let repository = appState?.sessionRepository else { return }

        if activeActionMode != .llm {
            guard !text.isEmpty else { return }
            let worktreeId = activeWorktreeId
            inputText = ""
            actionModeByWorktree[worktreeId] = .llm
            let request = activeActionMode == .git ? "git" : "run"
            Task {
                do {
                    try await repository.sendActionRequest(
                        worktreeId: worktreeId,
                        request: request,
                        arg: text
                    )
                } catch {
                    repository.reportError(
                        error: AppError.companion.sendMessage(
                            message: errorMessage(error),
                            details: nil,
                            canRetry: true
                        )
                    )
                }
            }
            return
        }

        guard !text.isEmpty else { return }

        inputText = ""

        Task {
            do {
                if activeWorktreeId == "main" {
                    try await repository.sendMessage(text: text, attachments: [])
                } else {
                    try await repository.sendWorktreeMessage(
                        worktreeId: activeWorktreeId,
                        text: text,
                        attachments: []
                    )
                }
            } catch {
                repository.reportError(
                    error: AppError.companion.sendMessage(
                        message: errorMessage(error),
                        details: nil,
                        canRetry: true
                    )
                )
            }
        }
    }

    func sendMessageWithAttachments(_ attachments: [Attachment]) {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let repository = appState?.sessionRepository else { return }

        inputText = ""
        uploadingAttachments = true

        let currentWorktreeId = activeWorktreeId
        Task { [weak self] in
            do {
                if currentWorktreeId == "main" {
                    try await repository.sendMessage(text: text, attachments: attachments)
                } else {
                    try await repository.sendWorktreeMessage(
                        worktreeId: currentWorktreeId,
                        text: text,
                        attachments: attachments
                    )
                }
                self?.uploadingAttachments = false
            } catch {
                self?.uploadingAttachments = false
                repository.reportError(
                    error: AppError.companion.upload(
                        message: self?.errorMessage(error) ?? String(describing: error),
                        details: nil,
                        canRetry: true
                    )
                )
            }
        }
    }

    // MARK: - Provider

    func switchProvider(_ provider: LLMProvider) {
        guard let repository = appState?.sessionRepository else { return }

        Task {
            do {
                try await repository.switchProvider(provider: provider)
            } catch {
                reportNetworkError(repository, error: error)
            }
        }
    }

    func setActionMode(_ mode: ComposerActionMode) {
        actionModeByWorktree[activeWorktreeId] = mode
    }

    func loadModelsForActiveWorktree() {
        guard let repository = appState?.sessionRepository else { return }
        let provider = activeProviderKey
        Task {
            do {
                let listAny = try await repository.loadProviderModels(provider: provider)
                let list = try requireValue(
                    listAny,
                    as: [ProviderModel].self,
                    context: "loadProviderModels"
                )
                self.providerModels[provider] = list
                if self.selectedModelByWorktree[self.activeWorktreeId] == nil {
                    let fallback = list.first(where: { $0.isDefault })?.model ?? list.first?.model
                    if let fallback {
                        self.selectedModelByWorktree[self.activeWorktreeId] = fallback
                    }
                }
            } catch {
                reportNetworkError(repository, error: error)
            }
        }
    }

    func setActiveModel(_ model: String) {
        guard let repository = appState?.sessionRepository else { return }
        selectedModelByWorktree[activeWorktreeId] = model
        Task {
            do {
                try await repository.setModel(
                    worktreeId: activeWorktreeId,
                    model: model,
                    reasoningEffort: nil
                )
            } catch {
                reportNetworkError(repository, error: error)
            }
        }
    }

    // MARK: - Diff

    func loadDiff() {
        guard let repository = appState?.sessionRepository else { return }

        Task {
            do {
                try await repository.loadDiff()
            } catch {
                // Diff loading errors are non-critical, don't report
            }
        }
    }

    // MARK: - Worktrees

    func selectWorktree(_ worktreeId: String) {
        activeWorktreeId = worktreeId
        appState?.sessionRepository?.setActiveWorktree(worktreeId: worktreeId)
        loadModelsForActiveWorktree()
    }

    func createWorktree(
        name: String?,
        provider: LLMProvider,
        branchName: String?,
        model: String?,
        reasoningEffort: String?,
        context: String?,
        sourceWorktree: String?,
        internetAccess: Bool?,
        denyGitCredentialsAccess: Bool?
    ) {
        guard let repository = appState?.sessionRepository else { return }

        Task {
            do {
                try await repository.createWorktree(
                    name: name,
                    provider: provider,
                    branchName: branchName,
                    model: model,
                    reasoningEffort: reasoningEffort,
                    context: context,
                    sourceWorktree: sourceWorktree,
                    internetAccess: toKotlinBoolean(internetAccess),
                    denyGitCredentialsAccess: toKotlinBoolean(denyGitCredentialsAccess)
                )
            } catch {
                repository.reportError(
                    error: AppError.companion.network(
                        message: errorMessage(error),
                        details: nil,
                        canRetry: true
                    )
                )
            }
        }
    }

    func closeWorktree(_ worktreeId: String) {
        guard worktreeId != "main" else { return }
        guard let repository = appState?.sessionRepository else { return }

        if activeWorktreeId == worktreeId {
            activeWorktreeId = "main"
        }

        Task {
            do {
                try await repository.closeWorktree(worktreeId: worktreeId)
            } catch {
                repository.reportError(
                    error: AppError.companion.network(
                        message: errorMessage(error),
                        details: nil,
                        canRetry: true
                    )
                )
            }
        }
    }

    // MARK: - Cleanup

    deinit {
        // Subscriptions will be closed when wrappers are deallocated
    }
}

// MARK: - Mock Models for Preview

extension ChatMessage {
    static var mockUser: ChatMessage {
        ChatMessage(
            id: "1",
            role: .user,
            text: "Bonjour, peux-tu m'aider ?",
            attachments: [],
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            command: nil,
            output: nil,
            status: nil,
            toolResult: nil
        )
    }

    static var mockAssistant: ChatMessage {
        ChatMessage(
            id: "2",
            role: .assistant,
            text: "Bien sûr ! Comment puis-je vous aider aujourd'hui ?",
            attachments: [],
            timestamp: Int64(Date().timeIntervalSince1970 * 1000),
            command: nil,
            output: nil,
            status: nil,
            toolResult: nil
        )
    }
}
