# Root Helpers and Unprivileged Server Model

## Contexte
L'application a besoin d'actions root pour creer des workspaces (utilisateurs Linux distincts) et executer des commandes dans le contexte de chaque workspace. L'execution du serveur en root etait un risque securite. Le modele actuel execute le serveur en utilisateur non privilegie et delegue les actions root a des helpers explicites.

## Objectifs
- Reduire la surface d'execution root au strict necessaire
- Conserver une isolation forte par utilisateur Linux
- Encadrer les commandes permises et l'environnement d'execution
- Garder une separation claire entre creation de workspaces et execution en tant que workspace

## Helpers
Deux executables root sont installes dans l'image:
- `vibe80-root`: cree l'utilisateur Linux et l'arborescence d'un workspace
- `vibe80-run-as`: execute une commande allowlist en tant qu'utilisateur workspace

Ils sont appeles via `sudo -n` depuis le serveur (utilisateur `vibe80`).

## Sudoers minimal
Le serveur n'a le droit d'executer que ces deux binaires en root, sans mot de passe:
- `vibe80-root`
- `vibe80-run-as`

Aucun autre binaire root n'est autorise.

## Creation de workspace (vibe80-root)
Flux simplifie:
1) Le serveur appelle `sudo vibe80-root create-workspace --workspace-id <id>`
2) Le helper cree l'utilisateur Linux (si absent)
3) Le helper cree l'arborescence:
   - `/workspaces/<workspaceId>/metadata`
   - `/workspaces/<workspaceId>/sessions`
4) Permissions et ownership:
   - `chown` sur l'utilisateur workspace et le groupe du workspace
   - `chmod 02750` (setgid + groupe)

Ce choix de groupe permet au serveur (non-root) d'acceder aux metadonnees sans ouvrir les acces en lecture a d'autres utilisateurs.

Schema de flux (ASCII):
```
Client/REST
   |
   v
Server (user: vibe80)
   | sudo -n vibe80-root create-workspace --workspace-id wxxxx
   v
Root helper (vibe80-root)
   | useradd + mkdir + chown + chmod
   v
/workspaces/wxxxx/...
```

## Execution de commandes (vibe80-run-as)
Le serveur passe toutes les commandes sensibles via:
```
sudo -n vibe80-run-as --workspace-id <id> --cwd <path> --env KEY=VALUE -- <cmd> <args>
```

Mecanismes de restriction:
- **Allowlist de commandes**: seules les commandes explicites sont autorisees (git, ssh-keyscan, mkdir, chmod, rm, tee, codex, claude, shell, id)
- **Allowlist d'environnement**: `GIT_SSH_COMMAND`, `GIT_CONFIG_GLOBAL`, `GIT_TERMINAL_PROMPT`, `TERM`, `TMPDIR`, `CLAUDE_CODE_TMPDIR`
- **PATH force**: `/usr/local/bin:/usr/bin:/bin`
- **CWD confine**: le `--cwd` doit rester dans `/home/<workspaceId>` ou `/workspaces/<workspaceId>`
- **Execution**: `syscall.Credential` force l'UID/GID du workspace

Schema de flux (ASCII):
```
Client/WS
   |
   v
Server (user: vibe80)
   | sudo -n vibe80-run-as --workspace-id wxxxx -- <cmd>
   v
Run-as helper
   | allowlist + env filter + cwd check
   v
Commande executee en user workspace (UID/GID wxxxx)
```

## Variables d'environnement
Le serveur peut redefinir les chemins suivants:
- `VIBE80_ROOT_HELPER` (defaut: `/usr/local/bin/vibe80-root`)
- `VIBE80_RUN_AS_HELPER` (defaut: `/usr/local/bin/vibe80-run-as`)
- `VIBE80_SUDO_PATH` (defaut: `sudo`)
- `WORKSPACE_HOME_BASE` (defaut: `/home`)
- `WORKSPACE_ROOT_DIRECTORY` (defaut: `/workspaces`)
- `VIBE80_SERVER_USER` (defaut: `vibe80`)

## Points d'attention
- Toute nouvelle commande doit etre ajoutee a l'allowlist Go puis redeployee
- Toute variable d'environnement supplementaire doit etre whitelistee
- Les permissions `02750` sont un choix de securite deliberate pour conserver l'acces serveur tout en evitant l'acces world-readable
- Le helper `vibe80-run-as` refuse toute commande non resolue ou hors allowlist

## Fichiers de reference
- Helpers Go: `tools/vibe80-root/main.go`, `tools/vibe80-run-as/main.go`
- Wrapper Node: `server/src/runAs.js`
- Integrations: `server/src/index.js`, `server/src/worktreeManager.js`, `server/src/codexClient.js`, `server/src/claudeClient.js`
- Image et sudoers: `Dockerfile`
