import SwiftUI
import Shared

struct MessageRow: View {
    let message: ChatMessage?
    var sessionId: String? = nil
    var workspaceToken: String? = nil
    var baseUrl: String? = nil
    var streamingText: String? = nil
    var isStreaming: Bool = false

    // Vibe80 block callbacks (P2.2)
    var onChoiceSelected: ((String) -> Void)? = nil
    var onFileRefSelected: ((String) -> Void)? = nil
    var onFormSubmit: (([String: String], [Vibe80FormField]) -> Void)? = nil
    var onYesNoSubmit: ((String) -> Void)? = nil
    var formsSubmitted: Bool = false
    var yesNoSubmitted: Bool = false

    @State private var previewImage: AttachmentPreviewImage? = nil

    private var rawText: String {
        if let message = message,
           (message.role == .toolResult || message.role == .commandExecution) {
            return ""
        }
        return streamingText ?? message?.text ?? ""
    }

    private var displayText: String {
        stripAttachmentSuffix(rawText)
    }

    private var isToolOrCommand: Bool {
        guard let role = message?.role else { return false }
        return role == .toolResult || role == .commandExecution
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

    private var isAssistant: Bool {
        message?.role == .assistant || isStreaming
    }

    // Vibe80 block parsing (only for non-streaming assistant messages)
    private var shouldParseBlocks: Bool {
        isAssistant && !isStreaming && !displayText.isEmpty
    }

    private var choicesBlocks: [Vibe80ChoicesBlock] {
        shouldParseBlocks ? parseVibe80Choices(displayText) : []
    }

    private var yesNoBlocks: [Vibe80YesNoBlock] {
        shouldParseBlocks ? parseVibe80YesNo(displayText) : []
    }

    private var formBlocks: [Vibe80FormBlock] {
        shouldParseBlocks ? parseVibe80Forms(displayText) : []
    }

    private var fileRefs: [String] {
        shouldParseBlocks ? parseVibe80FileRefs(displayText) : []
    }

    private var taskLabel: String? {
        shouldParseBlocks ? parseVibe80Task(displayText) : nil
    }

    private var cleanedText: String {
        if !shouldParseBlocks { return displayText }
        return cleanVibe80Blocks(displayText, formsSubmitted: formsSubmitted, yesNoSubmitted: yesNoSubmitted)
    }

    private var shouldRenderMessageBubble: Bool {
        if isToolOrCommand || isStreaming {
            return true
        }
        return !cleanedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if isUser {
                Spacer(minLength: 60)
            }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                // Task label
                if let taskLabel {
                    HStack(spacing: 4) {
                        Image(systemName: "gearshape.2")
                            .font(.caption2)
                        Text(taskLabel)
                            .font(.caption2.weight(.medium))
                    }
                    .foregroundColor(.vibe80InkMuted)
                    .padding(.bottom, 2)
                }

                // Message bubble
                if shouldRenderMessageBubble {
                    if isUser {
                        messageBubble
                    } else {
                        messageBubble
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                // File ref chips
                if !fileRefs.isEmpty {
                    fileRefChips
                }

                // Vibe80 interactive blocks
                if shouldParseBlocks {
                    // Choices
                    ForEach(choicesBlocks.indices, id: \.self) { index in
                        Vibe80ChoicesView(block: choicesBlocks[index]) { option in
                            onChoiceSelected?(option)
                        }
                    }

                    // YesNo (only if not submitted)
                    if !yesNoSubmitted {
                        ForEach(yesNoBlocks.indices, id: \.self) { index in
                            Vibe80YesNoView(block: yesNoBlocks[index]) { answer in
                                onYesNoSubmit?(answer)
                                onChoiceSelected?(answer)
                            }
                        }
                    }

                    // Forms (only if not submitted)
                    if !formsSubmitted {
                        ForEach(formBlocks.indices, id: \.self) { index in
                            Vibe80FormView(block: formBlocks[index]) { formData, fields in
                                onFormSubmit?(formData, fields)
                            }
                        }
                    }
                }

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
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .top, spacing: 0) {
                        if isStreaming {
                            streamingIndicator
                        }

                        if !cleanedText.isEmpty {
                            if isUser {
                                Text(verbatim: cleanedText)
                                    .textSelection(.enabled)
                            } else {
                                MarkdownTextView(markdown: cleanedText)
                            }
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

    private var fileRefChips: some View {
        FlowLayout(spacing: 6) {
            ForEach(fileRefs, id: \.self) { path in
                Button {
                    onFileRefSelected?(path)
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "doc.text")
                            .font(.caption2)
                        Text(path)
                            .font(.caption)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.vibe80SurfaceElevated)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.vibe80Accent.opacity(0.3), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
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
            .fill(Color.vibe80Accent)
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

// MARK: - Flow Layout (for file ref chips)

private struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }

        return CGSize(width: maxWidth, height: y + rowHeight)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x: CGFloat = bounds.minX
        var y: CGFloat = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > bounds.maxX && x > bounds.minX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
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
                ScrollView(.vertical, showsIndicators: true) {
                    ScrollView(.horizontal, showsIndicators: true) {
                        Text(verbatim: content)
                            .font(.vibe80SpaceMono(.caption1))
                            .foregroundColor(.vibe80Ink)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
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
