import SwiftUI
import shared

struct ChatView: View {
    let sessionId: String

    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ChatViewModel()

    @State private var showBranchesSheet = false
    @State private var showDiffSheet = false
    @State private var showProviderSheet = false
    @State private var showCreateWorktreeSheet = false
    @State private var showWorktreeMenu: String? = nil

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
                        withAnimation {
                            proxy.scrollTo(viewModel.messages.last?.id, anchor: .bottom)
                        }
                    }
                }

                // Composer
                ComposerView(
                    text: $viewModel.inputText,
                    isLoading: viewModel.isProcessing,
                    onSend: viewModel.sendMessage
                )
            }
            .navigationTitle("M5Chat")
            .navigationBarTitleDisplayMode(.inline)
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
                        .background(Color.blue.opacity(0.1))
                        .cornerRadius(12)
                    }

                    // Branches button
                    Button {
                        showBranchesSheet = true
                    } label: {
                        Image(systemName: "arrow.triangle.branch")
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
            .sheet(isPresented: $showBranchesSheet) {
                BranchesSheetView(
                    branches: viewModel.branches,
                    currentBranch: viewModel.currentBranch,
                    onSelect: { branch in
                        viewModel.switchBranch(branch)
                        showBranchesSheet = false
                    },
                    onFetch: viewModel.fetchBranches
                )
                .presentationDetents([.medium, .large])
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
                    branches: viewModel.branches,
                    currentProvider: viewModel.activeProvider,
                    onCreate: { name, provider, branch in
                        viewModel.createWorktree(name: name, provider: provider, branchName: branch)
                        showCreateWorktreeSheet = false
                    }
                )
                .presentationDetents([.medium])
            }
            .sheet(item: $showWorktreeMenu) { worktreeId in
                if let worktree = viewModel.worktrees.first(where: { $0.id == worktreeId }) {
                    WorktreeMenuView(
                        worktree: worktree,
                        onMerge: {
                            viewModel.mergeWorktree(worktreeId)
                            showWorktreeMenu = nil
                        },
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
        }
    }

    // MARK: - Connection Indicator

    private var connectionIndicator: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(connectionColor)
                .frame(width: 8, height: 8)

            if let branch = viewModel.currentBranch {
                Text(branch)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
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
}

// MARK: - Processing Indicator

struct ProcessingIndicator: View {
    var body: some View {
        HStack(alignment: .top) {
            HStack(spacing: 8) {
                ProgressView()
                    .scaleEffect(0.8)

                Text("En train de réfléchir...")
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
