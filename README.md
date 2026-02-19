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
vibe80 --codex

# Run with Claude support
vibe80 --claude
```

The server starts on `http://localhost:5179` and prints a one-shot authentication link at startup.

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
