import SwiftUI
import Shared

private enum LogsFilter: String, CaseIterable, Identifiable {
    case all
    case api
    case websocket
    case app

    var id: String { rawValue }

    var titleKey: LocalizedStringKey {
        switch self {
        case .all: return "logs.filter.all"
        case .api: return "logs.filter.api"
        case .websocket: return "logs.filter.websocket"
        case .app: return "logs.filter.app"
        }
    }
}

struct LogsSheetView: View {
    let logs: [LogEntry]
    let onClear: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedFilter: LogsFilter = .all

    private var filteredLogs: [LogEntry] {
        switch selectedFilter {
        case .all:
            return logs
        case .api:
            return logs.filter { sourceName($0.source) == "api" }
        case .websocket:
            return logs.filter { sourceName($0.source) == "websocket" }
        case .app:
            return logs.filter { sourceName($0.source) == "app" }
        }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Picker("logs.filter.all", selection: $selectedFilter) {
                    ForEach(LogsFilter.allCases) { filter in
                        Text(filter.titleKey).tag(filter)
                    }
                }
                .pickerStyle(.segmented)

                if filteredLogs.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "text.page")
                            .font(.system(size: 28))
                            .foregroundColor(.secondary)
                        Text("logs.empty")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(Array(filteredLogs.indices), id: \.self) { index in
                            let entry = filteredLogs[index]
                            logRow(entry)
                                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color.clear)
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 10)
            .navigationTitle(titleText)
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
                    Button("logs.clear") {
                        onClear()
                    }
                    .disabled(logs.isEmpty)
                }
            }
        }
    }

    private var titleText: String {
        if filteredLogs.isEmpty {
            return NSLocalizedString("logs.title.simple", comment: "")
        }
        let format = NSLocalizedString("logs.title", comment: "")
        return String(format: format, filteredLogs.count)
    }

    private func logRow(_ entry: LogEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(formatTimestamp(entry.timestamp as Any))
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .font(.system(.caption2, design: .monospaced))

                Image(systemName: iconName(for: entry.source))
                    .font(.caption2)
                    .foregroundColor(.secondary)

                Text(levelName(entry.level))
                    .font(.caption2)
                    .fontWeight(.semibold)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(levelColor(entry.level).opacity(0.15))
                    .foregroundColor(levelColor(entry.level))
                    .clipShape(Capsule())
            }

            Text(entry.message)
                .font(.caption)
                .textSelection(.enabled)
                .font(.system(.caption, design: .monospaced))

            if let details = entry.details, !details.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(details)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .textSelection(.enabled)
                        .font(.system(.caption2, design: .monospaced))
                        .padding(8)
                }
                .background(Color.vibe80BackgroundStrong)
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
        .padding(10)
        .background(levelBackground(entry.level))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }

    private func sourceName(_ source: LogSource) -> String {
        source.name.lowercased()
    }

    private func levelName(_ level: LogLevel) -> String {
        level.name
    }

    private func iconName(for source: LogSource) -> String {
        switch sourceName(source) {
        case "api":
            return "network"
        case "websocket":
            return "cable.connector"
        default:
            return "iphone"
        }
    }

    private func levelColor(_ level: LogLevel) -> Color {
        switch levelName(level) {
        case "ERROR":
            return .red
        case "WARNING":
            return .orange
        case "INFO":
            return .blue
        default:
            return .secondary
        }
    }

    private func levelBackground(_ level: LogLevel) -> Color {
        switch levelName(level) {
        case "ERROR":
            return Color.red.opacity(0.08)
        case "WARNING":
            return Color.orange.opacity(0.08)
        default:
            return Color.vibe80Surface
        }
    }

    private func formatTimestamp(_ raw: Any) -> String {
        let timestamp: Int64
        if let value = raw as? Int64 {
            timestamp = value
        } else if let value = raw as? NSNumber {
            timestamp = value.int64Value
        } else if let value = raw as? KotlinLong {
            timestamp = value.int64Value
        } else {
            timestamp = 0
        }
        let date = Date(timeIntervalSince1970: Double(timestamp) / 1000)
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss.SSS"
        return formatter.string(from: date)
    }
}
