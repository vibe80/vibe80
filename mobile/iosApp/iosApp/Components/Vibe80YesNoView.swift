import SwiftUI

struct Vibe80YesNoView: View {
    let block: Vibe80YesNoBlock
    let onOptionSelected: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let question = block.question {
                Text(question)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.vibe80Ink)
            }

            HStack(spacing: 12) {
                Button {
                    onOptionSelected(NSLocalizedString("action.yes", comment: "Yes"))
                } label: {
                    Text("action.yes")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.vibe80Accent)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
                .buttonStyle(.plain)

                Button {
                    onOptionSelected(NSLocalizedString("action.no", comment: "No"))
                } label: {
                    Text("action.no")
                        .font(.subheadline.weight(.medium))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(Color.vibe80SurfaceElevated)
                        .foregroundColor(.vibe80Ink)
                        .cornerRadius(10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.vibe80BorderSoft.opacity(0.3), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 6)
    }
}
