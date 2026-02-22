# vibe80

Vibe80 is an open-source, AI-assisted coding platform that orchestrates LLM agents over Git repositories through a real-time web interface. It acts as a bridge between developers and AI coding agents — currently supporting Codex (OpenAI) and Claude Code (Anthropic) — providing a structured environment where these agents can read, write, and modify code within isolated, sandboxed workspaces.

## Key Capabilities

- Real-time AI chat — Stream-based conversation with AI agents that can read, write, and execute code in your repository.
- Multi-provider support — Switch between Codex (OpenAI) and Claude Code (Anthropic) within the same session, with independent model and reasoning configuration per provider
- Parallel worktrees — Create multiple isolated git worktrees (branches) within a session, each with its own AI agent, enabling parallel development tracks. Supports forking a worktree to inherit the conversation context
- Web terminal — Full PTY-based terminal access to the repository environment via xterm.js
- Mobile companion — Native Android (Jetpack Compose) and iOS (SwiftUI) apps built with Kotlin Multiplatform, with QR-code session handoff.
- Sandboxing — Landlock LSM, seccomp, and network control restrict what AI agents can access on the filesystem and network

## Prerequisites

- Node.js >= 18
- Git
- `codex` installed & configured (optional)
- `claude code` installed & configured (optional)

At least one of `codex` or `claude code` must be installed before starting.


## Quick Start (local)

```bash
npm install -g @vibe80/vibe80

# Run with Codex support
vibe80 run --codex

# Run with Claude support
vibe80 run --claude

# Run without opening browser automatically
vibe80 run --codex --no-open
```

The server starts on `http://localhost:5179` and prints a one-shot authentication link at startup.

## Workspace CLI (nouveau)

```bash
# Lister les workspaces connus localement
vibe80 workspace ls

# Définir / lire le workspace courant
vibe80 workspace use <workspaceId>
vibe80 workspace current
vibe80 workspace show

# Login workspace
vibe80 workspace login --workspace-id <id> --workspace-secret <secret>
# ou (mono_user)
vibe80 workspace login --mono-auth-token <token>

# Refresh / logout
vibe80 workspace refresh
vibe80 workspace logout

# Admin (si autorisé côté serveur)
vibe80 workspace create --enable codex --codex-auth-type api_key --codex-auth-value "$OPENAI_API_KEY"
vibe80 workspace update <workspaceId> --enable claude --claude-auth-type api_key --claude-auth-value "$ANTHROPIC_API_KEY"
vibe80 workspace rm <workspaceId> --yes
```

Notes:
- `workspace ls` is local-only (no API call).
- After `workspace login`, the CLI stores `refreshToken` locally and auto-refreshes `workspaceToken` for `session`, `worktree` and `message` commands (with one automatic retry on HTTP 401).

## Session CLI (nouveau)

```bash
# Lister / sélectionner / afficher
vibe80 session ls
vibe80 session use <sessionId>
vibe80 session current
vibe80 session show

# Créer / supprimer / santé
vibe80 session create --repo-url <repoUrl> [--name "My session"]
vibe80 session health [sessionId]
vibe80 session rm [sessionId] --yes

# Handoff
vibe80 session handoff create [sessionId]
vibe80 session handoff consume --token <handoffToken>
```

## Worktree CLI (phase 1 + 2)

```bash
# Lister / sélectionner / afficher
vibe80 worktree ls
vibe80 worktree use <worktreeId>
vibe80 worktree current
vibe80 worktree show

# Créer / fork / supprimer
vibe80 worktree create --provider codex [--name "Feature A"]
vibe80 worktree fork --from main [--name "Feature B"]
vibe80 worktree rename [worktreeId] --name "Nouveau nom"
vibe80 worktree rm [worktreeId] --yes

# Runtime + état git
vibe80 worktree wakeup [worktreeId]
vibe80 worktree status [worktreeId]
vibe80 worktree diff [worktreeId]
vibe80 worktree commits [worktreeId] --limit 20
```

## Message CLI (avec pièces jointes)

```bash
# Envoyer un message (et uploader des fichiers)
vibe80 message send --text "analyse ça" --file ./a.txt --file ./b.png

# Lister les messages d'un worktree
vibe80 message ls [--limit 50]

# Suivre les nouveaux messages (polling)
vibe80 message tail [--interval-ms 2000]
```

## Docker

### Docker with Codex

```bash
docker run \
  -e DEPLOYMENT_MODE=mono_user \
  -e VIBE80_MONO_ENABLE_CODEX=true \
  -v vibe80home:/home/vibe80 \
  -p 5179:5179 \
  vibe80/vibe80
```

### Docker with Claude

```bash
docker run --rm -it \
  -e DEPLOYMENT_MODE=mono_user \
  -e VIBE80_MONO_ENABLE_CLAUDE=true \
  -v vibe80home:/home/vibe80 \
  -v $(realpath $(which claude)):/usr/bin/claude \
  -p 5179:5179 \
  vibe80/vibe80
```

> Unlike Codex (Apache-2.0), Claude Code is proprietary and cannot be distributed in the image. That is why the host Claude binary is mounted into the container.

## Mobile apps

- Android APK: https://github.com/vibe80/vibe80/releases
- iOS app: coming soon

## Documentation

Full documentation: https://vibe80.io/docs

## License

This project is licensed under the **Apache License 2.0**.

- Full license text: [LICENSE](LICENSE)
- Attribution notices: [NOTICE](NOTICE)
