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
    @Published var appServerReady: Bool = false

    // Provider
    @Published var activeProvider: LLMProvider = .codex
    @Published var repoName: String = ""

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
    @Published var pendingAttachments: [PendingAttachment] = []
    @Published var showLogsSheet: Bool = false
    @Published var logs: [LogEntry] = []

    // Computed properties
    var hasUncommittedChanges: Bool {
        guard let diff = repoDiff else { return false }
        return !diff.diff.isEmpty || !diff.status.isEmpty
    }

    var sortedWorktrees: [Worktree] {
        var items = worktrees

        // Server worktrees map may not include main.
        // Keep main visible as first tab whenever worktrees are displayed.
        if !items.isEmpty, !items.contains(where: { $0.id == "main" }) {
            items.insert(
                Worktree(
                    id: "main",
                    name: "main",
                    branchName: "main",
                    provider: activeProvider,
                    status: .ready,
                    color: "#4CAF50",
                    parentId: nil,
                    createdAt: 0
                ),
                at: 0
            )
        }

        return items.sorted { w1, w2 in
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

    var effectiveProvider: LLMProvider {
        worktrees.first(where: { $0.id == activeWorktreeId })?.provider ?? activeProvider
    }

    var canInteractWithComposer: Bool {
        guard connectionState == .connected else { return false }
        if effectiveProvider != .codex {
            return true
        }
        if activeWorktreeId == "main" {
            return appServerReady
        }
        let status = worktrees.first(where: { $0.id == activeWorktreeId })?.status
        return status == .ready
    }

    var activeModels: [ProviderModel] {
        providerModels[activeProviderKey] ?? []
    }

    // Private
    private var sessionId: String?
    private weak var appState: AppState?
    private var attachmentUploader: AttachmentUploader?
    private var didSetup = false

    // Flow subscriptions
    private var messagesWrapper: FlowWrapper<NSArray>?
    private var streamingMessageWrapper: FlowWrapper<NSString>?
    private var processingWrapper: FlowWrapper<KotlinBoolean>?
    private var connectionStateWrapper: FlowWrapper<ConnectionState>?
    private var sessionStateWrapper: FlowWrapper<SessionState>?
    private var activeWorktreeIdWrapper: FlowWrapper<NSString>?
    private var repoDiffWrapper: FlowWrapper<RepoDiff>?
    private var worktreesWrapper: FlowWrapper<NSDictionary>?
    private var worktreeMessagesWrapper: FlowWrapper<NSDictionary>?
    private var worktreeStreamingWrapper: FlowWrapper<NSDictionary>?
    private var worktreeProcessingWrapper: FlowWrapper<NSDictionary>?
    private var errorWrapper: FlowWrapper<AppError>?
    private var logsWrapper: FlowWrapper<NSArray>?
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

    private func toKotlinBoolean(_ value: Bool?) -> KotlinBoolean? {
        guard let value else { return nil }
        return KotlinBoolean(bool: value)
    }

    private func repoNameFromUrl(_ url: String) -> String {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.isEmpty else { return "" }
        let slashIndex = trimmed.lastIndex(of: "/")
        let colonIndex = trimmed.lastIndex(of: ":")
        if let index = [slashIndex, colonIndex].compactMap({ $0 }).max() {
            let next = trimmed.index(after: index)
            guard next < trimmed.endIndex else { return trimmed }
            let candidate = String(trimmed[next...])
            return candidate.isEmpty ? trimmed : candidate
        }
        return trimmed
    }

    // MARK: - Initialization

    func setup(appState: AppState) {
        if didSetup {
            return
        }
        self.appState = appState
        if let baseUrl = appState.dependencies?.apiClient.getBaseUrl() {
            attachmentUploader = AttachmentUploader(baseUrl: baseUrl)
        }
        subscribeToFlows()
        didSetup = true
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
            if let ready = state?.appServerReady {
                self?.appServerReady = ready
            }
            if let repoUrl = state?.repoUrl {
                self?.repoName = self?.repoNameFromUrl(repoUrl) ?? ""
            }
        }

        // Subscribe to active worktree id from repository (Android parity)
        activeWorktreeIdWrapper = FlowWrapper(flow: repository.activeWorktreeId)
        activeWorktreeIdWrapper?.subscribe { [weak self] worktreeId in
            guard let self = self else { return }
            guard let id = worktreeId as String? else { return }
            if self.activeWorktreeId != id {
                self.activeWorktreeId = id
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

        logsWrapper = FlowWrapper(flow: AppLogger.shared.logs)
        logsWrapper?.subscribe { [weak self] entries in
            self?.logs = (entries as? [LogEntry]) ?? []
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
                let fileResponse = try await repository.getWorktreeFileOrThrow(
                    sessionId: sessionId,
                    worktreeId: worktreeId,
                    path: path
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
        if let repository = appState?.sessionRepository {
            Task {
                do {
                    try await repository.listWorktrees()
                } catch {
                    // Non-critical on chat entry.
                }
            }
        }
    }

    func disconnect() {
        appState?.sessionRepository?.disconnect()
        closeAllSubscriptions()
    }

    func showLogs() {
        showLogsSheet = true
    }

    func hideLogs() {
        showLogsSheet = false
    }

    func clearLogs() {
        AppLogger.shared.clear()
    }

    private func closeAllSubscriptions() {
        messagesWrapper?.close()
        streamingMessageWrapper?.close()
        processingWrapper?.close()
        connectionStateWrapper?.close()
        sessionStateWrapper?.close()
        activeWorktreeIdWrapper?.close()
        repoDiffWrapper?.close()
        worktreesWrapper?.close()
        worktreeMessagesWrapper?.close()
        worktreeStreamingWrapper?.close()
        worktreeProcessingWrapper?.close()
        errorWrapper?.close()
        logsWrapper?.close()
    }

    // MARK: - Messages

    func addPendingAttachment(_ attachment: PendingAttachment) {
        pendingAttachments.append(attachment)
    }

    func removePendingAttachment(_ attachment: PendingAttachment) {
        pendingAttachments.removeAll { $0.id == attachment.id }
    }

    private func clearPendingAttachments() {
        pendingAttachments.removeAll()
    }

    func sendMessage() {
        let trimmedText = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let repository = appState?.sessionRepository else { return }
        guard !trimmedText.isEmpty || !pendingAttachments.isEmpty else { return }
        guard canInteractWithComposer else { return }

        inputText = ""

        if activeActionMode != .llm {
            guard !trimmedText.isEmpty else { return }
            let worktreeId = activeWorktreeId
            actionModeByWorktree[worktreeId] = .llm
            let request = activeActionMode == .git ? "git" : "run"
            Task {
                do {
                    try await repository.sendActionRequest(
                        worktreeId: worktreeId,
                        request: request,
                        arg: trimmedText
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

        if !pendingAttachments.isEmpty {
            sendMessageWithAttachments(text: trimmedText, repository: repository)
            return
        }

        Task {
            do {
                if activeWorktreeId == "main" {
                    try await repository.sendMessage(text: trimmedText, attachments: [])
                } else {
                    try await repository.sendWorktreeMessage(
                        worktreeId: activeWorktreeId,
                        text: trimmedText,
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

    private func sendMessageWithAttachments(text: String, repository: SessionRepository) {
        guard !pendingAttachments.isEmpty else { return }
        guard canInteractWithComposer else { return }
        guard let sessionId else {
            repository.reportError(
                error: AppError.companion.upload(
                    message: "Session non disponible",
                    details: nil,
                    canRetry: true
                )
            )
            return
        }
        guard let uploader = attachmentUploader else {
            repository.reportError(
                error: AppError.companion.upload(
                    message: "Impossible d'uploader les pièces jointes pour le moment.",
                    details: nil,
                    canRetry: true
                )
            )
            return
        }

        let attachmentsToUpload = pendingAttachments
        clearPendingAttachments()
        uploadingAttachments = true

        Task { [weak self] in
            guard let self = self else { return }
            do {
                let uploadedAttachments = try await uploader.uploadAttachments(
                    sessionId: sessionId,
                    attachments: attachmentsToUpload
                )
                let suffix = self.buildAttachmentsSuffix(paths: uploadedAttachments.map { $0.path })
                let textWithSuffix = text + suffix
                if self.activeWorktreeId == "main" {
                    try await repository.sendMessage(text: textWithSuffix, attachments: uploadedAttachments)
                } else {
                    try await repository.sendWorktreeMessage(
                        worktreeId: self.activeWorktreeId,
                        text: textWithSuffix,
                        attachments: uploadedAttachments
                    )
                }
                self.uploadingAttachments = false
            } catch {
                self.uploadingAttachments = false
                repository.reportError(
                    error: AppError.companion.upload(
                        message: self.errorMessage(error),
                        details: nil,
                        canRetry: true
                    )
                )
            }
        }
    }

    private func buildAttachmentsSuffix(paths: [String]) -> String {
        guard !paths.isEmpty else { return "" }
        let joined = paths.map { "\"\(escapeJson($0))\"" }.joined(separator: ", ")
        return ";; attachments: [\(joined)]"
    }

    private func escapeJson(_ value: String) -> String {
        var result = ""
        value.forEach { ch in
            switch ch {
            case "\\":
                result.append("\\\\")
            case "\"":
                result.append("\\\"")
            case "\n":
                result.append("\\n")
            case "\r":
                result.append("\\r")
            case "\t":
                result.append("\\t")
            default:
                result.append(ch)
            }
        }
        return result
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
                let list = try await repository.loadProviderModelsOrThrow(provider: provider)
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
