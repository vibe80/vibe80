import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import shared

struct ComposerView: View {
    @Binding var text: String
    let isLoading: Bool
    let actionMode: ComposerActionMode
    let activeModel: String?
    let availableModels: [ProviderModel]
    let onSend: () -> Void
    let onSelectActionMode: (ComposerActionMode) -> Void
    let onSelectModel: (String) -> Void
    let onFocusChanged: (Bool) -> Void

    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var pendingAttachments: [PendingAttachment] = []
    @State private var showPhotoPicker = false
    @State private var showFileImporter = false
    @State private var showCameraPicker = false
    @State private var cameraImage: UIImage?
    @FocusState private var isFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            Divider()

            if !pendingAttachments.isEmpty {
                attachmentsPreview
            }

            HStack(alignment: .bottom, spacing: 4) {
                Menu {
                    Section("action.add") {
                        Button {
                            showCameraPicker = true
                        } label: {
                            Label("composer.camera", systemImage: "camera")
                        }

                        Button {
                            showPhotoPicker = true
                        } label: {
                            Label("composer.photos", systemImage: "photo")
                        }

                        Button {
                            showFileImporter = true
                        } label: {
                            Label("composer.files", systemImage: "doc")
                        }
                    }

                    Section("composer.model") {
                        Menu {
                            if availableModels.isEmpty {
                                Text("composer.model.unavailable")
                            } else {
                                ForEach(availableModels, id: \.id) { model in
                                    Button {
                                        onSelectModel(model.model)
                                    } label: {
                                        let label = model.displayName ?? model.model
                                        if activeModel == model.model {
                                            Label(label, systemImage: "checkmark")
                                        } else {
                                            Text(label)
                                        }
                                    }
                                }
                            }
                        } label: {
                            Label(activeModel ?? NSLocalizedString("composer.model.unavailable", comment: ""), systemImage: "sparkles")
                        }
                    }

                    Section("composer.action.section") {
                        actionModeButton(.llm, title: "composer.action.llm")
                        actionModeButton(.shell, title: "composer.action.shell")
                        actionModeButton(.git, title: "composer.action.git")
                    }
                } label: {
                    Group {
                        switch actionMode {
                        case .llm:
                            Image(systemName: "plus")
                        case .shell:
                            Image(systemName: "terminal")
                        case .git:
                            Image(systemName: "point.3.connected")
                        }
                    }
                    .font(.title3)
                    .foregroundColor(.vibe80Accent)
                    .frame(width: 28, height: 28)
                }

                TextField("composer.message.placeholder", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .focused($isFocused)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                    .background(Color.vibe80SurfaceElevated)
                    .cornerRadius(16)

                Button(action: sendMessage) {
                    Image(systemName: isLoading ? "stop.fill" : "arrow.up.circle.fill")
                        .font(.title2)
                        .foregroundColor(canSend ? .vibe80Accent : .vibe80InkMuted)
                }
                .disabled(!canSend && !isLoading)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .background(Color.vibe80Surface)
        }
        .photosPicker(
            isPresented: $showPhotoPicker,
            selection: $selectedItems,
            maxSelectionCount: 5,
            matching: .images
        )
        .onChange(of: selectedItems) { items in
            handleSelectedItems(items)
        }
        .fileImporter(
            isPresented: $showFileImporter,
            allowedContentTypes: [.image, .pdf, .data],
            allowsMultipleSelection: true
        ) { result in
            handleImportedFiles(result)
        }
        .sheet(isPresented: $showCameraPicker) {
            ImagePicker(sourceType: .camera, selectedImage: $cameraImage)
        }
        .onChange(of: cameraImage) { image in
            guard let image else { return }
            addImageAttachment(image)
            cameraImage = nil
        }
        .onChange(of: isFocused) { focused in
            onFocusChanged(focused)
        }
    }

    private func actionModeButton(_ mode: ComposerActionMode, title: String) -> some View {
        Button {
            onSelectActionMode(mode)
        } label: {
            HStack {
                Image(systemName: actionModeSymbol(mode))
                Text(title)
                if actionMode == mode {
                    Image(systemName: "checkmark")
                }
            }
        }
    }

    private func actionModeSymbol(_ mode: ComposerActionMode) -> String {
        switch mode {
        case .llm: return "message"
        case .shell: return "terminal"
        case .git: return "point.3.connected"
        }
    }

    private var canSend: Bool {
        if actionMode == .llm {
            return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingAttachments.isEmpty
        }
        return !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var attachmentsPreview: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(pendingAttachments) { attachment in
                    attachmentChip(attachment)
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
        }
        .background(Color.vibe80BackgroundStrong)
    }

    private func attachmentChip(_ attachment: PendingAttachment) -> some View {
        HStack(spacing: 4) {
            if let image = attachment.thumbnail {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: 24, height: 24)
                    .cornerRadius(4)
            } else {
                Image(systemName: attachment.icon)
                    .font(.caption)
            }

            Text(attachment.name)
                .font(.caption)
                .lineLimit(1)

            Button {
                removeAttachment(attachment)
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(Color.vibe80Surface)
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.1), radius: 2)
    }

    private func sendMessage() {
        if isLoading {
            return
        }

        guard canSend else { return }

        pendingAttachments.removeAll()
        selectedItems.removeAll()

        onSend()
    }

    private func handleSelectedItems(_ items: [PhotosPickerItem]) {
        Task {
            for item in items {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    let name = "attachment_\(Date().timeIntervalSince1970)"
                    let thumbnail = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 48, height: 48))

                    let attachment = PendingAttachment(
                        id: UUID(),
                        name: name,
                        data: data,
                        thumbnail: thumbnail,
                        mimeType: item.supportedContentTypes.first?.preferredMIMEType ?? "application/octet-stream"
                    )

                    await MainActor.run {
                        pendingAttachments.append(attachment)
                    }
                }
            }
        }
    }

    private func handleImportedFiles(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            Task {
                for url in urls {
                    guard let data = try? Data(contentsOf: url) else { continue }
                    let name = url.lastPathComponent
                    let mimeType = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType
                        ?? "application/octet-stream"
                    let thumbnail = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 48, height: 48))
                    let attachment = PendingAttachment(
                        id: UUID(),
                        name: name,
                        data: data,
                        thumbnail: thumbnail,
                        mimeType: mimeType
                    )
                    await MainActor.run {
                        pendingAttachments.append(attachment)
                    }
                }
            }
        case .failure:
            break
        }
    }

    private func addImageAttachment(_ image: UIImage) {
        guard let data = image.jpegData(compressionQuality: 0.9) else { return }
        let name = "photo_\(Date().timeIntervalSince1970).jpg"
        let thumbnail = image.preparingThumbnail(of: CGSize(width: 48, height: 48))
        let attachment = PendingAttachment(
            id: UUID(),
            name: name,
            data: data,
            thumbnail: thumbnail,
            mimeType: "image/jpeg"
        )
        pendingAttachments.append(attachment)
    }

    private func removeAttachment(_ attachment: PendingAttachment) {
        pendingAttachments.removeAll { $0.id == attachment.id }
    }
}

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

#Preview {
    VStack {
        Spacer()
        ComposerView(
            text: .constant(""),
            isLoading: false,
            actionMode: .llm,
            activeModel: nil,
            availableModels: [],
            onSend: {},
            onSelectActionMode: { _ in },
            onSelectModel: { _ in },
            onFocusChanged: { _ in }
        )
    }
}
