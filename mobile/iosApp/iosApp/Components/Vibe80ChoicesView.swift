import SwiftUI

struct Vibe80ChoicesView: View {
    let block: Vibe80ChoicesBlock
    let onOptionSelected: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let question = block.question {
                Text(question)
                    .font(.subheadline.weight(.medium))
                    .foregroundColor(.vibe80Ink)
            }

            ForEach(block.options, id: \.self) { option in
                Button {
                    onOptionSelected(option)
                } label: {
                    Text(option)
                        .font(.subheadline)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(Color.vibe80SurfaceElevated)
                        .foregroundColor(.vibe80Ink)
                        .cornerRadius(10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .stroke(Color.vibe80Accent.opacity(0.4), lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 6)
    }
}
