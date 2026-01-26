import SwiftUI
import Combine
import shared

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

    // Branches
    @Published var branches: [String] = []
    @Published var currentBranch: String?

    // Diff
    @Published var repoDiff: RepoDiff?

    // Worktrees
    @Published var worktrees: [Worktree] = []
    @Published var activeWorktreeId: String = "main"

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

    // Private
    private var sessionId: String?
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Connection

    func connect(sessionId: String) {
        self.sessionId = sessionId
        connectionState = .connecting

        // TODO: Integrate with KMP WebSocketManager
        // webSocketManager.connect(sessionId: sessionId)

        // Simulate connection for now
        Task {
            try? await Task.sleep(nanoseconds: 500_000_000)
            connectionState = .connected

            // Load initial data
            await loadBranches()
            await loadDiff()
        }
    }

    func disconnect() {
        connectionState = .disconnected
        // TODO: webSocketManager.disconnect()
    }

    // MARK: - Messages

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        inputText = ""
        isProcessing = true

        // Add user message locally
        let userMessage = ChatMessage(
            id: "msg_\(Date().timeIntervalSince1970)",
            role: .user,
            text: text,
            attachments: [],
            timestamp: Int64(Date().timeIntervalSince1970 * 1000)
        )
        messages.append(userMessage)

        // TODO: Send via WebSocket
        // if activeWorktreeId == "main" {
        //     webSocketManager.sendMessage(text: text)
        // } else {
        //     webSocketManager.sendWorktreeMessage(worktreeId: activeWorktreeId, text: text)
        // }

        // Simulate response
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)

            currentStreamingMessage = "Je réfléchis à votre question..."

            try? await Task.sleep(nanoseconds: 1_500_000_000)

            let response = ChatMessage(
                id: "msg_\(Date().timeIntervalSince1970)",
                role: .assistant,
                text: "Ceci est une réponse de démonstration. L'intégration KMP permettra d'avoir de vraies réponses.",
                attachments: [],
                timestamp: Int64(Date().timeIntervalSince1970 * 1000)
            )
            messages.append(response)
            currentStreamingMessage = nil
            isProcessing = false
        }
    }

    // MARK: - Provider

    func switchProvider(_ provider: LLMProvider) {
        activeProvider = provider
        // TODO: webSocketManager.switchProvider(provider: provider.name.lowercased())
    }

    // MARK: - Branches

    func loadBranches() async {
        // TODO: Call API via shared module
        branches = ["main", "develop", "feature/auth", "feature/ui"]
        currentBranch = "main"
    }

    func fetchBranches() {
        Task {
            // TODO: apiClient.fetchBranches(sessionId: sessionId)
            await loadBranches()
        }
    }

    func switchBranch(_ branch: String) {
        currentBranch = branch
        // TODO: apiClient.switchBranch(sessionId: sessionId, branch: branch)
    }

    // MARK: - Diff

    func loadDiff() async {
        // TODO: Call API via shared module
        repoDiff = RepoDiff(
            status: "",
            diff: ""
        )
    }

    // MARK: - Worktrees

    func selectWorktree(_ worktreeId: String) {
        activeWorktreeId = worktreeId
        // TODO: Load messages for this worktree
    }

    func createWorktree(name: String, provider: LLMProvider, branchName: String?) {
        // TODO: webSocketManager.createWorktree(...)
        let newWorktree = Worktree(
            id: "wt_\(UUID().uuidString.prefix(8))",
            name: name,
            branchName: branchName ?? currentBranch ?? "main",
            provider: provider,
            status: .creating,
            color: Worktree.companion.COLORS.randomElement() ?? "#4CAF50",
            parentId: activeWorktreeId,
            createdAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
        worktrees.append(newWorktree)

        // Simulate creation complete
        Task {
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if let index = worktrees.firstIndex(where: { $0.id == newWorktree.id }) {
                worktrees[index] = Worktree(
                    id: newWorktree.id,
                    name: newWorktree.name,
                    branchName: newWorktree.branchName,
                    provider: newWorktree.provider,
                    status: .ready,
                    color: newWorktree.color,
                    parentId: newWorktree.parentId,
                    createdAt: newWorktree.createdAt
                )
            }
        }
    }

    func mergeWorktree(_ worktreeId: String) {
        // TODO: webSocketManager.mergeWorktree(worktreeId: worktreeId)
    }

    func closeWorktree(_ worktreeId: String) {
        guard worktreeId != "main" else { return }
        worktrees.removeAll { $0.id == worktreeId }

        if activeWorktreeId == worktreeId {
            activeWorktreeId = "main"
        }
        // TODO: webSocketManager.closeWorktree(worktreeId: worktreeId)
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
