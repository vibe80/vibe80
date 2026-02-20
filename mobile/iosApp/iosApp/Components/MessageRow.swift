import SwiftUI
import Shared

struct MessageRow: View {
    let message: ChatMessage?
    var sessionId: String? = nil
    var workspaceToken: String? = nil
    var baseUrl: String? = nil
    var streamingText: String? = nil
    var isStreaming: Bool = false
    @State private var previewImage: AttachmentPreviewImage? = nil

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
        .fullScreenCover(item: $previewImage) { preview in
            ZoomableAttachmentImageView(
                imageUrl: preview.url,
                imageName: preview.name
            )
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
                        if isUser {
                            Text(verbatim: displayText)
                                .textSelection(.enabled)
                        } else {
                            Text(LocalizedStringKey(displayText))
                                .textSelection(.enabled)
                        }
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
                Label("action.copy", systemImage: "doc.on.doc")
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
                    if isImageAttachment(attachment),
                       let imageUrl = resolveAttachmentUrl(for: attachment) {
                        Button {
                            previewImage = AttachmentPreviewImage(url: imageUrl, name: attachment.name)
                        } label: {
                            imageAttachmentThumbnail(attachment, imageUrl: imageUrl)
                        }
                        .buttonStyle(.plain)
                    } else {
                        attachmentChip(attachment)
                    }
                }
            }
        }
    }

    private func imageAttachmentThumbnail(_ attachment: Attachment, imageUrl: URL) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            AsyncImage(url: imageUrl) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 220, maxHeight: 160)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                case .failure:
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.vibe80BackgroundStrong)
                        .frame(width: 160, height: 100)
                        .overlay(
                            Image(systemName: "photo")
                                .foregroundColor(.secondary)
                        )
                default:
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.vibe80BackgroundStrong)
                        .frame(width: 160, height: 100)
                        .overlay(ProgressView())
                }
            }

            Text(attachment.name)
                .font(.caption2)
                .foregroundColor(.secondary)
                .lineLimit(1)
        }
    }

    private func attachmentChip(_ attachment: Attachment) -> some View {
        HStack(spacing: 4) {
            Image(systemName: attachmentIcon(for: attachment))
                .font(.caption)

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

    private func attachmentIcon(for attachment: Attachment) -> String {
        let name = attachment.name.lowercased()
        if name.hasSuffix(".png") || name.hasSuffix(".jpg") || name.hasSuffix(".jpeg") || name.hasSuffix(".gif") {
            return "photo"
        } else if name.hasSuffix(".pdf") {
            return "doc.fill"
        } else if name.hasSuffix(".swift") || name.hasSuffix(".kt") || name.hasSuffix(".ts") || name.hasSuffix(".js") {
            return "chevron.left.forwardslash.chevron.right"
        } else {
            return "doc"
        }
    }

    private func isImageAttachment(_ attachment: Attachment) -> Bool {
        if let mimeType = attachment.mimeType, mimeType.hasPrefix("image/") {
            return true
        }
        let name = attachment.name.lowercased()
        return name.hasSuffix(".png")
            || name.hasSuffix(".jpg")
            || name.hasSuffix(".jpeg")
            || name.hasSuffix(".gif")
            || name.hasSuffix(".webp")
    }

    private func resolveAttachmentUrl(for attachment: Attachment) -> URL? {
        let path = attachment.path
        if path.hasPrefix("http://") || path.hasPrefix("https://") {
            return URL(string: path)
        }
        guard
            let baseUrl,
            let sessionId,
            !sessionId.isEmpty,
            var components = URLComponents(string: baseUrl)
        else {
            return nil
        }

        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = "/" + ([basePath, "api/attachments/file"]
            .filter { !$0.isEmpty }
            .joined(separator: "/"))
        var queryItems = [
            URLQueryItem(name: "session", value: sessionId),
            URLQueryItem(name: "path", value: path)
        ]
        if let workspaceToken, !workspaceToken.isEmpty {
            queryItems.append(URLQueryItem(name: "token", value: workspaceToken))
        }
        components.queryItems = queryItems
        return components.url
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

private struct AttachmentPreviewImage: Identifiable {
    let id = UUID()
    let url: URL
    let name: String
}

private struct ZoomableAttachmentImageView: View {
    let imageUrl: URL
    let imageName: String

    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.opacity(0.96).ignoresSafeArea()

            AsyncImage(url: imageUrl) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(scale)
                        .gesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    scale = (lastScale * value).clamped(to: 1...6)
                                }
                                .onEnded { _ in
                                    lastScale = scale
                                }
                        )
                        .onTapGesture(count: 2) {
                            withAnimation(.easeOut(duration: 0.2)) {
                                if scale > 1.1 {
                                    scale = 1
                                    lastScale = 1
                                } else {
                                    scale = 2
                                    lastScale = 2
                                }
                            }
                        }
                        .padding(16)
                case .failure:
                    VStack(spacing: 8) {
                        Image(systemName: "photo")
                            .font(.title)
                            .foregroundColor(.white.opacity(0.8))
                        Text(imageName)
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))
                    }
                default:
                    ProgressView()
                        .tint(.white)
                }
            }

            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 28))
                    .foregroundColor(.white.opacity(0.9))
                    .padding(16)
            }
        }
    }
}

private extension Comparable {
    func clamped(to limits: ClosedRange<Self>) -> Self {
        min(max(self, limits.lowerBound), limits.upperBound)
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
        VStack(alignment: .leading, spacing: 3) {
            Button {
                expanded.toggle()
            } label: {
                HStack(alignment: .center, spacing: 8) {
                    Image(systemName: "chevron.left.forwardslash.chevron.right")
                        .foregroundColor(.vibe80Accent)

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
                    Image(systemName: expanded ? "chevron.up" : "chevron.down")
                        .foregroundColor(.secondary)
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
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
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
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
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
