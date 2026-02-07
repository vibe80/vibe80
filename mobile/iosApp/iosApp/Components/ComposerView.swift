import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

struct ComposerView: View {
    @Binding var text: String
    let isLoading: Bool
    let onSend: () -> Void

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

            // Pending attachments
            if !pendingAttachments.isEmpty {
                attachmentsPreview
            }

            // Input row
            HStack(alignment: .bottom, spacing: 8) {
                Menu {
                    Button {
                        showCameraPicker = true
                    } label: {
                        Label("Caméra", systemImage: "camera")
                    }

                    Button {
                        showPhotoPicker = true
                    } label: {
                        Label("Photos", systemImage: "photo")
                    }

                    Button {
                        showFileImporter = true
                    } label: {
                        Label("Fichiers", systemImage: "doc")
                    }

                    Button {
                        // no-op
                    } label: {
                        Label("Modèle", systemImage: "sparkles")
                    }
                    .disabled(true)
                } label: {
                    Image(systemName: "plus.circle.fill")
                        .font(.title2)
                        .foregroundColor(.blue)
                }

                // Text input
                TextField("Message...", text: $text, axis: .vertical)
                    .textFieldStyle(.plain)
                    .lineLimit(1...5)
                    .focused($isFocused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(.systemGray6))
                    .cornerRadius(20)

                // Send button
                Button(action: sendMessage) {
                    Image(systemName: isLoading ? "stop.fill" : "arrow.up.circle.fill")
                        .font(.title)
                        .foregroundColor(canSend ? .blue : .gray)
                }
                .disabled(!canSend && !isLoading)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
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
    }

    // MARK: - Computed

    private var canSend: Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !pendingAttachments.isEmpty
    }

    // MARK: - Attachments Preview

    private var attachmentsPreview: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(pendingAttachments) { attachment in
                    attachmentChip(attachment)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(Color(.systemGray6).opacity(0.5))
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
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.1), radius: 2)
    }

    // MARK: - Actions

    private func sendMessage() {
        if isLoading {
            // TODO: Cancel current request
            return
        }

        guard canSend else { return }

        // TODO: Include pendingAttachments in the message
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

// MARK: - Pending Attachment Model

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

// MARK: - Preview

#Preview {
    VStack {
        Spacer()
        ComposerView(
            text: .constant(""),
            isLoading: false,
            onSend: {}
        )
    }
}

#Preview("With Text") {
    VStack {
        Spacer()
        ComposerView(
            text: .constant("Hello world"),
            isLoading: false,
            onSend: {}
        )
    }
}

#Preview("Loading") {
    VStack {
        Spacer()
        ComposerView(
            text: .constant(""),
            isLoading: true,
            onSend: {}
        )
    }
}
