import SwiftUI
import shared

// MARK: - Worktree Tabs

struct WorktreeTabsView: View {
    let worktrees: [Worktree]
    let activeWorktreeId: String
    let onSelect: (String) -> Void
    let onCreate: () -> Void
    let onMenu: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(worktrees, id: \.id) { worktree in
                    WorktreeTab(
                        worktree: worktree,
                        isActive: worktree.id == activeWorktreeId,
                        onTap: { onSelect(worktree.id) },
                        onLongPress: { onMenu(worktree.id) }
                    )
                }

                // Add button
                Button(action: onCreate) {
                    Image(systemName: "plus")
                        .font(.title3)
                        .foregroundColor(.blue)
                        .frame(width: 36, height: 36)
                        .background(Color.blue.opacity(0.1))
                        .clipShape(Circle())
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(.systemGray6))
    }
}

struct WorktreeTab: View {
    let worktree: Worktree
    let isActive: Bool
    let onTap: () -> Void
    let onLongPress: () -> Void

    private var worktreeColor: Color {
        Color(hex: worktree.color) ?? .blue
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 6) {
                // Color indicator
                Circle()
                    .fill(worktreeColor)
                    .frame(width: 8, height: 8)

                // Name
                Text(worktree.name)
                    .font(.subheadline)
                    .fontWeight(isActive ? .semibold : .regular)
                    .lineLimit(1)

                // Status indicator
                statusIndicator
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(isActive ? Color.blue.opacity(0.15) : Color(.systemBackground))
            .cornerRadius(18)
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(isActive ? Color.blue : Color.clear, lineWidth: 1.5)
            )
        }
        .buttonStyle(.plain)
        .contextMenu {
            if worktree.id != "main" {
                Button {
                    onLongPress()
                } label: {
                    Label("worktree.options", systemImage: "ellipsis.circle")
                }
            }
        }
    }

    @ViewBuilder
    private var statusIndicator: some View {
        switch worktree.status {
        case .creating, .processing, .merging:
            ProgressView()
                .scaleEffect(0.6)

        case .error, .mergeConflict:
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption2)
                .foregroundColor(.red)

        case .completed:
            if worktree.id != "main" {
                Image(systemName: "checkmark.circle.fill")
                    .font(.caption2)
                    .foregroundColor(.green)
            }

        default:
            EmptyView()
        }
    }
}

// MARK: - Worktree Menu

struct WorktreeMenuView: View {
    let worktree: Worktree
    let onMerge: () -> Void
    let onClose: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var showCloseConfirm = false

