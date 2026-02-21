import UIKit

struct PendingAttachment: Identifiable {
    let id: UUID
    let name: String
    let data: Data
    let thumbnail: UIImage?
    let mimeType: String

    var icon: String {
        if mimeType.hasPrefix("image/") {
            return "photo"
        } else if mimeType == "application/pdf" {
            return "doc.fill"
        } else {
            return "doc"
        }
    }
}
