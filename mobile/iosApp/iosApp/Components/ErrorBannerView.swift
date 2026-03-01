import SwiftUI
import Shared

struct ErrorBannerView: View {
    let error: AppError
    let onDismiss: () -> Void

    private var bannerColor: Color {
        switch error.type {
        case .websocket:
            return Color.orange
        case .network:
            return Color.red
        case .upload:
            return Color.purple
        case .sendMessage:
            return Color.yellow
        case .providerSwitch, .worktree:
            return Color.blue
        default:
            return Color.gray
        }
    }

    private var iconName: String {
        switch error.type {
        case .websocket:
            return "wifi.exclamationmark"
        case .network:
            return "exclamationmark.triangle.fill"
        case .upload:
            return "arrow.up.doc.fill"
        case .sendMessage:
            return "paperplane"
        case .providerSwitch:
            return "cpu"
        case .worktree:
            return "folder.badge.minus"
        default:
            return "questionmark.circle"
        }
    }

    private var errorMessage: String {
        let prefix = NSLocalizedString("error.\(error.type.name.lowercased())", comment: "Error prefix")
        return "\(prefix): \(error.message)"
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName)
                .foregroundColor(.white)
                .font(.subheadline)

            VStack(alignment: .leading, spacing: 4) {
                Text(errorMessage)
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .lineLimit(3)

                if let details = error.details, !details.isEmpty {
                    Text(details)
                        .font(.caption2)
                        .foregroundColor(.white.opacity(0.8))
                        .lineLimit(2)
                }
            }

            Spacer(minLength: 8)

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white.opacity(0.8))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(bannerColor.opacity(0.95))
        .cornerRadius(12)
        .shadow(color: bannerColor.opacity(0.4), radius: 6, y: 3)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}
