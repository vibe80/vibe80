import SwiftUI

struct BranchesSheetView: View {
    let branches: [String]
    let currentBranch: String?
    let onSelect: (String) -> Void
    let onFetch: () -> Void

    @State private var isFetching = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                // Current branch section
                if let current = currentBranch {
                    Section {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(.green)

                            VStack(alignment: .leading) {
                                Text("Branche actuelle")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                Text(current)
                                    .font(.headline)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }

                // Available branches
                Section("Branches disponibles") {
                    ForEach(branches, id: \.self) { branch in
                        Button {
                            if branch != currentBranch {
                                onSelect(branch)
                            }
                        } label: {
                            HStack {
                                Image(systemName: "arrow.triangle.branch")
                                    .foregroundColor(.secondary)

                                Text(branch)
                                    .foregroundColor(.primary)

                                Spacer()

                                if branch == currentBranch {
                                    Image(systemName: "checkmark")
                                        .foregroundColor(.blue)
                                }
                            }
                        }
                        .disabled(branch == currentBranch)
                    }
                }
            }
            .navigationTitle("Branches")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.secondary)
                    }
                }

                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        fetchBranches()
                    } label: {
                        if isFetching {
                            ProgressView()
                        } else {
                            Label("Fetch", systemImage: "arrow.clockwise")
                        }
                    }
                    .disabled(isFetching)
                }
            }
        }
    }

    private func fetchBranches() {
        isFetching = true
        onFetch()

        // Simulate fetch completion
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            isFetching = false
        }
    }
}

// MARK: - Preview

#Preview {
    BranchesSheetView(
        branches: ["main", "develop", "feature/auth", "feature/ui", "bugfix/login"],
        currentBranch: "main",
        onSelect: { _ in },
        onFetch: {}
    )
}
