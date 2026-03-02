import SwiftUI

struct FileSheetView: View {
    let path: String
    let content: String
    let isLoading: Bool
    let error: String?
    let isBinary: Bool
    let isTruncated: Bool

    @Environment(\.dismiss) private var dismiss

    private var fileName: String {
        (path as NSString).lastPathComponent
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    VStack(spacing: 12) {
                        ProgressView()
                        Text("file.loading")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.title)
                            .foregroundColor(.red)
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if isBinary {
                    VStack(spacing: 12) {
                        Image(systemName: "doc.fill")
                            .font(.title)
                            .foregroundColor(.secondary)
                        Text("file.binary")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    GeometryReader { geometry in
                        ScrollView([.horizontal, .vertical]) {
                            Text(verbatim: content)
                                .font(.vibe80SpaceMono(.caption1))
                                .foregroundColor(.vibe80Ink)
                                .textSelection(.enabled)
                                .multilineTextAlignment(.leading)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .frame(
                                    minWidth: geometry.size.width,
                                    minHeight: geometry.size.height,
                                    alignment: .topLeading
                                )
                                .padding(12)
                        }
                    }
                }
            }
            .background(Color.vibe80Background)
            .navigationTitle(fileName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    HStack(spacing: 12) {
                        if isTruncated {
                            Text("file.truncated")
                                .font(.caption2)
                                .foregroundColor(.orange)
                        }

                        Button {
                            UIPasteboard.general.string = content
                        } label: {
                            Image(systemName: "doc.on.doc")
                        }
                        .disabled(content.isEmpty)

                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }
        }
    }
}
