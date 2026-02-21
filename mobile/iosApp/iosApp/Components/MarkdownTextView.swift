import SwiftUI

struct MarkdownTextView: View {
    let markdown: String

    var body: some View {
        let segments = splitCodeBlocks(markdown)

        VStack(alignment: .leading, spacing: 8) {
            ForEach(segments.indices, id: \.self) { index in
                let segment = segments[index]
                if segment.isCode {
                    CodeBlockView(
                        language: segment.language,
                        code: segment.content
                    )
                } else if !segment.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    nonCodeMarkdownContent(segment.content)
                }
            }
        }
    }

    @ViewBuilder
    private func nonCodeMarkdownContent(_ text: String) -> some View {
        let blocks = splitHeadingBlocks(text)
        ForEach(blocks.indices, id: \.self) { index in
            switch blocks[index] {
            case let .heading(level, content):
                headingView(level: level, text: content)
            case let .markdown(content):
                markdownText(content)
            }
        }
    }

    private func markdownText(_ text: String) -> some View {
        Group {
            if let attributed = try? AttributedString(
                markdown: text,
                options: .init(
                    allowsExtendedAttributes: true,
                    interpretedSyntax: .full,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            ) {
                Text(attributed)
                    .textSelection(.enabled)
            } else {
                Text(text)
                    .textSelection(.enabled)
            }
        }
    }

    @ViewBuilder
    private func headingView(level: Int, text: String) -> some View {
        let size: CGFloat = {
            switch level {
            case 1: return 24   // max requested
            case 2: return 22
            case 3: return 20
            case 4: return 18
            case 5: return 16
            default: return 15
            }
        }()

        let weight: Font.Weight = level <= 2 ? .bold : .semibold

        Group {
            if let attributed = try? AttributedString(
                markdown: text,
                options: .init(
                    allowsExtendedAttributes: true,
                    interpretedSyntax: .inlineOnlyPreservingWhitespace,
                    failurePolicy: .returnPartiallyParsedIfPossible
                )
            ) {
                Text(attributed)
            } else {
                Text(text)
            }
        }
        .font(.system(size: size, weight: weight))
        .foregroundColor(.vibe80Ink)
        .textSelection(.enabled)
        .padding(.top, level <= 2 ? 4 : 2)
    }
}

// MARK: - Code Block

private struct CodeBlockView: View {
    let language: String?
    let code: String

    @State private var expanded = false

    private var shouldCollapse: Bool {
        let lines = code.components(separatedBy: "\n")
        return lines.count >= 8 || code.count >= 400
    }

    private var lineCount: Int {
        code.components(separatedBy: "\n").count
    }

    private var preview: String {
        code.components(separatedBy: "\n").prefix(3).joined(separator: "\n")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            Button {
                if shouldCollapse {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        expanded.toggle()
                    }
                }
            } label: {
                HStack(spacing: 8) {
                    if let language, !language.isEmpty {
                        Text(language)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.vibe80Accent)
                    }

                    Text("\(lineCount) lines")
                        .font(.caption2)
                        .foregroundColor(.secondary)

                    Spacer()

                    if shouldCollapse {
                        Image(systemName: expanded ? "chevron.up" : "chevron.down")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    Button {
                        UIPasteboard.general.string = code
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.vibe80BackgroundStrong.opacity(0.7))
            }
            .buttonStyle(.plain)

            // Code content
            if shouldCollapse && !expanded {
                Text(verbatim: preview)
                    .font(.vibe80SpaceMono(.caption1))
                    .foregroundColor(.vibe80Ink)
                    .lineLimit(3)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    Text(verbatim: code)
                        .font(.vibe80SpaceMono(.caption1))
                        .foregroundColor(.vibe80Ink)
                        .textSelection(.enabled)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                }
                .frame(maxHeight: shouldCollapse ? 240 : nil)
            }
        }
        .background(Color.vibe80BackgroundStrong)
        .cornerRadius(10)
        .onAppear {
            if !shouldCollapse {
                expanded = true
            }
        }
    }
}

// MARK: - Segment Parsing

private struct TextSegment {
    let content: String
    let isCode: Bool
    let language: String?
}

private enum MarkdownBlock {
    case heading(level: Int, text: String)
    case markdown(String)
}

private func splitHeadingBlocks(_ text: String) -> [MarkdownBlock] {
    let lines = text.components(separatedBy: .newlines)
    var blocks: [MarkdownBlock] = []
    var buffer: [String] = []

    func flushBuffer() {
        guard !buffer.isEmpty else { return }
        blocks.append(.markdown(buffer.joined(separator: "\n")))
        buffer.removeAll()
    }

    for line in lines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if let heading = parseHeadingLine(trimmed) {
            flushBuffer()
            blocks.append(.heading(level: heading.level, text: heading.text))
        } else {
            buffer.append(line)
        }
    }
    flushBuffer()
    return blocks
}

private func parseHeadingLine(_ line: String) -> (level: Int, text: String)? {
    guard line.hasPrefix("#") else { return nil }
    let hashes = line.prefix { $0 == "#" }
    let level = min(6, hashes.count)
    guard level > 0 else { return nil }

    let remainder = line.dropFirst(level)
    guard remainder.first == " " else { return nil }
    let text = remainder.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return nil }
    return (level, text)
}

private func splitCodeBlocks(_ text: String) -> [TextSegment] {
    let pattern = try! NSRegularExpression(
        pattern: #"```([A-Za-z0-9_-]*)\s*\n([\s\S]*?)```"#
    )
    let nsText = text as NSString
    var segments: [TextSegment] = []
    var lastEnd = 0

    for match in pattern.matches(in: text, range: NSRange(location: 0, length: nsText.length)) {
        // Text before code block
        if match.range.lowerBound > lastEnd {
            let before = nsText.substring(with: NSRange(location: lastEnd, length: match.range.lowerBound - lastEnd))
            segments.append(TextSegment(content: before, isCode: false, language: nil))
        }

        let lang = nsText.substring(with: match.range(at: 1))
        let code = nsText.substring(with: match.range(at: 2))
        segments.append(TextSegment(
            content: code.trimmingCharacters(in: .newlines),
            isCode: true,
            language: lang.isEmpty ? nil : lang
        ))

        lastEnd = match.range.upperBound
    }

    // Remaining text after last code block
    if lastEnd < nsText.length {
        let remaining = nsText.substring(from: lastEnd)
        segments.append(TextSegment(content: remaining, isCode: false, language: nil))
    }

    return segments
}
