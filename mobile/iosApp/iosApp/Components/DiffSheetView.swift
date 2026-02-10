import SwiftUI
import shared

struct DiffSheetView: View {
    let diff: RepoDiff?

    @Environment(\.dismiss) private var dismiss
    @State private var expandedFiles: Set<String> = []

    var body: some View {
        NavigationStack {
            Group {
                if let diff = diff, !diff.diff.isEmpty {
                    diffContent(diff)
                } else {
                    emptyState
                }
            }
            .navigationTitle("diff.title")
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
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle")
                .font(.system(size: 48))
                .foregroundColor(.green)

            Text("diff.empty.title")
                .font(.headline)

            Text("diff.empty.subtitle")
                .font(.subheadline)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Diff Content

    private func diffContent(_ diff: RepoDiff) -> some View {
        let files = parseDiff(diff.diff)

        return List {
            // Summary
            Section {
                HStack {
                    statBadge(count: files.reduce(0) { $0 + $1.additions }, color: .green, icon: "plus")
                    statBadge(count: files.reduce(0) { $0 + $1.deletions }, color: .red, icon: "minus")
                    Spacer()
                    Text(String(format: NSLocalizedString("diff.files.count", comment: ""), files.count))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }

            // Files
            Section("diff.files.title") {
                ForEach(files) { file in
                    fileRow(file)
                }
            }
        }
    }

    private func statBadge(count: Int, color: Color, icon: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: icon)
                .font(.caption2)
            Text("\(count)")
                .font(.caption)
                .fontWeight(.medium)
        }
        .foregroundColor(color)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(color.opacity(0.1))
        .cornerRadius(8)
    }

    private func fileRow(_ file: DiffFile) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // File header
            Button {
                toggleFile(file.path)
            } label: {
                HStack {
                    Image(systemName: fileStatusIcon(file.status))
                        .foregroundColor(fileStatusColor(file.status))
                        .font(.caption)

                    Text(file.path)
                        .font(.subheadline)
                        .foregroundColor(.primary)
                        .lineLimit(1)
                        .truncationMode(.middle)

                    Spacer()

                    HStack(spacing: 8) {
                        Text("+\(file.additions)")
                            .font(.caption)
                            .foregroundColor(.green)

                        Text("-\(file.deletions)")
                            .font(.caption)
                            .foregroundColor(.red)

                        Image(systemName: expandedFiles.contains(file.path) ? "chevron.up" : "chevron.down")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            // Expanded diff
            if expandedFiles.contains(file.path) {
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(file.lines) { line in
                            diffLine(line)
                        }
                    }
                    .font(.system(.caption, design: .monospaced))
                }
                .background(Color(.systemGray6))
                .cornerRadius(8)
            }
        }
    }

    private func diffLine(_ line: DiffLine) -> some View {
        HStack(spacing: 0) {
            // Line numbers
            HStack(spacing: 4) {
                Text(line.oldNumber.map { String($0) } ?? "")
                    .frame(width: 30, alignment: .trailing)
                Text(line.newNumber.map { String($0) } ?? "")
                    .frame(width: 30, alignment: .trailing)
            }
            .foregroundColor(.secondary)
            .padding(.horizontal, 4)
            .background(Color(.systemGray5))

            // Content
            Text(line.content)
                .foregroundColor(lineColor(line.type))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 4)
                .background(lineBackground(line.type))
        }
    }

    // MARK: - Helpers

    private func toggleFile(_ path: String) {
        if expandedFiles.contains(path) {
            expandedFiles.remove(path)
        } else {
            expandedFiles.insert(path)
        }
    }

    private func fileStatusIcon(_ status: String) -> String {
        switch status {
        case "A": return "plus.circle.fill"
        case "D": return "minus.circle.fill"
        case "M": return "pencil.circle.fill"
        case "R": return "arrow.right.circle.fill"
        default: return "questionmark.circle"
        }
    }

    private func fileStatusColor(_ status: String) -> Color {
        switch status {
        case "A": return .green
        case "D": return .red
        case "M": return .orange
        case "R": return .blue
        default: return .secondary
        }
    }

    private func lineColor(_ type: DiffLineType) -> Color {
        switch type {
        case .addition: return .green
        case .deletion: return .red
        case .context: return .primary
        case .hunk: return .secondary
        }
    }

    private func lineBackground(_ type: DiffLineType) -> Color {
        switch type {
        case .addition: return Color.green.opacity(0.1)
        case .deletion: return Color.red.opacity(0.1)
        case .context: return .clear
        case .hunk: return Color(.systemGray5)
        }
    }

    // MARK: - Diff Parsing

    private func parseDiff(_ diffText: String) -> [DiffFile] {
        var files: [DiffFile] = []
        var currentFile: DiffFile?
        var lines: [DiffLine] = []
        var oldLine = 0
        var newLine = 0

        for line in diffText.components(separatedBy: "\n") {
            if line.hasPrefix("diff --git") {
                // Save previous file
                if var file = currentFile {
                    file.lines = lines
                    files.append(file)
                }

                // Extract filename
                let parts = line.components(separatedBy: " ")
                let path = parts.last?.replacingOccurrences(of: "b/", with: "") ?? "unknown"

                currentFile = DiffFile(path: path, status: "M", additions: 0, deletions: 0, lines: [])
                lines = []
            } else if line.hasPrefix("@@") {
                // Parse hunk header
                lines.append(DiffLine(type: .hunk, content: line, oldNumber: nil, newNumber: nil))

                // Extract line numbers from @@ -old,count +new,count @@
                if let range = line.range(of: #"\+(\d+)"#, options: .regularExpression) {
                    newLine = Int(line[range].dropFirst()) ?? 0
                }
                if let range = line.range(of: #"-(\d+)"#, options: .regularExpression) {
                    oldLine = Int(line[range].dropFirst()) ?? 0
                }
            } else if line.hasPrefix("+") && !line.hasPrefix("+++") {
                lines.append(DiffLine(type: .addition, content: line, oldNumber: nil, newNumber: newLine))
                currentFile?.additions += 1
                newLine += 1
            } else if line.hasPrefix("-") && !line.hasPrefix("---") {
                lines.append(DiffLine(type: .deletion, content: line, oldNumber: oldLine, newNumber: nil))
                currentFile?.deletions += 1
                oldLine += 1
            } else if !line.hasPrefix("\\") && !line.isEmpty {
                lines.append(DiffLine(type: .context, content: " " + line, oldNumber: oldLine, newNumber: newLine))
                oldLine += 1
                newLine += 1
            }
        }

        // Save last file
        if var file = currentFile {
            file.lines = lines
            files.append(file)
        }

        return files
    }
}

// MARK: - Diff Models

struct DiffFile: Identifiable {
    let id = UUID()
    let path: String
    let status: String
    var additions: Int
    var deletions: Int
    var lines: [DiffLine]
}

struct DiffLine: Identifiable {
    let id = UUID()
    let type: DiffLineType
    let content: String
    let oldNumber: Int?
    let newNumber: Int?
}

enum DiffLineType {
    case addition
    case deletion
    case context
    case hunk
}

// MARK: - Preview

#Preview("With Changes") {
    DiffSheetView(diff: RepoDiff(
        status: " M src/main.swift",
        diff: """
        diff --git a/src/main.swift b/src/main.swift
        @@ -1,5 +1,7 @@
         import Foundation

        +import SwiftUI
        +
         func main() {
        -    print("Hello")
        +    print("Hello, World!")
         }
        """
    ))
}

#Preview("Empty") {
    DiffSheetView(diff: nil)
}
