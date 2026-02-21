import SwiftUI
import UIKit
import Shared

struct ChatView: View {
    let sessionId: String

    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ChatViewModel()

    @State private var showDiffSheet = false
    @State private var showCreateWorktreeSheet = false
    @State private var showWorktreeMenu: IdentifiableString? = nil
    @State private var isComposerFocused = false
    @State private var keyboardHeight: CGFloat = 0

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                // Worktree tabs
                if !viewModel.worktrees.isEmpty {
                    WorktreeTabsView(
                        worktrees: viewModel.sortedWorktrees,
                        activeWorktreeId: viewModel.activeWorktreeId,
                        onSelect: viewModel.selectWorktree,
                        onCreate: { showCreateWorktreeSheet = true },
                        onMenu: { showWorktreeMenu = IdentifiableString($0) }
                    )
                }

                // Messages list
                ScrollViewReader { proxy in
                    ScrollView {
                        messageListContent
                        .padding()
                    }
                    .onChange(of: viewModel.activeWorktreeMessages.count) { _ in
                        scrollToBottom(proxy)
                    }
                    .onChange(of: viewModel.activeStreamingMessage) { _ in
                        scrollToBottom(proxy)
                    }
                    .onChange(of: isComposerFocused) { focused in
                        if focused {
                            scrollToBottom(proxy)
                        }
                    }
                    .onChange(of: keyboardHeight) { height in
                        if height > 0 {
                            scrollToBottom(proxy)
                        }
                    }
                }

                // Composer
                ComposerView(
                    text: $viewModel.inputText,
                    isLoading: viewModel.isActiveWorktreeProcessing,
                    isUploading: viewModel.uploadingAttachments,
                    actionMode: viewModel.activeActionMode,
                    activeModel: viewModel.activeSelectedModel,
                    availableModels: viewModel.activeModels,
                    onSend: viewModel.sendMessage,
                    onSelectActionMode: viewModel.setActionMode,
                    onSelectModel: viewModel.setActiveModel,
                    onFocusChanged: { focused in
                        isComposerFocused = focused
                    },
                    pendingAttachments: viewModel.pendingAttachments,
                    onAddAttachment: viewModel.addPendingAttachment,
                    onRemoveAttachment: viewModel.removePendingAttachment
                )
            }
            .navigationTitle("app.name")
            .navigationBarTitleDisplayMode(.inline)
            .background(Color.vibe80Background)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    connectionIndicator
                }

                ToolbarItemGroup(placement: .navigationBarTrailing) {
                    // Add worktree
                    Button {
                        showCreateWorktreeSheet = true
                    } label: {
                        Image(systemName: "plus.square.on.square")
                    }

                    // Diff button with badge
                    Button {
                        showDiffSheet = true
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "doc.text.magnifyingglass")

                            if viewModel.hasUncommittedChanges {
                                Circle()
                                    .fill(.red)
                                    .frame(width: 8, height: 8)
                                    .offset(x: 4, y: -4)
                            }
                        }
                    }

#if DEBUG
                    Button {
                        viewModel.showLogs()
                    } label: {
                        Image(systemName: "ladybug")
                    }
