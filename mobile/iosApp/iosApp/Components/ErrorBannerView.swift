import SwiftUI
import Shared

struct ErrorBannerView: View {
    let error: AppError
    let onDismiss: () -> Void

    private var errorMessage: String {
        let type = error.type
        let prefix: String
        switch type {
        case .websocket:
            prefix = NSLocalizedString("error.websocket", comment: "WebSocket error")
        case .network:
            prefix = NSLocalizedString("error.network", comment: "Network error")
        case .upload:
            prefix = NSLocalizedString("error.upload", comment: "Upload error")
        case .sendMessage:
            prefix = NSLocalizedString("error.send_message", comment: "Send error")
        case .providerSwitch:
            prefix = NSLocalizedString("error.provider_switch", comment: "Provider error")
        case .worktree:
            prefix = NSLocalizedString("error.worktree", comment: "Worktree error")
        default:
            prefix = NSLocalizedString("error.unknown", comment: "Error")
        }
        return "\(prefix): \(error.message)"
    }

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.white)
                .font(.subheadline)

            Text(errorMessage)
                .font(.subheadline)
                .foregroundColor(.white)
                .lineLimit(3)

            Spacer(minLength: 8)

            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white.opacity(0.8))
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(Color.red.opacity(0.9))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.2), radius: 8, y: 4)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
    }
}
