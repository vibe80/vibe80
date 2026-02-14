import SwiftUI
import shared

struct MessageRow: View {
    let message: ChatMessage?
    var streamingText: String? = nil
    var isStreaming: Bool = false

    private var displayText: String {
        if let message = message,
           (message.role == .tool_result || message.role == .commandExecution) {
            return ""
        }
        return streamingText ?? message?.text ?? ""
    }

    private var isToolOrCommand: Bool {
        guard let role = message?.role else { return false }
        return role == .tool_result || role == .commandExecution
    }

    private var toolName: String {
        if let name = message?.toolResult?.name, !name.isEmpty {
            return name
        }
        if let command = message?.command, !command.isEmpty {
            return command
        }
        return "command"
    }

    private var toolOutput: String {
        if let output = message?.toolResult?.output, !output.isEmpty {
            return output
        }
        if let output = message?.output, !output.isEmpty {
            return output
        }
        return message?.text ?? ""
    }

    private var localizedToolTitle: String {
        let template = NSLocalizedString("message.tool_with_name", comment: "")
        if template.contains("%@") {
            return String(format: template, toolName)
        }
        return template.replacingOccurrences(of: "%s", with: toolName)
    }

    private var isUser: Bool {
        message?.role == .user
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isUser {
                Spacer(minLength: 60)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                // Message bubble
                messageBubble

                // Attachments
                if let attachments = message?.attachments, !attachments.isEmpty {
                    attachmentsView(attachments)
                }

                // Timestamp
                if let timestamp = message?.timestamp {
                    Text(formatTimestamp(timestamp))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            if !isUser {
                Spacer(minLength: 60)
            }
        }
    }

    // MARK: - Message Bubble

    private var messageBubble: some View {
        Group {
            if isToolOrCommand {
                ToolResultPanel(
                    title: localizedToolTitle,
                    content: toolOutput
                )
            } else {
                HStack(alignment: .top, spacing: 0) {
                    if isStreaming {
                        streamingIndicator
                    }

                    // Use AttributedString for Markdown support in iOS 15+
                    if !displayText.isEmpty {
                        Text(LocalizedStringKey(displayText))
                            .textSelection(.enabled)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(bubbleBackground)
        .foregroundColor(bubbleForeground)
        .cornerRadius(18)
        .contextMenu {
            Button {
                UIPasteboard.general.string = isToolOrCommand ? toolOutput : displayText
            } label: {
                HStack {
                    FaIconView(glyph: .file, size: 12)
                    Text("action.copy")
                }
            }
        }
    }

    private var bubbleBackground: Color {
        if isUser {
            return .vibe80Accent
        } else {
            return .vibe80Surface
        }
    }

    private var bubbleForeground: Color {
        if isUser {
            return .white
        } else {
            return .vibe80Ink
        }
    }

    private var streamingIndicator: some View {
        Circle()
            .fill(.vibe80Accent)
            .frame(width: 8, height: 8)
            .opacity(0.8)
            .modifier(PulseAnimation())
            .padding(.trailing, 8)
            .padding(.top, 6)
    }

    // MARK: - Attachments

    private func attachmentsView(_ attachments: [Attachment]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(attachments, id: \.path) { attachment in
                    attachmentChip(attachment)
                }
            }
        }
    }

    private func attachmentChip(_ attachment: Attachment) -> some View {
        HStack(spacing: 4) {
            FaIconView(glyph: attachmentIcon(for: attachment), size: 12)

            Text(attachment.name)
                .font(.caption)
                .lineLimit(1)

            if let size = attachment.size as? Int64, size > 0 {
                Text(formatFileSize(size))
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.vibe80BackgroundStrong)
        .cornerRadius(12)
    }

    private func attachmentIcon(for attachment: Attachment) -> FaGlyph {
        let name = attachment.name.lowercased()
        if name.hasSuffix(".png") || name.hasSuffix(".jpg") || name.hasSuffix(".jpeg") || name.hasSuffix(".gif") {
            return .image
        } else if name.hasSuffix(".pdf") {
            return .file
        } else if name.hasSuffix(".swift") || name.hasSuffix(".kt") || name.hasSuffix(".ts") || name.hasSuffix(".js") {
            return .code
        } else {
            return .file
        }
    }

    // MARK: - Helpers

    private func formatTimestamp(_ timestamp: Int64) -> String {
        let date = Date(timeIntervalSince1970: Double(timestamp) / 1000)
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }

    private func formatFileSize(_ bytes: Int64) -> String {
        let kb = Double(bytes) / 1024
        if kb < 1024 {
            return String(format: "%.1f KB", kb)
        } else {
            return String(format: "%.1f MB", kb / 1024)
        }
    }
}

private struct ToolResultPanel: View {
    let title: String
    let content: String
    @State private var expanded = false

    private var lineCount: Int {
        max(content.split(separator: "\n", omittingEmptySubsequences: false).count, 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                expanded.toggle()
            } label: {
                HStack(alignment: .center, spacing: 8) {
                    FaIconView(glyph: .code, size: 12, color: .vibe80Accent)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.vibe80Ink)
                            .lineLimit(1)
                            .truncationMode(.tail)

                        Text(
                            String(
                                format: NSLocalizedString("message.code_lines", comment: ""),
                                lineCount
                            )
                        )
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    }

                    Spacer(minLength: 8)
                    FaIconView(
                        glyph: expanded ? .chevronUp : .chevronDown,
                        size: 12,
                        color: .secondary
                    )
                }
            }
            .buttonStyle(.plain)

            if expanded {
                ScrollView([.horizontal, .vertical], showsIndicators: true) {
                    Text(verbatim: content)
                        .font(.vibe80SpaceMono(.caption1))
                        .foregroundColor(.vibe80Ink)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                        .padding(8)
                }
                .frame(maxHeight: 220)
                .background(Color.vibe80BackgroundStrong)
                .cornerRadius(10)
            } else {
                Text(verbatim: content)
                    .font(.vibe80SpaceMono(.caption1))
                    .foregroundColor(.vibe80Ink)
                    .lineLimit(3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                    .background(Color.vibe80BackgroundStrong)
                    .cornerRadius(10)
            }
        }
    }
}

// MARK: - Pulse Animation

struct PulseAnimation: ViewModifier {
    @State private var isAnimating = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(isAnimating ? 1.2 : 1.0)
            .opacity(isAnimating ? 0.5 : 1.0)
            .animation(
                Animation.easeInOut(duration: 0.6)
                    .repeatForever(autoreverses: true),
                value: isAnimating
            )
            .onAppear {
                isAnimating = true
            }
    }
}

// MARK: - Preview

#Preview("User Message") {
    MessageRow(message: ChatMessage.mockUser)
        .padding()
}

#Preview("Assistant Message") {
    MessageRow(message: ChatMessage.mockAssistant)
        .padding()
}

#Preview("Streaming") {
    MessageRow(
        message: nil,
        streamingText: "Je suis en train d'écrire...",
        isStreaming: true
    )
    .padding()
}
