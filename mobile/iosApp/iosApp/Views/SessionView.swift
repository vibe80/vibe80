import SwiftUI
import UniformTypeIdentifiers

struct SessionView: View {
    @EnvironmentObject var appState: AppState
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
                    title: "Bienvenue dans Vibe80",
                    subtitle: "Choisissez comment démarrer votre session."
                )

                Button("Créer un nouveau workspace") {
                    viewModel.selectWorkspaceMode(.new)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)

                Button("Rejoindre un workspace existant") {
                    viewModel.selectWorkspaceMode(.existing)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)

                Button("Reprendre une session desktop") {
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
                vibe80Header(title: "Identifiants workspace")

                VStack(spacing: 12) {
                    Vibe80TextField(
                        title: "Workspace ID",
                        text: $viewModel.workspaceIdInput
                    )
                    Vibe80SecureField(
                        title: "Workspace secret",
                        text: $viewModel.workspaceSecretInput,
                        isRevealed: $showWorkspaceSecret
                    )
                }
                .vibe80CardStyle()

                if let error = viewModel.workspaceError {
                    Text(error)
                        .foregroundColor(.red)
                }

                Button(viewModel.workspaceBusy ? "Connexion..." : "Continuer") {
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
                vibe80Header(title: "Configuration des providers IA")

                providerCard(provider: "codex", title: "Codex", supportsAuthJson: true)
                providerCard(provider: "claude", title: "Claude", supportsAuthJson: false)

                if let error = viewModel.workspaceError {
                    Text(error)
                        .foregroundColor(.red)
                }

                Button(viewModel.workspaceBusy ? "Chargement..." : "Continuer") {
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
                    title: "Workspace créé",
                    subtitle: "Conservez ces identifiants pour vos prochaines connexions."
                )

                VStack(alignment: .leading, spacing: 12) {
                    Text("Workspace ID")
                        .font(.caption)
                        .foregroundColor(.vibe80InkMuted)
                    Text(viewModel.workspaceCreatedId ?? "-")
                        .font(.body)

                    Text("Workspace secret")
                        .font(.caption)
                        .foregroundColor(.vibe80InkMuted)
                    Text(viewModel.workspaceCreatedSecret ?? "-")
                        .font(.body)
                }
                .vibe80CardStyle()

                Button("Continuer") {
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
                vibe80Header(title: "Rejoindre une session")

                Button("Démarrer une nouvelle session") {
                    viewModel.openStartSession()
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)

                Button("Reconfigurer les providers IA") {
                    viewModel.openProviderConfigForUpdate()
                }
                .buttonStyle(.bordered)
                .tint(.vibe80AccentDark)

                VStack(alignment: .leading, spacing: 12) {
                    Text("Sessions récentes")
                        .font(.headline)
                    if viewModel.hasSavedSession {
                        VStack(alignment: .leading, spacing: 12) {
                            Text(viewModel.savedSessionRepoUrl.isEmpty ? "Session sauvegardée" : viewModel.savedSessionRepoUrl)
                                .font(.subheadline)
                                .foregroundColor(.vibe80Ink)
                            HStack(spacing: 12) {
                                Button(viewModel.loadingState == .resuming ? "Reprise..." : "Reprendre") {
                                    viewModel.resumeSession(appState: appState)
                                }
                                .buttonStyle(.borderedProminent)
                                .tint(.vibe80Accent)
                                .disabled(viewModel.isLoading)

                                Button("Supprimer") {
                                    viewModel.clearSavedSession()
                                }
                                .buttonStyle(.bordered)
                                .tint(.vibe80AccentDark)
                            }
                        }
                        .vibe80CardStyle()
                    } else {
                        Text("Aucune session sauvegardée pour le moment.")
                            .foregroundColor(.vibe80InkMuted)
                    }
                }

                if let error = viewModel.sessionError {
                    Text(error)
                        .foregroundColor(.red)
                }
            }
            .padding(24)
        }
    }

    private var startSession: some View {
        ScrollView {
            VStack(spacing: 20) {
                backButton { viewModel.backToJoinSession() }
                vibe80Header(title: "Démarrer une session")

                VStack(spacing: 12) {
                    Vibe80TextField(title: "Repository URL", text: $viewModel.repoUrl)
                }
                .vibe80CardStyle()

                VStack(alignment: .leading, spacing: 12) {
                    Text("Authentification")
                        .font(.headline)
                    Picker("Auth", selection: $viewModel.authMethod) {
                        Text("Aucune").tag(AuthMethod.none)
                        Text("HTTP").tag(AuthMethod.http)
                        Text("SSH").tag(AuthMethod.ssh)
                    }
                    .pickerStyle(.segmented)

                    if viewModel.authMethod == .ssh {
                        Vibe80TextEditor(title: "Clé SSH privée", text: $viewModel.sshKey)
                    }

                    if viewModel.authMethod == .http {
                        Vibe80TextField(title: "Nom d'utilisateur", text: $viewModel.httpUser)
                        Vibe80SecureField(
                            title: "Mot de passe / Token",
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

                Button(viewModel.isLoading ? "Chargement..." : "Continuer") {
                    viewModel.createSession(appState: appState)
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)
                .disabled(viewModel.isLoading)
            }
            .padding(24)
        }
    }

    private func providerCard(provider: String, title: String, supportsAuthJson: Bool) -> some View {
        let state = viewModel.workspaceProviders[provider] ?? ProviderAuthState()

        return VStack(alignment: .leading, spacing: 12) {
            Toggle(title, isOn: Binding(
                get: { state.enabled },
                set: { viewModel.toggleProvider(provider, enabled: $0) }
            ))
            .toggleStyle(SwitchToggleStyle(tint: .vibe80Accent))

            if state.enabled {
                Picker("Auth", selection: Binding(
                    get: { state.authType },
                    set: { viewModel.updateProviderAuthType(provider, authType: $0) }
                )) {
                    Text("API key").tag(ProviderAuthType.apiKey)
                    if supportsAuthJson {
                        Text("auth_json_b64").tag(ProviderAuthType.authJsonB64)
                    }
                    Text("setup_token").tag(ProviderAuthType.setupToken)
                }
                .pickerStyle(.segmented)

                if state.authType == .authJsonB64 && supportsAuthJson {
                    Button("Importer auth.json") {
                        showAuthJsonPicker = true
                    }
                    .buttonStyle(.bordered)
                    .tint(.vibe80AccentDark)
                    Vibe80TextEditor(
                        title: "auth.json",
                        text: Binding(
                            get: { state.authValue },
                            set: { viewModel.updateProviderAuthValue(provider, authValue: $0) }
                        )
                    )
                } else {
                    Vibe80SecureField(
                        title: state.authType == .setupToken ? "Setup token" : "Clé API",
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

    private func vibe80Header(title: String, subtitle: String? = nil) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Vibe80")
                .font(.title)
                .fontWeight(.bold)
                .foregroundColor(.vibe80Ink)
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

    private func backButton(action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label("Retour", systemImage: "chevron.left")
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
                } else {
                    SecureField("", text: $text)
                        .textFieldStyle(.roundedBorder)
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
        }
    }
}

#Preview {
    SessionView()
        .environmentObject(AppState())
}
