import Foundation

// MARK: - Data Models

struct Vibe80ChoicesBlock {
    let question: String?
    let options: [String]
    let startIndex: Int
    let endIndex: Int
}

struct Vibe80YesNoBlock {
    let question: String?
    let startIndex: Int
    let endIndex: Int
}

struct Vibe80FormBlock {
    let question: String
    let fields: [Vibe80FormField]
    let startIndex: Int
    let endIndex: Int
}

struct Vibe80FormField {
    let type: FieldType
    let id: String
    let label: String
    let defaultValue: String
    let choices: [String]
}

enum FieldType: String {
    case input
    case textarea
    case radio
    case select
    case checkbox
}

// MARK: - Attachment Suffix

func stripAttachmentSuffix(_ text: String) -> String {
    guard let regex = try? NSRegularExpression(
        pattern: #"(?s)^(.*?)(?:\n?\s*;;\s*attachments:\s*\[[^\]]*\])\s*$"#
    ) else { return text }
    let range = NSRange(text.startIndex..., in: text)
    guard let match = regex.firstMatch(in: text, range: range),
          let captureRange = Range(match.range(at: 1), in: text) else { return text }
    return String(text[captureRange]).trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - Choices Parsing

func parseVibe80Choices(_ text: String) -> [Vibe80ChoicesBlock] {
    let startPattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:choices\s*(.*?)\s*-->"#, options: .caseInsensitive)
    let endPattern = try! NSRegularExpression(pattern: #"<!--\s*/vibe80:choices\s*-->"#, options: .caseInsensitive)

    var blocks: [Vibe80ChoicesBlock] = []
    var searchStart = 0

    while searchStart < text.count {
        let searchRange = NSRange(location: searchStart, length: text.count - searchStart)
        guard let startMatch = startPattern.firstMatch(in: text, range: searchRange) else { break }
        let afterStart = startMatch.range.upperBound
        let remainingRange = NSRange(location: afterStart, length: text.count - afterStart)
        guard let endMatch = endPattern.firstMatch(in: text, range: remainingRange) else { break }

        let questionRange = Range(startMatch.range(at: 1), in: text)!
        let question = String(text[questionRange]).trimmingCharacters(in: .whitespacesAndNewlines)

        let optionsStartIdx = text.index(text.startIndex, offsetBy: afterStart)
        let optionsEndIdx = text.index(text.startIndex, offsetBy: endMatch.range.lowerBound)
        let optionsText = String(text[optionsStartIdx..<optionsEndIdx])
        let options = optionsText
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && !$0.hasPrefix("<!--") }

        if !options.isEmpty {
            blocks.append(Vibe80ChoicesBlock(
                question: question.isEmpty ? nil : question,
                options: options,
                startIndex: startMatch.range.lowerBound,
                endIndex: endMatch.range.upperBound
            ))
        }

        searchStart = endMatch.range.upperBound
    }

    return blocks
}

func removeVibe80Choices(_ text: String) -> String {
    let pattern = try! NSRegularExpression(
        pattern: #"<!--\s*vibe80:choices\s*.*?-->[\s\S]*?<!--\s*/vibe80:choices\s*-->"#,
        options: .caseInsensitive
    )
    return pattern.stringByReplacingMatches(
        in: text, range: NSRange(text.startIndex..., in: text), withTemplate: ""
    )
}

// MARK: - YesNo Parsing

func parseVibe80YesNo(_ text: String) -> [Vibe80YesNoBlock] {
    let pattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:yesno\s*(.*?)\s*-->"#, options: .caseInsensitive)
    let range = NSRange(text.startIndex..., in: text)

    return pattern.matches(in: text, range: range).map { match in
        let questionRange = Range(match.range(at: 1), in: text)!
        let question = String(text[questionRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        return Vibe80YesNoBlock(
            question: question.isEmpty ? nil : question,
            startIndex: match.range.lowerBound,
            endIndex: match.range.upperBound
        )
    }
}

func removeVibe80YesNo(_ text: String) -> String {
    let pattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:yesno\s*.*?\s*-->"#, options: .caseInsensitive)
    return pattern.stringByReplacingMatches(
        in: text, range: NSRange(text.startIndex..., in: text), withTemplate: ""
    )
}

func replaceVibe80YesNoWithQuestions(_ text: String) -> String {
    let pattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:yesno\s*(.*?)\s*-->"#, options: .caseInsensitive)
    let nsText = text as NSString
    var result = text
    // Replace in reverse to preserve indices
    for match in pattern.matches(in: text, range: NSRange(location: 0, length: nsText.length)).reversed() {
        let questionRange = match.range(at: 1)
        let question = nsText.substring(with: questionRange).trimmingCharacters(in: .whitespacesAndNewlines)
        let replacement = question.isEmpty ? "" : "\n\(question)\n"
        result = (result as NSString).replacingCharacters(in: match.range, with: replacement)
    }
    return result
}

// MARK: - Form Parsing

func parseVibe80Forms(_ text: String) -> [Vibe80FormBlock] {
    let startPattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:form\s+(.+?)\s*-->"#, options: .caseInsensitive)
    let endPattern = try! NSRegularExpression(pattern: #"<!--\s*/vibe80:form\s*-->"#, options: .caseInsensitive)

    var blocks: [Vibe80FormBlock] = []
    var searchStart = 0

    while searchStart < text.count {
        let searchRange = NSRange(location: searchStart, length: text.count - searchStart)
        guard let startMatch = startPattern.firstMatch(in: text, range: searchRange) else { break }
        let afterStart = startMatch.range.upperBound
        let remainingRange = NSRange(location: afterStart, length: text.count - afterStart)
        guard let endMatch = endPattern.firstMatch(in: text, range: remainingRange) else { break }

        let questionRange = Range(startMatch.range(at: 1), in: text)!
        let question = String(text[questionRange]).trimmingCharacters(in: .whitespacesAndNewlines)

        let fieldsStartIdx = text.index(text.startIndex, offsetBy: afterStart)
        let fieldsEndIdx = text.index(text.startIndex, offsetBy: endMatch.range.lowerBound)
        let fieldsText = String(text[fieldsStartIdx..<fieldsEndIdx])
        let fields = parseFormFields(fieldsText)

        if !fields.isEmpty {
            blocks.append(Vibe80FormBlock(
                question: question,
                fields: fields,
                startIndex: startMatch.range.lowerBound,
                endIndex: endMatch.range.upperBound
            ))
        }

        searchStart = endMatch.range.upperBound
    }

    return blocks
}

private func parseFormFields(_ text: String) -> [Vibe80FormField] {
    return text
        .components(separatedBy: "\n")
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty && !$0.hasPrefix("<!--") }
        .compactMap { line in
            let parts = line.components(separatedBy: "::")
            guard parts.count >= 3 else { return nil }

            let typeStr = parts[0].lowercased().trimmingCharacters(in: .whitespacesAndNewlines)
            guard let type = FieldType(rawValue: typeStr) else { return nil }

            let id = parts[1].trimmingCharacters(in: .whitespacesAndNewlines)
            let label = parts[2].trimmingCharacters(in: .whitespacesAndNewlines)
            let defaultOrChoices = parts.count > 3 ? parts[3].trimmingCharacters(in: .whitespacesAndNewlines) : ""

            let choices: [String]
            let defaultValue: String

            if type == .radio || type == .select {
                choices = parts.count > 3 ? Array(parts.dropFirst(3)).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } : []
                defaultValue = ""
            } else {
                choices = []
                defaultValue = defaultOrChoices
            }

            return Vibe80FormField(
                type: type,
                id: id,
                label: label,
                defaultValue: defaultValue,
                choices: choices
            )
        }
}

func removeVibe80Forms(_ text: String) -> String {
    let pattern = try! NSRegularExpression(
        pattern: #"<!--\s*vibe80:form\s+.+?\s*-->[\s\S]*?<!--\s*/vibe80:form\s*-->"#,
        options: .caseInsensitive
    )
    return pattern.stringByReplacingMatches(
        in: text, range: NSRange(text.startIndex..., in: text), withTemplate: ""
    )
}

func replaceVibe80FormsWithQuestions(_ text: String) -> String {
    let startPattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:form\s+(.+?)\s*-->"#, options: .caseInsensitive)
    let endPattern = try! NSRegularExpression(pattern: #"<!--\s*/vibe80:form\s*-->"#, options: .caseInsensitive)
    var result = text

    // Find and replace blocks in reverse
    var blocks: [(fullRange: NSRange, question: String)] = []
    var searchStart = 0
    let nsText = text as NSString

    while searchStart < nsText.length {
        let searchRange = NSRange(location: searchStart, length: nsText.length - searchStart)
        guard let startMatch = startPattern.firstMatch(in: text, range: searchRange) else { break }
        let afterStart = startMatch.range.upperBound
        let remainingRange = NSRange(location: afterStart, length: nsText.length - afterStart)
        guard let endMatch = endPattern.firstMatch(in: text, range: remainingRange) else { break }

        let question = nsText.substring(with: startMatch.range(at: 1))
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let fullRange = NSRange(
            location: startMatch.range.lowerBound,
            length: endMatch.range.upperBound - startMatch.range.lowerBound
        )
        blocks.append((fullRange, question))
        searchStart = endMatch.range.upperBound
    }

    for block in blocks.reversed() {
        result = (result as NSString).replacingCharacters(in: block.fullRange, with: "\n\(block.question)\n")
    }

    return result
}

func formatFormResponse(_ formData: [String: String], _ fields: [Vibe80FormField]) -> String {
    return fields.compactMap { field in
        let value = formData[field.id]
        guard let value, !value.isEmpty, value != "false" else { return nil }
        switch field.type {
        case .checkbox:
            return value == "true" ? field.label : nil
        default:
            return "\(field.label): \(value)"
        }
    }.joined(separator: "\n")
}

// MARK: - FileRef Parsing

func parseVibe80FileRefs(_ text: String) -> [String] {
    let pattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:fileref\s+([^>]+?)\s*-->"#, options: .caseInsensitive)
    let range = NSRange(text.startIndex..., in: text)

    return pattern.matches(in: text, range: range).compactMap { match in
        guard let captureRange = Range(match.range(at: 1), in: text) else { return nil }
        let path = String(text[captureRange]).trimmingCharacters(in: .whitespacesAndNewlines)
        return path.isEmpty ? nil : path
    }
}

func removeVibe80FileRefs(_ text: String) -> String {
    let pattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:fileref\s+[^>]+?\s*-->"#, options: .caseInsensitive)
    return pattern.stringByReplacingMatches(
        in: text, range: NSRange(text.startIndex..., in: text), withTemplate: ""
    )
}

// MARK: - Task Parsing

func parseVibe80Task(_ text: String) -> String? {
    let pattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:task\s+(.+?)\s*-->"#, options: .caseInsensitive)
    let range = NSRange(text.startIndex..., in: text)
    guard let match = pattern.firstMatch(in: text, range: range),
          let captureRange = Range(match.range(at: 1), in: text) else { return nil }
    return String(text[captureRange]).trimmingCharacters(in: .whitespacesAndNewlines)
}

func removeVibe80Task(_ text: String) -> String {
    let pattern = try! NSRegularExpression(pattern: #"<!--\s*vibe80:task\s+.+?\s*-->"#, options: .caseInsensitive)
    return pattern.stringByReplacingMatches(
        in: text, range: NSRange(text.startIndex..., in: text), withTemplate: ""
    )
}

// MARK: - Clean All Blocks

func cleanVibe80Blocks(_ text: String, formsSubmitted: Bool, yesNoSubmitted: Bool) -> String {
    var result = stripAttachmentSuffix(text)
    result = removeVibe80Choices(result)
    result = removeVibe80FileRefs(result)
    result = removeVibe80Task(result)

    if formsSubmitted {
        result = replaceVibe80FormsWithQuestions(result)
    } else {
        result = removeVibe80Forms(result)
    }

    if yesNoSubmitted {
        result = replaceVibe80YesNoWithQuestions(result)
    } else {
        result = removeVibe80YesNo(result)
    }

    return result.trimmingCharacters(in: .whitespacesAndNewlines)
}
