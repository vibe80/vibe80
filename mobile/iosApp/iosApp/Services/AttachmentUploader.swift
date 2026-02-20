import Foundation
import Shared

enum AttachmentUploadError: Error {
    case invalidBaseUrl
    case serverError(statusCode: Int, message: String)
    case invalidResponse
}

final class AttachmentUploader {
    private let baseUrl: URL
    private let workspaceTokenKey = "workspaceToken"

    init?(baseUrl: String) {
        guard let url = URL(string: baseUrl) else { return nil }
        self.baseUrl = url
    }

    func uploadAttachments(sessionId: String, attachments: [PendingAttachment]) async throws -> [Attachment] {
        guard !attachments.isEmpty else { return [] }
        guard let url = uploadURL(sessionId: sessionId) else {
            throw AttachmentUploadError.invalidBaseUrl
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        if let token = workspaceToken(), !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        request.httpBody = try buildBody(with: attachments, boundary: boundary)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AttachmentUploadError.invalidResponse
        }

        let responseBody = String(data: data, encoding: .utf8) ?? ""
        guard (200...299).contains(httpResponse.statusCode) else {
            throw AttachmentUploadError.serverError(statusCode: httpResponse.statusCode, message: responseBody)
        }

        let uploadResponse = try JSONDecoder().decode(UploadResponse.self, from: data)
        return uploadResponse.files.map { file in
            Attachment(
                name: file.name,
                path: file.path,
                size: file.size.map { KotlinLong(long: $0) },
                mimeType: nil
            )
        }
    }

    private func uploadURL(sessionId: String) -> URL? {
        guard var components = URLComponents(url: baseUrl, resolvingAgainstBaseURL: false) else {
            return nil
        }
        let pathSegments = [
            components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")),
            "api",
            "v1",
            "sessions",
            sessionId,
            "attachments",
            "upload"
        ].filter { !$0.isEmpty }

        components.path = "/" + pathSegments.joined(separator: "/")
        return components.url
    }

    private func buildBody(with attachments: [PendingAttachment], boundary: String) throws -> Data {
        var body = Data()
        for attachment in attachments {
            body.appendString("--\(boundary)\r\n")
            let safeName = attachment.name.replacingOccurrences(of: "\"", with: "")
            body.appendString("Content-Disposition: form-data; name=\"files\"; filename=\"\(safeName)\"\r\n")
            let mimeType = attachment.mimeType.isEmpty ? "application/octet-stream" : attachment.mimeType
            body.appendString("Content-Type: \(mimeType)\r\n\r\n")
            body.append(attachment.data)
            body.appendString("\r\n")
        }
        body.appendString("--\(boundary)--\r\n")
        return body
    }

    private func workspaceToken() -> String? {
        UserDefaults.standard.string(forKey: workspaceTokenKey)
    }

    private struct UploadResponse: Decodable {
        struct File: Decodable {
            let name: String
            let path: String
            let size: Int64?
        }
        let files: [File]
    }
}

private extension Data {
    mutating func appendString(_ string: String) {
        if let data = string.data(using: .utf8) {
            append(data)
        }
    }
}
