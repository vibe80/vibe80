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

    static func vibe80FaSolid(_ size: CGFloat) -> Font {
        .custom("Font Awesome 6 Free Solid", size: size)
    }

    static func vibe80FaRegular(_ size: CGFloat) -> Font {
        .custom("Font Awesome 6 Free Regular", size: size)
    }
}

enum FaWeight {
    case solid
    case regular
}

enum FaGlyph {
    case plus
    case terminal
    case codeBranch
    case message
    case arrowDown
    case arrowUp
    case cpu
    case diff
    case logout
    case back
    case camera
    case image
    case file
    case close
    case send
    case warning
    case checkCircle
    case check
    case eye
    case eyeSlash
    case ellipsisVertical
    case code
    case chevronUp
    case chevronDown
    case minus
    case pen
    case arrowRight
    case circleQuestion

    var value: String {
        switch self {
        case .plus: return "\u{f067}"
        case .terminal: return "\u{f120}"
        case .codeBranch: return "\u{f126}"
        case .message: return "\u{f27a}"
        case .arrowDown: return "\u{f063}"
        case .arrowUp: return "\u{f062}"
        case .cpu: return "\u{f2db}"
        case .diff: return "\u{f362}"
        case .logout: return "\u{f2f5}"
        case .back: return "\u{f060}"
        case .camera: return "\u{f030}"
        case .image: return "\u{f03e}"
        case .file: return "\u{f15b}"
        case .close: return "\u{f00d}"
        case .send: return "\u{f1d8}"
        case .warning: return "\u{f071}"
        case .checkCircle: return "\u{f058}"
        case .check: return "\u{f00c}"
        case .eye: return "\u{f06e}"
        case .eyeSlash: return "\u{f070}"
        case .ellipsisVertical: return "\u{f142}"
        case .code: return "\u{f121}"
        case .chevronUp: return "\u{f077}"
        case .chevronDown: return "\u{f078}"
        case .minus: return "\u{f068}"
        case .pen: return "\u{f304}"
        case .arrowRight: return "\u{f061}"
        case .circleQuestion: return "\u{f059}"
        }
    }
}

struct FaIconView: View {
    let glyph: FaGlyph
    var size: CGFloat = 16
    var color: Color? = nil
    var weight: FaWeight = .solid

    var body: some View {
        Text(glyph.value)
            .font(weight == .regular ? .vibe80FaRegular(size) : .vibe80FaSolid(size))
            .foregroundColor(color ?? .primary)
    }
}
