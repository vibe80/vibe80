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
    @State private var activeFileImportTarget: FileImportTarget?
    @State private var showFileImporter: Bool = false
    @State private var showLogsSheet = false
    @State private var sessionConfigTargetId: String?
    @State private var sessionConfigAuthMode: SessionConfigAuthMode = .keep
    @State private var sessionConfigSshKey: String = ""
    @State private var sessionConfigHttpUsername: String = ""
    @State private var sessionConfigHttpPassword: String = ""
    @State private var showSessionConfigSshKeyImporter: Bool = false
    @State private var sessionConfigInternetAccess: Bool = true
    @State private var sessionConfigDenyGitCredentialsAccess: Bool = true
    @State private var deleteSessionTarget: SessionSummary?

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
            isPresented: $showFileImporter,
            allowedContentTypes: [.json, .plainText, .text, .utf8PlainText, .data]
        ) { result in
            defer { activeFileImportTarget = nil }
            guard
                case let .success(url) = result,
                let data = try? Data(contentsOf: url),
                let content = String(data: data, encoding: .utf8)
            else { return }

            switch activeFileImportTarget {
            case .authJson:
                viewModel.updateProviderAuthValue("codex", authValue: content)
            case .sshKeyStartSession:
                viewModel.sshKey = content
            case .none:
                break
            }
        }
        .sheet(isPresented: $showLogsSheet) {
            if appState.logsButtonEnabled {
                LogsSheetView(
                    logs: viewModel.logs,
                    onClear: viewModel.clearLogs
                )
                .presentationDetents([.large])
            }
        }
        .sheet(isPresented: Binding(
            get: { sessionConfigTargetId != nil },
            set: { if !$0 { sessionConfigTargetId = nil } }
        )) {
            if let target = sessionConfigTarget {
                sessionConfigSheet(target)
                    .presentationDetents([.large])
            }
        }
        .alert(
            "session.delete.confirm.title",
            isPresented: Binding(
                get: { deleteSessionTarget != nil },
                set: { if !$0 { deleteSessionTarget = nil } }
            ),
            actions: {
                Button("action.cancel", role: .cancel) {
                    deleteSessionTarget = nil
                }
                Button("action.delete", role: .destructive) {
                    guard let target = deleteSessionTarget else { return }
                    viewModel.deleteWorkspaceSession(
                        sessionId: target.sessionId,
                        appState: appState
                    )
                    deleteSessionTarget = nil
                }
            },
            message: {
                if let target = deleteSessionTarget {
                    Text(
                        String(
                            format: NSLocalizedString("session.delete.confirm.message", comment: ""),
                            repoShortName(from: target.repoUrl) ?? target.sessionId
                        )
                    )
                }
            }
        )
    }

    private var workspaceModeSelection: some View {
        ScrollView {
            VStack(spacing: 20) {
                vibe80Header(
                    title: "welcome.title",
                    subtitle: "welcome.subtitle"
                )

                VStack(spacing: 12) {
                    workspaceActionCard(
                        title: "workspace.resume.desktop",
                        subtitle: "welcome.resume.subtitle",
                        icon: "desktopcomputer",
                        emphasized: true
                    ) {
                        viewModel.openQrScan()
                    }

                    workspaceActionCard(
                        title: "workspace.create",
                        subtitle: "welcome.create.subtitle",
                        icon: "sparkles",
                        emphasized: false
                    ) {
                        viewModel.selectWorkspaceMode(.new)
                    }

                    workspaceActionCard(
                        title: "workspace.join",
                        subtitle: "welcome.join.subtitle",
                        icon: "point.3.connected.trianglepath.dotted",
                        emphasized: false
                    ) {
                        viewModel.selectWorkspaceMode(.existing)
                    }
                }
                .vibe80CardStyle()

                if appState.logsButtonEnabled {
                    Button {
                        showLogsSheet = true
                    } label: {
                        Label("logs.title.simple", systemImage: "ladybug")
                    }
                    .buttonStyle(.bordered)
                    .tint(.vibe80AccentDark)
                }
            }
            .padding(24)
        }
    }

    private func workspaceActionCard(
        title: LocalizedStringKey,
        subtitle: LocalizedStringKey,
        icon: String,
        emphasized: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(emphasized ? Color.vibe80Accent.opacity(0.18) : Color.vibe80Background)
                        .frame(width: 44, height: 44)
                    Image(systemName: icon)
                        .foregroundColor(emphasized ? .vibe80Accent : .vibe80InkMuted)
                }

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.vibe80Ink)
                    Text(subtitle)
                        .font(.system(size: 12))
                        .foregroundColor(.vibe80InkMuted)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(.vibe80InkMuted)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .background(emphasized ? Color(red: 1.0, green: 0.97, blue: 0.93) : Color.vibe80SurfaceElevated)
            .cornerRadius(16)
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(Color.vibe80InkMuted.opacity(0.12), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private var workspaceCredentials: some View {
        ScrollView {
            VStack(spacing: 20) {
                backButton { viewModel.openWorkspaceModeSelection() }
                vibe80Header(
                    title: "workspace.credentials.title",
                    subtitle: "workspace.credentials.subtitle.new"
                )

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

                Button {
                    viewModel.submitWorkspaceCredentials(appState: appState)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "lock.fill")
                            .font(.headline.weight(.semibold))
                        Text(viewModel.workspaceBusy ? "workspace.connecting" : "workspace.join.action")
                            .font(.headline.weight(.bold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(
                        LinearGradient(
                            colors: [Color(red: 1.0, green: 0.42, blue: 0.15), Color(red: 1.0, green: 0.31, blue: 0.13)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .cornerRadius(22)
                    .shadow(color: Color.black.opacity(0.18), radius: 10, y: 5)
                }
                .buttonStyle(.plain)
                .disabled(viewModel.workspaceBusy)

                Link("workspace.help.contact", destination: URL(string: "https://vibe80.io/contact")!)
                    .font(.footnote)
                    .foregroundColor(.vibe80InkMuted)
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

                Button {
                    viewModel.submitProviderConfig(appState: appState)
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "arrow.right.circle.fill")
                            .font(.headline.weight(.semibold))
                        Text(viewModel.workspaceBusy ? "providers.config.loading" : "action.continue")
                            .font(.headline.weight(.bold))
                    }
                    .foregroundColor(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
                    .background(
                        LinearGradient(
                            colors: [Color(red: 1.0, green: 0.42, blue: 0.15), Color(red: 1.0, green: 0.31, blue: 0.13)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .cornerRadius(22)
                    .shadow(color: Color.black.opacity(0.18), radius: 10, y: 5)
                }
                .buttonStyle(.plain)
                .disabled(viewModel.workspaceBusy)

                Link(
                    destination: URL(string: "https://vibe80.io/docs/workspace-session-setup")!
                ) {
                    Text("providers.config.learn_more")
                        .font(.footnote)
                }
                .tint(.vibe80AccentDark)
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
                    copyableCredentialRow(viewModel.workspaceCreatedId ?? "-")

                    Text("workspace.secret")
                        .font(.caption)
                        .foregroundColor(.vibe80InkMuted)
                    copyableCredentialRow(viewModel.workspaceCreatedSecret ?? "-")
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
                HStack(alignment: .top) {
                    sessionGateLogo
                    Spacer()
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    viewModel.openStartSession()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "play.fill")
                            .font(.headline.weight(.semibold))
                        VStack(alignment: .leading, spacing: 4) {
                            Text("session.start.new")
                                .font(.title3.weight(.bold))
                        }
                        Spacer()
                    }
                    .foregroundColor(.white)
                    .padding(.vertical, 16)
                    .padding(.horizontal, 18)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        LinearGradient(
                            colors: [Color(red: 1.0, green: 0.42, blue: 0.15), Color(red: 1.0, green: 0.31, blue: 0.13)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .cornerRadius(22)
                    .shadow(color: Color.black.opacity(0.18), radius: 10, y: 5)
                }
                .buttonStyle(.plain)

                // Workspace sessions list (P2.4)
                VStack(alignment: .leading, spacing: 12) {
                    Text("sessions.recent")
                        .font(.headline)
                        .frame(maxWidth: .infinity, alignment: .leading)

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
                                Button(
                                    viewModel.resumingSessionId == viewModel.savedSessionId && viewModel.loadingState == .resuming
                                        ? "action.resume.progress"
                                        : "action.resume"
                                ) {
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
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if let error = viewModel.sessionsError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                VStack(spacing: 0) {
                    sessionMenuRow(
                        title: "workspace.leave",
                        icon: "rectangle.portrait.and.arrow.right",
                        tint: .red
                    ) {
                        viewModel.leaveWorkspace(appState: appState)
                    }
                }
                .vibe80CardStyle()

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

    private func sessionMenuRow(
        title: LocalizedStringKey,
        icon: String,
        tint: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: icon)
                    .foregroundColor(tint)
                    .frame(width: 20)

                Text(title)
                    .font(.body.weight(.medium))
                    .foregroundColor(tint)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(.vibe80InkMuted)
            }
            .padding(.vertical, 14)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func sessionCard(_ session: SessionSummary) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(repoShortName(from: session.repoUrl) ?? session.sessionId)
                .font(.subheadline.weight(.medium))
                .foregroundColor(.vibe80Ink)
                .lineLimit(1)
            
            if let repoUrl = session.repoUrl, !repoUrl.isEmpty {
                Text(repoUrl)
                    .font(.caption2)
                    .foregroundColor(.vibe80InkMuted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

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

                Button(
                    viewModel.resumingSessionId == session.sessionId && viewModel.loadingState == .resuming
                        ? "action.resume.progress"
                        : "action.resume"
                ) {
                    viewModel.resumeWorkspaceSession(
                        sessionId: session.sessionId,
                        repoUrl: session.repoUrl,
                        appState: appState
                    )
                }
                .buttonStyle(.borderedProminent)
                .tint(.vibe80Accent)
                .controlSize(.small)
                .disabled(viewModel.isLoading || viewModel.sessionUpdatingId != nil || viewModel.sessionDeletingId != nil)

                Menu {
                    Button("session.config.button") {
                        openSessionConfig(session)
                    }

                    Button("action.delete", role: .destructive) {
                        deleteSessionTarget = session
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundColor(.vibe80InkMuted)
                }
                .disabled(viewModel.sessionUpdatingId != nil || viewModel.sessionDeletingId != nil)
            }
        }
        .vibe80CardStyle()
    }

    private var sessionConfigTarget: SessionSummary? {
        guard let sessionConfigTargetId else { return nil }
        return viewModel.workspaceSessions.first { $0.sessionId == sessionConfigTargetId }
    }

    private func boolFromKotlin(_ value: KotlinBoolean?) -> Bool? {
        value?.boolValue
    }

    private func boolFromKotlin(_ value: Bool?) -> Bool? {
        value
    }

    private func openSessionConfig(_ session: SessionSummary) {
        sessionConfigTargetId = session.sessionId
        sessionConfigAuthMode = .keep
        sessionConfigSshKey = ""
        sessionConfigHttpUsername = ""
        sessionConfigHttpPassword = ""
        showSessionConfigSshKeyImporter = false
        sessionConfigInternetAccess = boolFromKotlin(session.defaultInternetAccess) ?? true
        sessionConfigDenyGitCredentialsAccess =
            boolFromKotlin(session.defaultDenyGitCredentialsAccess) ?? true
    }

    @ViewBuilder
    private func sessionConfigSheet(_ session: SessionSummary) -> some View {
        NavigationStack {
            Form {
                Section("session.config.auth.section") {
                    Picker("session.config.auth.mode", selection: $sessionConfigAuthMode) {
                        Text("session.config.auth.keep").tag(SessionConfigAuthMode.keep)
                        Text("session.config.auth.none").tag(SessionConfigAuthMode.none)
                        Text("auth.ssh").tag(SessionConfigAuthMode.ssh)
                        Text("auth.http").tag(SessionConfigAuthMode.http)
                    }
                    .pickerStyle(.menu)

                    if sessionConfigAuthMode == .ssh {
                        Button("auth.ssh.import_key") {
                            showSessionConfigSshKeyImporter = true
                        }
                        .buttonStyle(.bordered)
                        .tint(.vibe80AccentDark)

                        HStack(spacing: 8) {
                            Image(systemName: sessionConfigSshKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "doc" : "checkmark.circle.fill")
                                .foregroundColor(sessionConfigSshKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .vibe80InkMuted : .green)
                            Text(sessionConfigSshKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                 ? "auth.ssh.key_not_selected"
                                 : "auth.ssh.key_selected")
                                .foregroundColor(.vibe80InkMuted)
                                .font(.footnote)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    if sessionConfigAuthMode == .http {
                        Vibe80TextField(title: "auth.http.username", text: $sessionConfigHttpUsername)
                        Vibe80SecureField(
                            title: "auth.http.password",
                            text: $sessionConfigHttpPassword,
                            isRevealed: $showHttpPassword
                        )
                    }
                }

                Section("session.config.permissions.section") {
                    Toggle("worktree.internet_access.label", isOn: $sessionConfigInternetAccess)
                    Toggle("worktree.deny_git_credentials.label", isOn: $sessionConfigDenyGitCredentialsAccess)
                        .disabled(!sessionConfigInternetAccess)
                }

                if let error = viewModel.sessionsError {
                    Section {
                        Text(error)
                            .font(.footnote)
                            .foregroundColor(.orange)
                    }
                }
            }
            .navigationTitle("session.config.title")
            .navigationBarTitleDisplayMode(.inline)
            .fileImporter(
                isPresented: $showSessionConfigSshKeyImporter,
                allowedContentTypes: [.json, .plainText, .text, .utf8PlainText, .data]
            ) { result in
                guard
                    case let .success(url) = result,
                    let data = try? Data(contentsOf: url),
                    let content = String(data: data, encoding: .utf8)
                else { return }
                sessionConfigSshKey = content
            }
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button("action.cancel") {
                        sessionConfigTargetId = nil
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("session.config.save") {
                        viewModel.updateWorkspaceSessionConfig(
                            sessionId: session.sessionId,
                            originalInternetAccess: boolFromKotlin(session.defaultInternetAccess) ?? true,
                            originalDenyGitCredentialsAccess: boolFromKotlin(session.defaultDenyGitCredentialsAccess) ?? true,
                            internetAccess: sessionConfigInternetAccess,
                            denyGitCredentialsAccess: sessionConfigDenyGitCredentialsAccess,
                            authMode: sessionConfigAuthMode,
                            sshPrivateKey: sessionConfigSshKey,
                            httpUsername: sessionConfigHttpUsername,
                            httpPassword: sessionConfigHttpPassword,
                            appState: appState
                        ) {
                            sessionConfigTargetId = nil
                        }
                    }
                    .disabled(viewModel.sessionUpdatingId == session.sessionId)
                }
            }
        }
    }

    private func repoShortName(from repoUrl: String?) -> String? {
        guard let repoUrl else { return nil }
        let trimmed = repoUrl
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !trimmed.isEmpty else { return nil }
        let slashIndex = trimmed.lastIndex(of: "/")
        let colonIndex = trimmed.lastIndex(of: ":")
        if let index = [slashIndex, colonIndex].compactMap({ $0 }).max() {
            let next = trimmed.index(after: index)
            return String(trimmed[next...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return trimmed
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
                VStack(alignment: .leading, spacing: 6) {
                    Text("New session")
                        .font(.system(size: 40, weight: .bold))
                        .foregroundColor(.vibe80Ink)
                    Text("Connect a Git repository to spin up your vibecoding work.")
                        .font(.body)
                        .foregroundColor(.vibe80InkMuted)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 8) {
                            Image(systemName: "diamond.fill")
                                .foregroundColor(.vibe80Accent)
                            Text("Repository")
                                .font(.title3.weight(.semibold))
                                .foregroundColor(.vibe80Ink)
                        }

                        HStack(spacing: 8) {
                            TextField(
                                "",
                                text: $viewModel.repoUrl,
                                prompt: Text("https://github.com/org/project")
                                    .foregroundColor(.vibe80InkMuted)
                            )
                                .textFieldStyle(.roundedBorder)
                                .autocorrectionDisabled(true)
                                .textInputAutocapitalization(.never)
                                .keyboardType(.URL)
                        }
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Authentication method")
                            .font(.title3.weight(.semibold))
                            .foregroundColor(.vibe80Ink)

                        VStack(spacing: 0) {
                            authOptionRow("No authentication", method: .none)
                            Divider().padding(.leading, 36)
                            authOptionRow("HTTPS (username + token)", method: .http)
                            Divider().padding(.leading, 36)
                            authOptionRow("SSH key", method: .ssh)
                        }
                        .background(Color.vibe80SurfaceElevated)
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.vibe80InkMuted.opacity(0.15), lineWidth: 1)
                        )

                        if viewModel.authMethod == .ssh {
                            Button("auth.ssh.import_key") {
                                activeFileImportTarget = .sshKeyStartSession
                                showFileImporter = true
                            }
                            .buttonStyle(.bordered)
                            .tint(.vibe80AccentDark)

                            HStack(spacing: 8) {
                                Image(systemName: viewModel.sshKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "doc" : "checkmark.circle.fill")
                                    .foregroundColor(viewModel.sshKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .vibe80InkMuted : .green)
                                Text(viewModel.sshKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                     ? "auth.ssh.key_not_selected"
                                     : "auth.ssh.key_selected")
                                    .foregroundColor(.vibe80InkMuted)
                                    .font(.footnote)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
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

                    Button {
                        viewModel.createSession(appState: appState)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "play.fill")
                                .font(.headline.weight(.semibold))
                            Text("Launch session")
                                .font(.headline.weight(.bold))
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(
                            LinearGradient(
                                colors: [Color(red: 1.0, green: 0.42, blue: 0.15), Color(red: 1.0, green: 0.31, blue: 0.13)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .cornerRadius(22)
                        .shadow(color: Color.black.opacity(0.18), radius: 10, y: 5)
                    }
                    .buttonStyle(.plain)
                    .disabled(viewModel.isLoading)
                }
                .vibe80CardStyle()

                if let error = viewModel.sessionError {
                    Text(error)
                        .foregroundColor(.red)
                }
            }
            .padding(24)
        }
    }

    private func authOptionRow(_ title: String, method: AuthMethod) -> some View {
        Button {
            viewModel.authMethod = method
        } label: {
            HStack(spacing: 12) {
                Image(systemName: viewModel.authMethod == method ? "record.circle.fill" : "circle")
                    .foregroundColor(viewModel.authMethod == method ? .vibe80Accent : .vibe80InkMuted)
                Text(title)
                    .foregroundColor(.vibe80Ink)
                Spacer()
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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
                Picker("auth.method.label", selection: Binding(
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
                        activeFileImportTarget = .authJson
                        showFileImporter = true
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
                    let authTitleKey: LocalizedStringKey = effectiveAuthType == .setupToken
                        ? "provider.auth.setup_token_label"
                        : "provider.auth.api_key_label"
                    Vibe80SecureField(
                        title: authTitleKey,
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

    private func copyableCredentialRow(_ value: String) -> some View {
        HStack(spacing: 8) {
            Text(value)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .lineLimit(1)
                .truncationMode(.middle)

            Button {
                UIPasteboard.general.string = value == "-" ? nil : value
            } label: {
                Image(systemName: "doc.on.doc")
                    .foregroundColor(.vibe80InkMuted)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("action.copy"))
        }
    }
}

private struct Vibe80TextField: View {
    let title: LocalizedStringKey
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
    let title: LocalizedStringKey
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
    let title: LocalizedStringKey
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

private enum FileImportTarget: String, Identifiable {
    case authJson
    case sshKeyStartSession

    var id: String { rawValue }
}

#Preview {
    SessionView()
        .environmentObject(AppState())
}
