import SwiftUI
import UniformTypeIdentifiers
import UIKit
import Shared

struct SessionView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.colorScheme) private var colorScheme
    @StateObject private var viewModel = SessionViewModel()
    @State private var showWorkspaceSecret = false
    @State private var showHttpPassword = false
    @State private var showProviderSecrets = false
    @State private var showAuthJsonPicker = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.vibe80Background.ignoresSafeArea()

                switch viewModel.entryScreen {
                case .workspaceMode:
                    workspaceModeSelection
                case .workspaceCredentials:
                    workspaceCredentials
                case .providerConfig:
                    providerConfig
                case .workspaceCreated:
                    workspaceCreated
                case .joinSession:
                    joinSession
                case .startSession:
                    startSession
                case .qrScan:
                    QrScanView(viewModel: viewModel)
                }
            }
            .navigationBarHidden(true)
        }
        .fileImporter(
            isPresented: $showAuthJsonPicker,
            allowedContentTypes: [.json, .plainText]
        ) { result in
            guard case let .success(url) = result else { return }
            if let data = try? Data(contentsOf: url),
               let content = String(data: data, encoding: .utf8) {
                viewModel.updateProviderAuthValue("codex", authValue: content)
            }
        }
    }

    private var workspaceModeSelection: some View {
        ScrollView {
            VStack(spacing: 20) {
                vibe80Header(
                    title: "welcome.title",
                    subtitle: "welcome.subtitle"
                )

                Button("workspace.create") {
                    viewModel.selectWorkspaceMode(.new)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)

                Button("workspace.join") {
                    viewModel.selectWorkspaceMode(.existing)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)

                Button("workspace.resume.desktop") {
                    viewModel.openQrScan()
                }
                .buttonStyle(.bordered)
                .tint(.vibe80AccentDark)
            }
            .padding(24)
        }
    }

    private var workspaceCredentials: some View {
        ScrollView {
            VStack(spacing: 20) {
                backButton { viewModel.openWorkspaceModeSelection() }
                vibe80Header(title: "workspace.credentials.title")

                VStack(spacing: 12) {
                    Vibe80TextField(
                        title: "workspace.id",
                        text: $viewModel.workspaceIdInput
                    )
                    Vibe80SecureField(
                        title: "workspace.secret",
                        text: $viewModel.workspaceSecretInput,
                        isRevealed: $showWorkspaceSecret
                    )
                }
                .vibe80CardStyle()

                if let error = viewModel.workspaceError {
                    Text(error)
                        .foregroundColor(.red)
                }

                Button(viewModel.workspaceBusy ? "workspace.connecting" : "action.continue") {
                    viewModel.submitWorkspaceCredentials(appState: appState)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)
                .disabled(viewModel.workspaceBusy)
            }
            .padding(24)
        }
    }

    private var providerConfig: some View {
        ScrollView {
            VStack(spacing: 20) {
                backButton {
                    if viewModel.providerConfigMode == .update {
                        viewModel.backToJoinSession()
                    } else {
                        viewModel.openWorkspaceModeSelection()
                    }
                }
                vibe80Header(title: "providers.config.title")

                providerCard(
                    provider: "codex",
                    title: "provider.codex",
                    supportsAuthJson: true,
                    supportsSetupToken: false
                )
                providerCard(
                    provider: "claude",
                    title: "provider.claude",
                    supportsAuthJson: false,
                    supportsSetupToken: true
                )

                if let error = viewModel.workspaceError {
                    Text(error)
                        .foregroundColor(.red)
                }

                Button(viewModel.workspaceBusy ? "providers.config.loading" : "action.continue") {
                    viewModel.submitProviderConfig(appState: appState)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)
                .disabled(viewModel.workspaceBusy)
            }
            .padding(24)
        }
    }

    private var workspaceCreated: some View {
        ScrollView {
            VStack(spacing: 20) {
                vibe80Header(
                    title: "workspace.created.title",
                    subtitle: "workspace.created.subtitle"
                )

                VStack(alignment: .leading, spacing: 12) {
                    Text("workspace.id")
                        .font(.caption)
                        .foregroundColor(.vibe80InkMuted)
                    Text(viewModel.workspaceCreatedId ?? "-")
                        .font(.body)

                    Text("workspace.secret")
                        .font(.caption)
                        .foregroundColor(.vibe80InkMuted)
                    Text(viewModel.workspaceCreatedSecret ?? "-")
                        .font(.body)
                }
                .vibe80CardStyle()

                Button("action.continue") {
                    viewModel.continueFromWorkspaceCreated()
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)
            }
            .padding(24)
        }
    }

    private var joinSession: some View {
        ScrollView {
            VStack(spacing: 20) {
                vibe80Header(title: "session.join.title")

                Button("session.start.new") {
                    viewModel.openStartSession()
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)

                Button("providers.reconfigure") {
                    viewModel.openProviderConfigForUpdate()
                }
                .buttonStyle(.bordered)
                .tint(.vibe80AccentDark)

                Button("workspace.leave", role: .destructive) {
                    viewModel.leaveWorkspace(appState: appState)
                }
                .buttonStyle(.bordered)

                // Workspace sessions list (P2.4)
                VStack(alignment: .leading, spacing: 12) {
                    Text("sessions.recent")
                        .font(.headline)

                    if viewModel.sessionsLoading {
                        HStack {
                            ProgressView()
                                .scaleEffect(0.8)
                            Text("sessions.loading")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                        }
                    } else if !viewModel.workspaceSessions.isEmpty {
                        ForEach(viewModel.workspaceSessions, id: \.sessionId) { session in
                            sessionCard(session)
                        }
                    } else if viewModel.hasSavedSession {
                        // Fallback to saved session if API list is empty
                        VStack(alignment: .leading, spacing: 12) {
                            Text(viewModel.savedSessionRepoUrl.isEmpty ? "session.saved.placeholder" : viewModel.savedSessionRepoUrl)
                                .font(.subheadline)
                                .foregroundColor(.vibe80Ink)
                            HStack(spacing: 12) {
                                Button(viewModel.loadingState == .resuming ? "action.resume.progress" : "action.resume") {
                                    viewModel.resumeSession(appState: appState)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(.vibe80Accent)
                                .disabled(viewModel.isLoading)

                                Button("action.delete") {
                                    viewModel.clearSavedSession()
                                }
                                .buttonStyle(.bordered)
                                .tint(.vibe80AccentDark)
                            }
                        }
                        .vibe80CardStyle()
                    } else {
                        Text("session.saved.empty")
                            .foregroundColor(.vibe80InkMuted)
                    }

                    if let error = viewModel.sessionsError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                if let error = viewModel.sessionError {
                    Text(error)
                        .foregroundColor(.red)
                }
            }
            .padding(24)
        }
        .onAppear {
            viewModel.loadWorkspaceSessions(appState: appState)
        }
    }

    private func sessionCard(_ session: SessionSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(session.repoUrl ?? session.sessionId)
                .font(.subheadline.weight(.medium))
                .foregroundColor(.vibe80Ink)
                .lineLimit(1)

            HStack(spacing: 12) {
                if let lastActivity = session.lastActivityAt {
                    Text(formatSessionDate(lastActivity))
                        .font(.caption)
                        .foregroundColor(.vibe80InkMuted)
                }

                if let provider = session.activeProvider {
                    HStack(spacing: 4) {
                        Image(systemName: "cpu")
                            .font(.caption2)
                        Text(provider)
                            .font(.caption)
                    }
                    .foregroundColor(.vibe80InkMuted)
                }

                Spacer()

                Button(viewModel.loadingState == .resuming ? "action.resume.progress" : "action.resume") {
                    viewModel.resumeWorkspaceSession(
                        sessionId: session.sessionId,
                        repoUrl: session.repoUrl,
                        appState: appState
                    )
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)
                .controlSize(.small)
                .disabled(viewModel.isLoading)
            }
        }
        .vibe80CardStyle()
    }

    private func formatSessionDate(_ timestamp: KotlinLong) -> String {
        let date = Date(timeIntervalSince1970: Double(timestamp.int64Value) / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private var startSession: some View {
        ScrollView {
            VStack(spacing: 20) {
                backButton { viewModel.backToJoinSession() }
                vibe80Header(title: "session.start.title")

                VStack(spacing: 12) {
                    Vibe80TextField(title: "repo.url.label", text: $viewModel.repoUrl)
                }
                .vibe80CardStyle()

                VStack(alignment: .leading, spacing: 12) {
                    Text("auth.title")
                        .font(.headline)
                    Picker("auth.method.label", selection: $viewModel.authMethod) {
                        Text("auth.none").tag(AuthMethod.none)
                        Text("auth.http").tag(AuthMethod.http)
                        Text("auth.ssh").tag(AuthMethod.ssh)
                    }
                    .pickerStyle(.segmented)

                    if viewModel.authMethod == .ssh {
                        Vibe80TextEditor(title: "auth.ssh.key", text: $viewModel.sshKey)
                    }

                    if viewModel.authMethod == .http {
                        Vibe80TextField(title: "auth.http.username", text: $viewModel.httpUser)
                        Vibe80SecureField(
                            title: "auth.http.password",
                            text: $viewModel.httpPassword,
                            isRevealed: $showHttpPassword
                        )
                    }
                }
                .vibe80CardStyle()

                if let error = viewModel.sessionError {
                    Text(error)
                        .foregroundColor(.red)
                }

                Button(viewModel.isLoading ? "session.start.loading" : "action.continue") {
                    viewModel.createSession(appState: appState)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)
                .disabled(viewModel.isLoading)
            }
            .padding(24)
        }
    }

    private func providerCard(
        provider: String,
        title: LocalizedStringKey,
        supportsAuthJson: Bool,
        supportsSetupToken: Bool
    ) -> some View {
        let state = viewModel.workspaceProviders[provider] ?? ProviderAuthState()
        let effectiveAuthType: ProviderAuthType = {
            if !supportsSetupToken && state.authType == .setupToken {
                return .apiKey
            }
            if !supportsAuthJson && state.authType == .authJsonB64 {
                return .apiKey
            }
            return state.authType
        }()

        return VStack(alignment: .leading, spacing: 12) {
            Toggle(title, isOn: Binding(
                get: { state.enabled },
                set: { viewModel.toggleProvider(provider, enabled: $0) }
            ))
            .toggleStyle(SwitchToggleStyle(tint: .vibe80Accent))

            if state.enabled {
                Picker("Auth", selection: Binding(
                    get: { effectiveAuthType },
                    set: { viewModel.updateProviderAuthType(provider, authType: $0) }
                )) {
                    Text("provider.auth.api_key").tag(ProviderAuthType.apiKey)
                    if supportsAuthJson {
                        Text("provider.auth.auth_json_b64").tag(ProviderAuthType.authJsonB64)
                    }
                    if supportsSetupToken {
                        Text("provider.auth.setup_token").tag(ProviderAuthType.setupToken)
                    }
                }
                .pickerStyle(.segmented)

                if effectiveAuthType == .authJsonB64 && supportsAuthJson {
                    Button("provider.auth.import_auth_json") {
                        showAuthJsonPicker = true
                    }
                    .buttonStyle(.bordered)
                    .tint(.vibe80AccentDark)

                    HStack(spacing: 8) {
                        Image(systemName: state.authValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "doc" : "checkmark.circle.fill")
                            .foregroundColor(state.authValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .vibe80InkMuted : .green)
                        Text(state.authValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                             ? "provider.auth.auth_json_not_selected"
                             : "provider.auth.auth_json_selected")
                            .foregroundColor(.vibe80InkMuted)
                            .font(.footnote)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    Vibe80SecureField(
                        title: effectiveAuthType == .setupToken
                            ? "provider.auth.setup_token_label"
                            : "provider.auth.api_key_label",
                        text: Binding(
                            get: { state.authValue },
                            set: { viewModel.updateProviderAuthValue(provider, authValue: $0) }
                        ),
                        isRevealed: $showProviderSecrets
                    )
                }
            }
        }
        .vibe80CardStyle()
    }

    private func vibe80Header(title: LocalizedStringKey, subtitle: LocalizedStringKey? = nil) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            sessionGateLogo
            Text(title)
                .font(.headline)
                .foregroundColor(.vibe80Ink)
            if let subtitle = subtitle {
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundColor(.vibe80InkMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var sessionGateLogo: some View {
        let preferredName = colorScheme == .dark ? "Vibe80LogoDark" : "Vibe80LogoLight"
        if let image = UIImage(named: preferredName) ?? UIImage(named: "Vibe80Logo") {
            Image(uiImage: image)
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(width: 140, height: 32, alignment: .leading)
                .accessibilityLabel(Text("app.name"))
        } else {
            Text("app.name")
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(.vibe80Ink)
        }
    }

    private func backButton(action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label("action.back", systemImage: "chevron.left")
                .foregroundColor(.vibe80Ink)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct Vibe80TextField: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundColor(.vibe80InkMuted)
            TextField("", text: $text)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .keyboardType(.asciiCapable)
        }
    }
}

private struct Vibe80SecureField: View {
    let title: String
    @Binding var text: String
    @Binding var isRevealed: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundColor(.vibe80InkMuted)
            HStack {
                if isRevealed {
                    TextField("", text: $text)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled(true)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.asciiCapable)
                } else {
                    SecureField("", text: $text)
                        .textFieldStyle(.roundedBorder)
                        .autocorrectionDisabled(true)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.asciiCapable)
                }
                Button(action: { isRevealed.toggle() }) {
                    Image(systemName: isRevealed ? "eye.slash" : "eye")
                        .foregroundColor(.vibe80InkMuted)
                }
            }
        }
    }
}

private struct Vibe80TextEditor: View {
    let title: String
    @Binding var text: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption)
                .foregroundColor(.vibe80InkMuted)
            TextEditor(text: $text)
                .frame(minHeight: 90)
                .padding(8)
                .background(Color.vibe80SurfaceElevated)
                .cornerRadius(12)
                .autocorrectionDisabled(true)
                .textInputAutocapitalization(.never)
                .keyboardType(.asciiCapable)
        }
    }
}

#Preview {
    SessionView()
        .environmentObject(AppState())
}
