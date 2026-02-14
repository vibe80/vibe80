import SwiftUI
import UIKit
import shared

struct ChatView: View {
    let sessionId: String

    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ChatViewModel()

    @State private var showDiffSheet = false
    @State private var showProviderSheet = false
    @State private var showCreateWorktreeSheet = false
    @State private var showWorktreeMenu: String? = nil
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
                        onMenu: { showWorktreeMenu = $0 }
                    )
                }

                // Messages list
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(viewModel.messages, id: \.id) { message in
                                MessageRow(message: message)
                                    .id(message.id)
                            }

                            // Streaming message
                            if let streamingText = viewModel.currentStreamingMessage {
                                MessageRow(
                                    message: nil,
                                    streamingText: streamingText,
                                    isStreaming: true
                                )
                                .id("streaming")
                            }

                            // Processing indicator
                            if viewModel.isProcessing && viewModel.currentStreamingMessage == nil {
                                ProcessingIndicator()
                                    .id("processing")
                            }
                        }
                        .padding()
                    }
                    .onChange(of: viewModel.messages.count) { _ in
                        scrollToBottom(proxy)
                    }
                    .onChange(of: viewModel.currentStreamingMessage) { _ in
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
                    isLoading: viewModel.isProcessing,
                    actionMode: viewModel.activeActionMode,
                    activeModel: viewModel.activeSelectedModel,
                    availableModels: viewModel.activeModels,
                    onSend: viewModel.sendMessage,
                    onSelectActionMode: viewModel.setActionMode,
                    onSelectModel: viewModel.setActiveModel,
                    onFocusChanged: { focused in
                        isComposerFocused = focused
                    }
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
                    // Provider chip
                    Button {
                        showProviderSheet = true
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "cpu")
                            Text(viewModel.activeProvider.name)
                        }
                        .font(.caption)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color.vibe80SurfaceElevated)
                        .cornerRadius(12)
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
            .sheet(isPresented: $showProviderSheet) {
                ProviderSheetView(
                    currentProvider: viewModel.activeProvider,
                    onSelect: { provider in
                        viewModel.switchProvider(provider)
                        showProviderSheet = false
                    }
                )
                .presentationDetents([.height(200)])
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
                if let worktree = viewModel.worktrees.first(where: { $0.id == worktreeId }) {
                    WorktreeMenuView(
                        worktree: worktree,
                        onClose: {
                            viewModel.closeWorktree(worktreeId)
                            showWorktreeMenu = nil
                        }
                    )
                    .presentationDetents([.height(250)])
                }
            }
        }
        .onAppear {
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

    // MARK: - Connection Indicator

    private var connectionIndicator: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(connectionColor)
                .frame(width: 8, height: 8)
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

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        let targetId: String? = {
            if viewModel.isProcessing && viewModel.currentStreamingMessage == nil {
                return "processing"
            }
            if viewModel.currentStreamingMessage != nil {
                return "streaming"
            }
            return viewModel.messages.last?.id
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

// MARK: - String Extension for Sheet Item

extension String: Identifiable {
    public var id: String { self }
}

// MARK: - Preview

#Preview {
    ChatView(sessionId: "test-session")
        .environmentObject(AppState())
}
