import SwiftUI
import UIKit

extension UIColor {
    convenience init?(hex: String) {
        var hexSanitized = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        hexSanitized = hexSanitized.replacingOccurrences(of: "#", with: "")

        var rgb: UInt64 = 0

        guard Scanner(string: hexSanitized).scanHexInt64(&rgb) else {
            return nil
        }

        let r = CGFloat((rgb & 0xFF0000) >> 16) / 255.0
        let g = CGFloat((rgb & 0x00FF00) >> 8) / 255.0
        let b = CGFloat(rgb & 0x0000FF) / 255.0

        self.init(red: r, green: g, blue: b, alpha: 1.0)
    }
}

extension Color {
    private static func vibe80Dynamic(light: String, dark: String) -> Color {
        let lightColor = UIColor(hex: light) ?? .white
        let darkColor = UIColor(hex: dark) ?? .black
        return Color(
            UIColor { traitCollection in
                traitCollection.userInterfaceStyle == .dark ? darkColor : lightColor
            }
        )
    }

    static let vibe80Background = vibe80Dynamic(light: "#F5F2EA", dark: "#0E0F0E")
    static let vibe80BackgroundStrong = vibe80Dynamic(light: "#EFE9DC", dark: "#171A18")
    static let vibe80Surface = vibe80Dynamic(light: "#FFFFFF", dark: "#171A19")
    static let vibe80SurfaceElevated = vibe80Dynamic(light: "#FFFFFF", dark: "#1F2321")
    static let vibe80Ink = vibe80Dynamic(light: "#141311", dark: "#F2EDE3")
    static let vibe80InkMuted = vibe80Dynamic(light: "#4B463F", dark: "#B7ADA1")
    static let vibe80Accent = vibe80Dynamic(light: "#EE5D3B", dark: "#EE5D3B")
    static let vibe80AccentDark = vibe80Dynamic(light: "#B43C24", dark: "#D9573C")
    static let vibe80BorderSoft = vibe80Dynamic(light: "#141311", dark: "#FFFFFF")
}

extension View {
    func vibe80CardStyle() -> some View {
        self
            .padding()
            .background(Color.vibe80Surface)
            .cornerRadius(20)
            .shadow(color: .black.opacity(0.1), radius: 12, y: 6)
    }
}

extension Font {
    static func vibe80SpaceMono(_ textStyle: UIFont.TextStyle) -> Font {
        let size = UIFont.preferredFont(forTextStyle: textStyle).pointSize
        return .custom("SpaceMono-Regular", size: size)
    }
}