#endif

                    // Disconnect button
                    Button {
                        viewModel.disconnect()
                        appState.clearSession()
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                    }
                }
            }
            .sheet(isPresented: $showDiffSheet) {
                DiffSheetView(diff: viewModel.repoDiff)
                    .presentationDetents([.large])
            }
            .sheet(isPresented: $viewModel.showLogsSheet) {
                LogsSheetView(
                    logs: viewModel.logs,
                    onClear: viewModel.clearLogs
                )
                .presentationDetents([.large])
            }
            .sheet(isPresented: $showCreateWorktreeSheet) {
                CreateWorktreeSheetView(
                    currentProvider: viewModel.activeProvider,
                    worktrees: viewModel.sortedWorktrees,
                    onCreate: { name, provider, branch, model, reasoningEffort, context, sourceWorktree, internetAccess, denyGitCredentialsAccess in
                        viewModel.createWorktree(
                            name: name,
                            provider: provider,
                            branchName: branch,
                            model: model,
                            reasoningEffort: reasoningEffort,
                            context: context,
                            sourceWorktree: sourceWorktree,
                            internetAccess: internetAccess,
                            denyGitCredentialsAccess: denyGitCredentialsAccess
                        )
                        showCreateWorktreeSheet = false
                    }
                )
                .presentationDetents([.medium])
            }
            .sheet(item: $showWorktreeMenu) { worktreeId in
                if let worktree = viewModel.worktrees.first(where: { $0.id == worktreeId.value }) {
                    WorktreeMenuView(
                        worktree: worktree,
                        onClose: {
                            viewModel.closeWorktree(worktreeId.value)
                            showWorktreeMenu = nil
                        }
                    )
                    .presentationDetents([.height(250)])
                }
            }
            // File sheet (P2.2)
            .sheet(isPresented: $viewModel.showFileSheet) {
                FileSheetView(
                    path: viewModel.fileSheetPath,
                    content: viewModel.fileSheetContent,
                    isLoading: viewModel.fileSheetLoading,
                    error: viewModel.fileSheetError,
                    isBinary: viewModel.fileSheetBinary,
                    isTruncated: viewModel.fileSheetTruncated
                )
                .presentationDetents([.large])
            }
            // Error banner overlay (P2.1)
            .overlay(alignment: .bottom) {
                if let error = viewModel.currentError {
                    ErrorBannerView(error: error) {
                        viewModel.dismissError()
                    }
                    .padding(.horizontal, 12)
                    .padding(.bottom, 80)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.easeInOut(duration: 0.3), value: viewModel.currentError != nil)
                }
            }
        }
        .onAppear {
            viewModel.setup(appState: appState)
            viewModel.connect(sessionId: sessionId)
            viewModel.loadModelsForActiveWorktree()
        }
        .onChange(of: viewModel.activeWorktreeId) { _ in
            viewModel.loadModelsForActiveWorktree()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { notification in
            guard
                let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect
            else { return }
            let inset = max(0, UIScreen.main.bounds.height - frame.minY)
            withAnimation(.easeOut(duration: 0.25)) {
                keyboardHeight = inset
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            withAnimation(.easeOut(duration: 0.25)) {
                keyboardHeight = 0
            }
        }
    }

    private var workspaceToken: String? {
        UserDefaults.standard.string(forKey: "workspaceToken")
    }

    @ViewBuilder
    private var messageListContent: some View {
        LazyVStack(spacing: 12) {
            ForEach(viewModel.activeWorktreeMessages, id: \.id) { message in
                messageRow(message)
            }

            if let streamingText = viewModel.activeStreamingMessage {
                MessageRow(
                    message: nil,
                    sessionId: sessionId,
                    workspaceToken: workspaceToken,
                    baseUrl: currentServerUrl,
                    streamingText: streamingText,
                    isStreaming: true
                )
                .id("streaming")
            }

            if viewModel.isActiveWorktreeProcessing && viewModel.activeStreamingMessage == nil {
                ProcessingIndicator()
                    .id("processing")
                    .transition(.opacity)
            }
        }
    }

    private func messageRow(_ message: ChatMessage) -> some View {
        MessageRow(
            message: message,
            sessionId: sessionId,
            workspaceToken: workspaceToken,
            baseUrl: currentServerUrl,
            onChoiceSelected: { option in
                viewModel.inputText = option
                viewModel.sendMessage()
            },
            onFileRefSelected: { path in
                viewModel.openFileRef(path)
            },
            onFormSubmit: { formData, fields in
                let response = formatFormResponse(formData, fields)
                viewModel.inputText = response
                viewModel.sendMessage()
                viewModel.markFormSubmitted(message.id)
            },
            onYesNoSubmit: { _ in
                viewModel.markYesNoSubmitted(message.id)
            },
            formsSubmitted: viewModel.submittedFormMessageIds.contains(message.id),
            yesNoSubmitted: viewModel.submittedYesNoMessageIds.contains(message.id)
        )
        .id(message.id)
        .transition(.opacity.combined(with: .move(edge: .bottom)))
    }

    // MARK: - Connection Indicator

    private var connectionIndicator: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(connectionColor)
                .frame(width: 8, height: 8)
                .animation(.easeInOut, value: viewModel.connectionState)
        }
    }

    private var connectionColor: Color {
        switch viewModel.connectionState {
        case .connected:
            return .green
        case .connecting, .reconnecting:
            return .orange
        case .disconnected:
            return .gray
        case .error:
            return .red
        default:
            return .gray
        }
    }

    private var currentServerUrl: String {
        if let envUrl = ProcessInfo.processInfo.environment["VIBE80_SERVER_URL"], !envUrl.isEmpty {
            return envUrl
        }
        if let savedUrl = UserDefaults.standard.string(forKey: "serverUrl"), !savedUrl.isEmpty {
            return savedUrl
        }
        #if DEBUG
        return "https://app.vibe80.io"
        #else
        return "https://app.vibe80.io"
        #endif
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        let targetId: String? = {
            if viewModel.isActiveWorktreeProcessing && viewModel.activeStreamingMessage == nil {
                return "processing"
            }
            if viewModel.activeStreamingMessage != nil {
                return "streaming"
            }
            return viewModel.activeWorktreeMessages.last?.id
        }()

        guard let targetId else { return }
        withAnimation(.easeOut(duration: 0.25)) {
            proxy.scrollTo(targetId, anchor: .bottom)
        }
    }
}

// MARK: - Processing Indicator

struct ProcessingIndicator: View {
    var body: some View {
        HStack(alignment: .top) {
            HStack(spacing: 8) {
                ProgressView()
                    .scaleEffect(0.8)

                Text("chat.thinking")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(16)

            Spacer()
        }
    }
}

struct IdentifiableString: Identifiable {
    let value: String
    var id: String { value }

    init(_ value: String) {
        self.value = value
    }
}

// MARK: - Preview

#Preview {
    ChatView(sessionId: "test-session")
        .environmentObject(AppState())
}
