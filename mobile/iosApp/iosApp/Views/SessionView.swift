import SwiftUI
import shared

struct SessionView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = SessionViewModel()

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Logo/Header
                    headerSection

                    // Previous session card
                    if let previousSession = viewModel.previousSessionId {
                        previousSessionCard(sessionId: previousSession)
                    }

                    // New session form
                    newSessionForm

                    Spacer(minLength: 32)
                }
                .padding()
            }
            .navigationTitle("Vibe80")
            .alert("Erreur", isPresented: $viewModel.showError) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(viewModel.errorMessage)
            }
        }
    }

    // MARK: - Header Section

    private var headerSection: some View {
        VStack(spacing: 8) {
            Image(systemName: "bubble.left.and.bubble.right.fill")
                .font(.system(size: 60))
                .foregroundStyle(.blue.gradient)

            Text("Assistant de développement")
                .font(.headline)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 24)
    }

    // MARK: - Previous Session Card

    private func previousSessionCard(sessionId: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "clock.arrow.circlepath")
                    .foregroundColor(.blue)
                Text("Session précédente")
                    .font(.headline)
            }

            Text("ID: \(sessionId.prefix(8))...")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack(spacing: 12) {
                Button {
                    viewModel.resumeSession(sessionId: sessionId, appState: appState)
                } label: {
                    Label("Reprendre", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button {
                    viewModel.forgetSession()
                } label: {
                    Label("Oublier", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(.red)
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }

    // MARK: - New Session Form

    private var newSessionForm: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Nouvelle Session")
                .font(.title2)
                .fontWeight(.bold)

            // Repository URL
            VStack(alignment: .leading, spacing: 4) {
                Text("URL du repository")
                    .font(.caption)
                    .foregroundColor(.secondary)

                TextField("https://github.com/user/repo.git", text: $viewModel.repoUrl)
                    .textFieldStyle(.roundedBorder)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .keyboardType(.URL)
            }

            // Auth method picker
            VStack(alignment: .leading, spacing: 4) {
                Text("Méthode d'authentification")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Picker("Auth", selection: $viewModel.authMethod) {
                    Text("Aucune").tag(AuthMethod.none)
                    Text("SSH").tag(AuthMethod.ssh)
                    Text("HTTP").tag(AuthMethod.http)
                }
                .pickerStyle(.segmented)
            }

            // SSH Key input
            if viewModel.authMethod == .ssh {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Clé SSH privée")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    TextEditor(text: $viewModel.sshKey)
                        .frame(height: 100)
                        .font(.system(.caption, design: .monospaced))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color(.systemGray4), lineWidth: 1)
                        )
                }
            }

            // HTTP credentials
            if viewModel.authMethod == .http {
                VStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Nom d'utilisateur")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        TextField("username", text: $viewModel.httpUser)
                            .textFieldStyle(.roundedBorder)
                            .autocapitalization(.none)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("Mot de passe / Token")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        SecureField("password or token", text: $viewModel.httpPassword)
                            .textFieldStyle(.roundedBorder)
                    }
                }
            }

            // Provider selection
            VStack(alignment: .leading, spacing: 4) {
                Text("Provider LLM")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Picker("Provider", selection: $viewModel.selectedProvider) {
                    Text("Codex").tag(LLMProvider.codex)
                    Text("Claude").tag(LLMProvider.claude)
                }
                .pickerStyle(.segmented)
            }

            // Create button
            Button {
                viewModel.createSession(appState: appState)
            } label: {
                if viewModel.isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        .frame(maxWidth: .infinity)
                } else {
                    Label("Créer la session", systemImage: "plus.circle.fill")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(viewModel.isLoading || viewModel.repoUrl.isEmpty)
            .padding(.top, 8)
        }
        .padding()
        .background(Color(.systemBackground))
        .cornerRadius(12)
        .shadow(color: .black.opacity(0.1), radius: 8, y: 4)
    }
}

// MARK: - Auth Method Enum

enum AuthMethod: String, CaseIterable {
    case none
    case ssh
    case http
}

// MARK: - Preview

#Preview {
    SessionView()
        .environmentObject(AppState())
}
