import SwiftUI
import AVFoundation

struct QrScanView: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject var viewModel: SessionViewModel
    @State private var hasPermission: Bool = false
    @State private var scanEnabled: Bool = true

    var body: some View {
        ZStack {
            Color.vibe80Background.ignoresSafeArea()

            if hasPermission {
                QRScannerView(isScanning: $scanEnabled) { payload in
                    guard scanEnabled else { return }
                    scanEnabled = false
                    viewModel.consumeHandoffPayload(payload, appState: appState)
                }
                .ignoresSafeArea()

                VStack {
                    HStack {
                        Button {
                            viewModel.closeQrScan()
                        } label: {
                            FaIconView(glyph: .back, size: 16, color: .vibe80Ink)
                        }
                        Spacer()
                        Text("qr.scan.title")
                            .font(.headline)
                            .foregroundColor(.vibe80Ink)
                        Spacer()
                        Spacer().frame(width: 24)
                    }
                    .padding(.horizontal, 20)
                    .padding(.top, 12)

                    Spacer()

                    if viewModel.handoffBusy {
                        ProgressView("session.resuming")
                            .padding()
                            .background(Color.vibe80Surface)
                            .cornerRadius(16)
                    }

                    if let error = viewModel.handoffError {
                        VStack(spacing: 12) {
                            Text(error)
                                .foregroundColor(.red)
                                .multilineTextAlignment(.center)
                            Button("action.resume") {
                                viewModel.handoffError = nil
                                scanEnabled = true
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.vibe80Accent)
                        }
                        .padding()
                        .background(Color.vibe80Surface)
                        .cornerRadius(16)
                        .padding(.bottom, 32)
                    }
                }
            } else {
                VStack(spacing: 16) {
                    FaIconView(glyph: .camera, size: 48, color: .vibe80Accent)
                    Text("qr.camera.permission")
                        .multilineTextAlignment(.center)
                        .foregroundColor(.vibe80Ink)
                    Button("action.continue") {
                        requestCameraPermission()
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.vibe80Accent)
                }
                .padding()
            }
        }
        .onAppear(perform: requestCameraPermission)
    }

    private func requestCameraPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            hasPermission = true
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    hasPermission = granted
                }
            }
        default:
            hasPermission = false
        }
    }
}

struct QRScannerView: UIViewRepresentable {
    @Binding var isScanning: Bool
    let onCodeScanned: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UIView {
        let view = UIView(frame: .zero)
        context.coordinator.startSession(on: view)
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        if !isScanning {
            context.coordinator.stopSession()
        } else {
            context.coordinator.resumeSession(on: uiView)
        }
    }

    static func dismantleUIView(_ uiView: UIView, coordinator: Coordinator) {
        coordinator.stopSession()
    }

    class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let parent: QRScannerView
        private let session = AVCaptureSession()
        private var previewLayer: AVCaptureVideoPreviewLayer?
        private var hasScanned = false

        init(parent: QRScannerView) {
            self.parent = parent
            super.init()
        }

        func startSession(on view: UIView) {
            guard previewLayer == nil else { return }
            guard let device = AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device) else {
                return
            }

            if session.inputs.isEmpty {
                session.addInput(input)
            }

            let output = AVCaptureMetadataOutput()
            if session.outputs.isEmpty, session.canAddOutput(output) {
                session.addOutput(output)
            }

            output.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
            output.metadataObjectTypes = [.qr]

            let previewLayer = AVCaptureVideoPreviewLayer(session: session)
            previewLayer.videoGravity = .resizeAspectFill
            previewLayer.frame = view.bounds
            view.layer.sublayers?.forEach { $0.removeFromSuperlayer() }
            view.layer.addSublayer(previewLayer)
            self.previewLayer = previewLayer

            session.startRunning()
        }

        func resumeSession(on view: UIView) {
            hasScanned = false
            if previewLayer == nil {
                startSession(on: view)
            } else {
                previewLayer?.frame = view.bounds
                if !session.isRunning {
                    session.startRunning()
                }
            }
        }

        func stopSession() {
            if session.isRunning {
                session.stopRunning()
            }
        }

        func metadataOutput(
            _ output: AVCaptureMetadataOutput,
            didOutput metadataObjects: [AVMetadataObject],
            from connection: AVCaptureConnection
        ) {
            guard !hasScanned,
                  let metadataObject = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  metadataObject.type == .qr,
                  let stringValue = metadataObject.stringValue else {
                return
            }
            hasScanned = true
            parent.onCodeScanned(stringValue)
        }
    }
}
