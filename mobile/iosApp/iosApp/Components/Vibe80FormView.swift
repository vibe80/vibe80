import SwiftUI

struct Vibe80FormView: View {
    let block: Vibe80FormBlock
    let onFormSubmit: ([String: String], [Vibe80FormField]) -> Void

    @State private var formData: [String: String] = [:]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(block.question)
                .font(.subheadline.weight(.medium))
                .foregroundColor(.vibe80Ink)

            ForEach(block.fields, id: \.id) { field in
                fieldView(for: field)
            }

            Button {
                onFormSubmit(formData, block.fields)
            } label: {
                Text("action.send")
                    .font(.subheadline.weight(.medium))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 10)
                    .background(Color.vibe80Accent)
                    .foregroundColor(.white)
                    .cornerRadius(10)
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 6)
        .onAppear {
            // Initialize default values
            for field in block.fields {
                if formData[field.id] == nil {
                    switch field.type {
                    case .checkbox:
                        formData[field.id] = "false"
                    case .radio, .select:
                        formData[field.id] = field.choices.first ?? ""
                    default:
                        formData[field.id] = field.defaultValue
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func fieldView(for field: Vibe80FormField) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            switch field.type {
            case .input:
                Text(field.label)
                    .font(.caption)
                    .foregroundColor(.vibe80InkMuted)
                TextField("", text: fieldBinding(field.id))
                    .textFieldStyle(.roundedBorder)

            case .textarea:
                Text(field.label)
                    .font(.caption)
                    .foregroundColor(.vibe80InkMuted)
                TextEditor(text: fieldBinding(field.id))
                    .frame(minHeight: 60, maxHeight: 120)
                    .padding(4)
                    .background(Color.vibe80SurfaceElevated)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                    )

            case .radio:
                Text(field.label)
                    .font(.caption)
                    .foregroundColor(.vibe80InkMuted)
                ForEach(field.choices, id: \.self) { choice in
                    Button {
                        formData[field.id] = choice
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: formData[field.id] == choice ? "circle.inset.filled" : "circle")
                                .foregroundColor(formData[field.id] == choice ? .vibe80Accent : .vibe80InkMuted)
                                .font(.subheadline)
                            Text(choice)
                                .font(.subheadline)
                                .foregroundColor(.vibe80Ink)
                        }
                    }
                    .buttonStyle(.plain)
                }

            case .select:
                Text(field.label)
                    .font(.caption)
                    .foregroundColor(.vibe80InkMuted)
                Picker("", selection: fieldBinding(field.id)) {
                    ForEach(field.choices, id: \.self) { choice in
                        Text(choice).tag(choice)
                    }
                }
                .pickerStyle(.menu)
                .tint(.vibe80Accent)

            case .checkbox:
                Toggle(isOn: Binding(
                    get: { formData[field.id] == "true" },
                    set: { formData[field.id] = $0 ? "true" : "false" }
                )) {
                    Text(field.label)
                        .font(.subheadline)
                        .foregroundColor(.vibe80Ink)
                }
                .toggleStyle(SwitchToggleStyle(tint: .vibe80Accent))
            }
        }
    }

    private func fieldBinding(_ id: String) -> Binding<String> {
        Binding(
            get: { formData[id] ?? "" },
            set: { formData[id] = $0 }
        )
    }
}
