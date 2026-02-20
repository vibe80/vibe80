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
                    markdownText(segment.content)
                }
            }
        }
    }

    private func markdownText(_ text: String) -> some View {
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
                    .textSelection(.enabled)
            } else {
                Text(text)
                    .textSelection(.enabled)
            }
        }
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
