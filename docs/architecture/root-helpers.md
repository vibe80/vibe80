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
- `vibecoder-root`: cree l'utilisateur Linux et l'arborescence d'un workspace
- `vibecoder-run-as`: execute une commande allowlist en tant qu'utilisateur workspace

Ils sont appeles via `sudo -n` depuis le serveur (utilisateur `vibecoder`).

## Sudoers minimal
Le serveur n'a le droit d'executer que ces deux binaires en root, sans mot de passe:
- `vibecoder-root`
- `vibecoder-run-as`

Aucun autre binaire root n'est autorise.

## Creation de workspace (vibecoder-root)
Flux simplifie:
1) Le serveur appelle `sudo vibecoder-root create-workspace --workspace-id <id>`
2) Le helper cree l'utilisateur Linux (si absent)
3) Le helper cree l'arborescence:
   - `/home/<workspaceId>/vibecoder_workspace/metadata`
   - `/home/<workspaceId>/vibecoder_workspace/sessions`
4) Permissions et ownership:
   - `chown` sur l'utilisateur workspace et le groupe du workspace
   - `chmod 02750` (setgid + groupe)

Ce choix de groupe permet au serveur (non-root) d'acceder aux metadonnees sans ouvrir les acces en lecture a d'autres utilisateurs.

Schema de flux (ASCII):
```
Client/REST
   |
   v
Server (user: vibecoder)
   | sudo -n vibecoder-root create-workspace --workspace-id wxxxx
   v
Root helper (vibecoder-root)
   | useradd + mkdir + chown + chmod
   v
/home/wxxxx/vibecoder_workspace/...
```

## Execution de commandes (vibecoder-run-as)
Le serveur passe toutes les commandes sensibles via:
```
sudo -n vibecoder-run-as --workspace-id <id> --cwd <path> --env KEY=VALUE -- <cmd> <args>
```

Mecanismes de restriction:
- **Allowlist de commandes**: seules les commandes explicites sont autorisees (git, ssh-keyscan, mkdir, chmod, rm, tee, codex, claude, shell, id)
- **Allowlist d'environnement**: `GIT_SSH_COMMAND`, `GIT_CONFIG_GLOBAL`, `GIT_TERMINAL_PROMPT`, `TERM`
- **PATH force**: `/usr/local/bin:/usr/bin:/bin`
- **CWD confine**: le `--cwd` doit rester dans `/home/<workspaceId>`
- **Execution**: `syscall.Credential` force l'UID/GID du workspace

Schema de flux (ASCII):
```
Client/WS
   |
   v
Server (user: vibecoder)
   | sudo -n vibecoder-run-as --workspace-id wxxxx -- <cmd>
   v
Run-as helper
   | allowlist + env filter + cwd check
   v
Commande executee en user workspace (UID/GID wxxxx)
```

## Variables d'environnement
Le serveur peut redefinir les chemins suivants:
- `VIBECODER_ROOT_HELPER` (defaut: `/usr/local/bin/vibecoder-root`)
- `VIBECODER_RUN_AS_HELPER` (defaut: `/usr/local/bin/vibecoder-run-as`)
- `VIBECODER_SUDO_PATH` (defaut: `sudo`)
- `WORKSPACE_HOME_BASE` (defaut: `/home`)
- `VIBECODER_SERVER_USER` (defaut: `vibecoder`)

## Points d'attention
- Toute nouvelle commande doit etre ajoutee a l'allowlist Go puis redeployee
- Toute variable d'environnement supplementaire doit etre whitelistee
- Les permissions `02750` sont un choix de securite deliberate pour conserver l'acces serveur tout en evitant l'acces world-readable
- Le helper `vibecoder-run-as` refuse toute commande non resolue ou hors allowlist

## Fichiers de reference
- Helpers Go: `tools/vibecoder-root/main.go`, `tools/vibecoder-run-as/main.go`
- Wrapper Node: `server/src/runAs.js`
- Integrations: `server/src/index.js`, `server/src/worktreeManager.js`, `server/src/codexClient.js`, `server/src/claudeClient.js`
- Image et sudoers: `Dockerfile`
