import Foundation
import UserNotifications
import UIKit

class NotificationManager: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationManager()

    @Published var isAuthorized = false

    override private init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { [weak self] granted, _ in
            DispatchQueue.main.async {
                self?.isAuthorized = granted
            }
        }
    }

    func notifyMessage(title: String, body: String, sessionId: String?, worktreeId: String?) {
        // Only notify when app is not active
        guard UIApplication.shared.applicationState != .active else { return }
        guard isAuthorized else { return }

        let content = UNMutableNotificationContent()
        content.title = title
        content.body = sanitizeForNotification(body, maxLength: 180)
        content.sound = .default

        var userInfo: [String: String] = [:]
        if let sessionId { userInfo["sessionId"] = sessionId }
        if let worktreeId { userInfo["worktreeId"] = worktreeId }
        content.userInfo = userInfo

        let request = UNNotificationRequest(
            identifier: UUID().uuidString,
            content: content,
            trigger: nil
        )

        UNUserNotificationCenter.current().add(request)
    }

    private func sanitizeForNotification(_ text: String, maxLength: Int) -> String {
        // Strip markdown and vibe80 blocks
        var cleaned = text
            .replacingOccurrences(of: #"```[\s\S]*?```"#, with: "[code]", options: .regularExpression)
            .replacingOccurrences(of: #"<!--.*?-->"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\*\*(.*?)\*\*"#, with: "$1", options: .regularExpression)
            .replacingOccurrences(of: #"`(.*?)`"#, with: "$1", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        if cleaned.count > maxLength {
            cleaned = String(cleaned.prefix(maxLength)) + "..."
        }
        return cleaned
    }

    // MARK: - UNUserNotificationCenterDelegate

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Don't show notification when app is active
        completionHandler([])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // User tapped notification — app will open to current state
        completionHandler()
    }
}