    private var worktreeColor: Color {
        Color(hex: worktree.color) ?? .blue
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                // Header
                HStack {
                    Circle()
                        .fill(worktreeColor)
                        .frame(width: 12, height: 12)

                    Text(worktree.name)
                        .font(.title2)
                        .fontWeight(.bold)
                }

                // Info chips
                HStack {
                    Chip(text: worktree.branchName, icon: "arrow.triangle.branch")
                    Chip(text: worktree.provider.name, icon: "cpu")
                }

                Divider()

                // Actions
                VStack(spacing: 12) {
                    if worktree.status == .ready || worktree.status == .completed {
                        Button(action: onMerge) {
                            Label("worktree.merge_to_main", systemImage: "arrow.triangle.merge")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                    }

                    Button(role: .destructive) {
                        showCloseConfirm = true
                    } label: {
                        Label("worktree.close", systemImage: "xmark.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(.horizontal)

                Spacer()
            }
            .padding(.top, 20)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
            .alert("worktree.close.title", isPresented: $showCloseConfirm) {
                Button("action.cancel", role: .cancel) {}
                Button("action.close", role: .destructive) {
                    onClose()
                }
            } message: {
                Text("worktree.close.warning")
            }
        }
    }
}

// MARK: - Create Worktree Sheet

struct CreateWorktreeSheetView: View {
    let branches: [String]
    let currentProvider: LLMProvider
    let onCreate: (String, LLMProvider, String?) -> Void

    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var selectedProvider: LLMProvider = .codex
    @State private var selectedBranch: String?
    @State private var selectedColor = Worktree.companion.COLORS.first ?? "#4CAF50"

    var body: some View {
        NavigationStack {
            Form {
                Section("worktree.name.label") {
                    TextField("worktree.name.placeholder", text: $name)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                }

                Section("provider.label") {
                    Picker("provider.label", selection: $selectedProvider) {
                        Text("provider.codex").tag(LLMProvider.codex)
                        Text("provider.claude").tag(LLMProvider.claude)
                    }
                    .pickerStyle(.segmented)
                }

                Section("worktree.color.label") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(Worktree.companion.COLORS, id: \.self) { color in
                                colorButton(color)
                            }
                        }
                    }
                }

                Section("worktree.source_branch.label") {
                    Picker("worktree.branch.label", selection: $selectedBranch) {
                        Text("branch.current").tag(nil as String?)
                        ForEach(branches, id: \.self) { branch in
                            Text(branch).tag(branch as String?)
                        }
                    }
                }
            }
            .navigationTitle("worktree.new.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("action.cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("action.create") {
                        onCreate(name, selectedProvider, selectedBranch)
                    }
                    .disabled(name.trimmingCharacters(in: .whitespaces).count < 2)
                    .fontWeight(.semibold)
                }
            }
            .onAppear {
                selectedProvider = currentProvider
            }
        }
    }

    private func colorButton(_ colorHex: String) -> some View {
        let color = Color(hex: colorHex) ?? .blue

        return Button {
            selectedColor = colorHex
        } label: {
            ZStack {
                Circle()
                    .fill(color)
                    .frame(width: 32, height: 32)

                if selectedColor == colorHex {
                    Circle()
                        .fill(.white)
                        .frame(width: 12, height: 12)
                }
            }
        }
    }
}

// MARK: - Provider Sheet

struct ProviderSheetView: View {
    let currentProvider: LLMProvider
    let onSelect: (LLMProvider) -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(LLMProvider.allCases, id: \.self) { provider in
                    Button {
                        onSelect(provider)
                    } label: {
                        HStack {
                            Image(systemName: "cpu")
                                .foregroundColor(.blue)

                            Text(provider.name)
                                .foregroundColor(.primary)

                            Spacer()

                            if provider == currentProvider {
                                Image(systemName: "checkmark")
                                    .foregroundColor(.blue)
                            }
                        }
                    }
                }
            }
            .navigationTitle("provider.title")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }
            }
        }
    }
}

// MARK: - Helper Views

struct Chip: View {
    let text: String
    let icon: String

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption)
            Text(text)
                .font(.caption)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color(.systemGray5))
        .cornerRadius(12)
    }
}

// MARK: - Color Extension

extension Color {
    init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

        var rgb: UInt64 = 0

        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else {
            return nil
        }

        let r = Double((rgb & 0xFF0000) >> 16) / 255.0
        let g = Double((rgb & 0x00FF00) >> 8) / 255.0
        let b = Double(rgb & 0x0000FF) / 255.0

        self.init(red: r, green: g, blue: b)
    }
}

// MARK: - Previews

#Preview("Worktree Tabs") {
    WorktreeTabsView(
        worktrees: [
            Worktree(id: "main", name: "main", branchName: "main", provider: .codex, status: .ready, color: "#4CAF50", parentId: nil, createdAt: 0),
            Worktree(id: "wt1", name: "feature-auth", branchName: "feature/auth", provider: .claude, status: .processing, color: "#2196F3", parentId: "main", createdAt: 1),
        ],
        activeWorktreeId: "main",
        onSelect: { _ in },
        onCreate: {},
        onMenu: { _ in }
    )
}

#Preview("Create Worktree") {
    CreateWorktreeSheetView(
        branches: ["main", "develop", "feature/ui"],
        currentProvider: .codex,
        onCreate: { _, _, _ in }
    )
}
