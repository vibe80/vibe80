# m5chat

Application Node.js + React pour piloter des assistants (Codex app-server ou Claude CLI) sur un depot Git. Le serveur clone le depot, cree des worktrees pour chaque thread, et expose un chat en streaming avec diff/merge/terminal.

## Fonctionnalites

- Chat temps reel via WebSocket avec streaming des reponses.
- Multi-worktrees (branches isolees) avec diff, commits, merge et cherry-pick.
- Vue des diffs et rendu Markdown dans le client.
- Terminal web (xterm) connecte au repo de session.
- Upload d'attachments (pieces jointes) pour les agents.
- Support multi-fournisseurs: Codex et Claude.

## Prerequis

- Node.js >= 18
- Git
- `codex` installe et configure (pour le provider Codex)
- `claude` CLI installe et configure (optionnel)

## Demarrage rapide (dev)

1. Installer les dependances:
   ```bash
   npm install
   ```

2. Lancer frontend + backend:
   ```bash
   npm run dev
   ```

3. Ouvrir l'application:
   - Frontend: http://localhost:5173
   - Backend: http://localhost:5179/api/health

## Production

1. Construire le frontend:
   ```bash
   npm run build
   ```

2. Lancer le serveur:
   ```bash
   npm start
   ```

Le serveur sert alors le frontend construit depuis `client/dist`.

## Docker

Le Dockerfile installe Node, Codex, Claude CLI et les outils utiles (git, ssh, ripgrep, etc.).

Variables utiles au runtime:
- `PORT`: port HTTP du serveur (defaut 5179).
- `GIT_SSH_PRIVATE_KEY`: cle privee SSH pour cloner les repos.
- `GIT_COMMIT_USER_NAME` / `GIT_COMMIT_USER_EMAIL`: identite Git.
- `HOME_DIR`: base pour `.codex` et `.claude` (defaut HOME).
- `SYSTEM_PROMPT`: prompt systeme injecte aux providers.

## Notes de fonctionnement

- Le serveur clone le depot dans un dossier de session temporaire, puis cree des worktrees par thread.
- Les diffs sont calcules via `git diff` et exposes au client.
- Les messages sont diffuses en streaming via WebSocket.
