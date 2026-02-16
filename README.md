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

## Quick start

0. Clone this repo.

1. Install dependencies:
   ```bash
   npm install
   # Optional global install:
   # npm install -g .
   ```

2. Run:
   ```bash
   vibe80
   ```

3. A one-shot authentication link is printed to the console — open it to be automatically logged in.
   - The server starts on http://localhost:5179


## Docker installation

TODO
