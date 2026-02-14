import SwiftUI
import Combine
import shared

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
    private var streamingMessageWrapper: FlowWrapper<NSString?>?
    private var processingWrapper: FlowWrapper<KotlinBoolean>?
    private var connectionStateWrapper: FlowWrapper<ConnectionState>?
    private var sessionStateWrapper: FlowWrapper<SessionState?>?
    private var repoDiffWrapper: FlowWrapper<RepoDiff?>?
    private var worktreesWrapper: FlowWrapper<NSDictionary>?
    private var worktreeMessagesWrapper: FlowWrapper<NSDictionary>?
    private var worktreeStreamingWrapper: FlowWrapper<NSDictionary>?
    private var worktreeProcessingWrapper: FlowWrapper<NSDictionary>?

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
            self?.messages = (messages as? [ChatMessage]) ?? []
        }

        // Subscribe to streaming message
        streamingMessageWrapper = FlowWrapper(flow: repository.currentStreamingMessage)
        streamingMessageWrapper?.subscribe { [weak self] message in
            self?.currentStreamingMessage = message as String?
        }

        // Subscribe to processing state
        processingWrapper = FlowWrapper(flow: repository.processing)
        processingWrapper?.subscribe { [weak self] processing in
            self?.isProcessing = processing.boolValue
        }

        // Subscribe to connection state
        connectionStateWrapper = FlowWrapper(flow: repository.connectionState)
        connectionStateWrapper?.subscribe { [weak self] state in
            self?.connectionState = state
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
    }

    // MARK: - Connection

    func connect(sessionId: String) {
        self.sessionId = sessionId
        // WebSocket connection is handled by SessionRepository.createSession/reconnectSession
        // Just load initial data
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
            Coroutines.shared.launch(
                block: { [worktreeId] in
                    try await repository.sendActionRequest(
                        worktreeId: worktreeId,
                        request: request,
                        arg: text
                    )
                },
                onError: { error in
                    print("Error sending action request: \(error)")
                }
            )
            return
        }

        guard !text.isEmpty else { return }

        inputText = ""

        // Send via repository (which handles local message addition and WebSocket)
        Coroutines.shared.launch(
            block: { [activeWorktreeId] in
                if activeWorktreeId == "main" {
                    try await repository.sendMessage(text: text, attachments: [])
                } else {
                    try await repository.sendWorktreeMessage(
                        worktreeId: activeWorktreeId,
                        text: text,
                        attachments: []
                    )
                }
            },
            onError: { error in
                print("Error sending message: \(error)")
            }
        )
    }

    func sendMessageWithAttachments(_ attachments: [Attachment]) {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let repository = appState?.sessionRepository else { return }

        inputText = ""

        Coroutines.shared.launch(
            block: { [activeWorktreeId] in
                if activeWorktreeId == "main" {
                    try await repository.sendMessage(text: text, attachments: attachments)
                } else {
                    try await repository.sendWorktreeMessage(
                        worktreeId: activeWorktreeId,
                        text: text,
                        attachments: attachments
                    )
                }
            },
            onError: { error in
                print("Error sending message with attachments: \(error)")
            }
        )
    }

    // MARK: - Provider

    func switchProvider(_ provider: LLMProvider) {
        guard let repository = appState?.sessionRepository else { return }

        Coroutines.shared.launch(
            block: {
                try await repository.switchProvider(provider: provider)
            },
            onError: { error in
                print("Error switching provider: \(error)")
            }
        )
    }

    func setActionMode(_ mode: ComposerActionMode) {
        actionModeByWorktree[activeWorktreeId] = mode
    }

    func loadModelsForActiveWorktree() {
        guard let repository = appState?.sessionRepository else { return }
        let provider = activeProviderKey
        Coroutines.shared.launch(
            block: {
                let list = try await repository.loadProviderModels(provider: provider)
                await MainActor.run {
                    self.providerModels[provider] = list
                    if self.selectedModelByWorktree[self.activeWorktreeId] == nil {
                        let fallback = list.first(where: { $0.isDefault })?.model ?? list.first?.model
                        if let fallback {
                            self.selectedModelByWorktree[self.activeWorktreeId] = fallback
                        }
                    }
                }
            },
            onError: { error in
                print("Error loading provider models: \(error)")
            }
        )
    }

    func setActiveModel(_ model: String) {
        guard let repository = appState?.sessionRepository else { return }
        selectedModelByWorktree[activeWorktreeId] = model
        Coroutines.shared.launch(
            block: { [activeWorktreeId] in
                try await repository.setModel(
                    worktreeId: activeWorktreeId,
                    model: model,
                    reasoningEffort: nil
                )
            },
            onError: { error in
                print("Error setting model: \(error)")
            }
        )
    }

    // MARK: - Diff

    func loadDiff() {
        guard let repository = appState?.sessionRepository else { return }

        Coroutines.shared.launch(
            block: {
                try await repository.loadDiff()
            },
            onError: { error in
                print("Error loading diff: \(error)")
            }
        )
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

        Coroutines.shared.launch(
            block: {
                try await repository.createWorktree(
                    name: name,
                    provider: provider,
                    branchName: branchName,
                    model: model,
                    reasoningEffort: reasoningEffort,
                    context: context,
                    sourceWorktree: sourceWorktree,
                    internetAccess: internetAccess,
                    denyGitCredentialsAccess: denyGitCredentialsAccess
                )
            },
            onError: { error in
                print("Error creating worktree: \(error)")
            }
        )
    }

    func closeWorktree(_ worktreeId: String) {
        guard worktreeId != "main" else { return }
        guard let repository = appState?.sessionRepository else { return }

        // Switch to main if closing active worktree
        if activeWorktreeId == worktreeId {
            activeWorktreeId = "main"
        }

        Coroutines.shared.launch(
            block: {
                try await repository.closeWorktree(worktreeId: worktreeId)
            },
            onError: { error in
                print("Error closing worktree: \(error)")
            }
        )
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
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
    }

    static var mockAssistant: ChatMessage {
        ChatMessage(
            id: "2",
            role: .assistant,
            text: "Bien sûr ! Comment puis-je vous aider aujourd'hui ?",
            attachments: [],
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
    }
}
