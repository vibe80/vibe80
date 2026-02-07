# Plan de refactoring Vibe80

> Audit effectue le 2026-02-07. Chaque tache est autonome et peut etre implementee dans un commit isole.

## Etat des lieux

| Fichier | Lignes | Probleme |
|---|---|---|
| `server/src/index.js` | 5 125 | Monolithe : routes, auth, sessions, workspace, git, WebSocket, terminal, upload |
| `client/src/App.jsx` | 9 318 | Monolithe : tout le frontend dans un seul composant React |
| `client/src/index.css` | 4 623 | Styles globaux non modularises |
| `client/src/components/WorktreeTabs.jsx` | 922 | CSS inline dans le JSX (~400 lignes) |
| Total server `src/` | 7 601 | 67% concentre dans index.js |
| Total client `src/` | ~14 600 | 64% concentre dans App.jsx |
| Tests | 0 | Aucun fichier de test dans le projet |

---

## Phase 1 - Securite (priorite haute)

### 1.1 Ajouter du rate limiting sur les endpoints sensibles

**Fichiers concernes :** `server/src/index.js`, `server/package.json`

**Probleme :** Aucun rate limiter. Les endpoints `/api/workspaces` (creation), `/api/workspaces/login`, `/api/workspaces/refresh`, `/api/sessions` sont exposes au brute force.

**Action :**
- Installer `express-rate-limit`
- Appliquer un rate limiter global (`100 req/min`) sur `/api`
- Appliquer un rate limiter strict (`10 req/min`) sur les endpoints auth : `POST /api/workspaces/login`, `POST /api/workspaces/refresh`
- Appliquer un rate limiter (`20 req/min`) sur `POST /api/workspaces` (creation) et `POST /api/sessions` (creation)

**Critere de validation :** Les endpoints auth retournent `429 Too Many Requests` apres depassement du seuil.

---

### 1.2 Securiser le mode mono_user (workspace secret "default")

**Fichiers concernes :** `server/src/index.js`

**Probleme :** En mode `mono_user`, le workspace secret est initialise a la chaine `"default"` (ligne 1226). Tout utilisateur connaissant cette valeur peut s'authentifier.

**Action :**
- Remplacer `"default"` par `crypto.randomBytes(32).toString("hex")` dans `ensureDefaultMonoWorkspace`
- Ajouter un log au demarrage indiquant le chemin du fichier secret pour que l'operateur puisse le lire

**Critere de validation :** Le fichier `workspace.secret` en mono_user contient un secret aleatoire, pas `"default"`.

---

### 1.3 Eviter la fuite du JWT dans les query strings WebSocket

**Fichiers concernes :** `server/src/index.js`, `client/src/App.jsx`

**Probleme :** Les connexions WebSocket passent le token JWT via `?token=...` dans l'URL. Ce token apparait dans les logs serveur, proxy et l'historique navigateur.

**Action :**
- Cote client : envoyer le token dans le premier message WebSocket apres connexion (`{ type: "auth", token: "..." }`)
- Cote serveur : accepter la connexion WebSocket sans auth, attendre le premier message `auth`, verifier le token, puis rattacher la socket a la session. Deconnecter apres un timeout (5s) si pas de message auth recu.

**Critere de validation :** Aucun token n'apparait dans l'URL des connexions WebSocket.

---

### 1.4 Supprimer le fake OAuth token Claude

**Fichiers concernes :** `server/src/index.js`

**Probleme :** Le `setup_token` pour Claude est injecte avec `refreshToken: "dummy"` et `expiresAt: 1969350365482` hardcode (ligne 1167-1186). Fragile et potentiellement cassant.

**Action :**
- Documenter clairement dans le code que ce format est impose par la CLI Claude Code
- Ajouter un commentaire avec une reference vers la documentation Anthropic
- Extraire cette logique dans un module dedie `server/src/claudeAuth.js`
- Ajouter un `expiresAt` dynamique (now + 10 ans) au lieu d'une date fixe

**Critere de validation :** Le code d'auth Claude est isole dans son propre module avec des commentaires explicatifs.

---

## Phase 2 - Decoupage du serveur (priorite haute)

### 2.1 Extraire les routes API dans des fichiers separes

**Fichier source :** `server/src/index.js` (5 125 lignes)

**Probleme :** Toutes les routes HTTP sont definies dans un seul fichier. La revue de code et la maintenance sont extremement difficiles.

**Action :** Decouper `index.js` en modules routes :

```
server/src/
  index.js              -> point d'entree, app.listen, middleware globaux (~150 lignes)
  routes/
    workspaces.js       -> POST/PUT/GET /api/workspaces/*
    sessions.js         -> POST/GET/DELETE /api/sessions/*
    chat.js             -> POST /api/sessions/:id/message, modeles, providers
    files.js            -> GET/PUT /api/sessions/:id/files/*, tree, attachments
    git.js              -> GET/POST /api/sessions/:id/branches, commits, diff, push
    worktrees.js        -> POST/GET/DELETE /api/sessions/:id/worktrees/*
    terminal.js         -> upload WebSocket terminal
    health.js           -> GET /api/health
  middleware/
    auth.js             -> middleware JWT, verifyWorkspaceToken, isPublicApiRequest
    errorTypes.js       -> middleware error_type normalization
    debug.js            -> middleware debug logging
  services/
    workspace.js        -> createWorkspace, updateWorkspace, readWorkspaceConfig, etc.
    session.js          -> createSession, getSession, cleanupSession, sessionGc
    auth.js             -> JWT generation/verification, refresh tokens, handoff tokens
```

**Methode :** Proceder route par route. Chaque extraction est un commit isole. Commencer par les routes les plus independantes (`health`, `workspaces`), terminer par les plus couplees (`chat`, `worktrees`).

**Critere de validation :** `index.js` fait moins de 200 lignes. Chaque fichier route fait moins de 400 lignes.

---

### 2.2 Deduplication des event handlers client (Codex/Claude, main/worktree)

**Fichiers concernes :** `server/src/index.js`

**Probleme :** `attachClientEvents` et `attachClientEventsForWorktree` sont quasi-identiques (~250 lignes chacune). Meme chose pour `attachClaudeEvents` / `attachClaudeEventsForWorktree`.

**Action :**
- Creer un fichier `server/src/clientEvents.js`
- Factoriser en une seule fonction parametree par `{ sessionId, worktreeId, provider, isWorktree }`
- Les differences (worktreeId dans les broadcasts, updateWorktreeStatus vs broadcastRepoDiff) sont gerees par des conditions internes

**Critere de validation :** Un seul point d'attache d'events par type de client (codex, claude). Zero duplication.

---

### 2.3 Deduplication de `runCommand` / `runCommandOutput`

**Fichiers concernes :** `server/src/index.js`, `server/src/runAs.js`

**Probleme :** `runCommand`, `runCommandOutput` et `runCommandOutputWithStatus` sont definis a la fois dans `index.js` (lignes 328-369) et dans `runAs.js` (lignes 149-258). Les versions sont legerement differentes (gestion du stdin).

**Action :**
- Garder uniquement les versions de `runAs.js` (plus completes, gerent le stdin)
- Exporter depuis `runAs.js` et importer dans `index.js`
- Supprimer les doublons de `index.js`

**Critere de validation :** `runCommand` et `runCommandOutput` n'existent qu'a un seul endroit.

---

## Phase 3 - Decoupage du client (priorite haute)

### 3.1 Decouper App.jsx en composants et pages

**Fichier source :** `client/src/App.jsx` (9 318 lignes)

**Probleme :** Un seul composant React monolithique. Pas de code splitting, re-renders excessifs, impossible a tester.

**Action :** Decouper en composants et pages :

```
client/src/
  App.jsx                    -> routeur principal (~100 lignes)
  hooks/
    useWebSocket.js          -> connexion WS, reconnexion, ping/pong
    useSession.js            -> state session, messages, send
    useWorkspace.js          -> auth workspace, tokens, refresh
    useSettings.js           -> localStorage settings (theme, language, etc.)
    useFileExplorer.js       -> tree, file read/write
  pages/
    WorkspacePage.jsx        -> selection/creation workspace + login
    SessionPage.jsx          -> vue principale session (chat + panels)
    SessionListPage.jsx      -> liste des sessions existantes
  components/
    Chat/
      ChatMessages.jsx       -> liste des messages
      ChatComposer.jsx       -> input + attachments + send
      MessageBubble.jsx      -> un message (markdown, tool result, etc.)
      Vibe80Blocks.jsx       -> choices, forms, yesno
    Panels/
      DiffPanel.jsx          -> vue diff (react-diff-view)
      ExplorerPanel.jsx      -> arborescence fichiers + editeur Monaco
      TerminalPanel.jsx      -> xterm.js
      SettingsPanel.jsx      -> parametres utilisateur
      LogsPanel.jsx          -> JSON-RPC logs
    Layout/
      Header.jsx             -> barre superieure
      Sidebar.jsx            -> navigation laterale
```

**Methode :** Proceder composant par composant. Extraire les fonctions utilitaires pures en premier (`extractVibe80Blocks`, `parseFormFields`, etc.), puis les hooks, puis les composants visuels.

**Critere de validation :** `App.jsx` fait moins de 200 lignes. Aucun composant ne depasse 500 lignes.

---

### 3.2 Ajouter le code splitting avec React.lazy

**Fichiers concernes :** `client/src/App.jsx`, `client/vite.config.js`

**Probleme :** Tout le code est charge en un seul bundle (Monaco Editor = ~2 MB, xterm.js, react-diff-view, QRCode...).

**Action :**
- Utiliser `React.lazy` + `Suspense` pour les composants lourds :
  - `Monaco Editor` (charge uniquement quand l'explorateur de fichiers est ouvert)
  - `Terminal` (xterm.js, charge uniquement quand le terminal est ouvert)
  - `DiffPanel` (react-diff-view, charge uniquement quand le diff est ouvert)
  - `QRCode` (charge uniquement quand le QR est demande)
- Configurer les `manualChunks` dans Vite pour isoler les gros deps

**Critere de validation :** Le bundle initial fait moins de 500 KB gzippe. Les chunks secondaires se chargent a la demande.

---

### 3.3 Extraire le CSS inline des composants

**Fichiers concernes :** `client/src/components/WorktreeTabs.jsx`, `client/src/App.jsx`

**Probleme :** ~400 lignes de CSS dans une balise `<style>` inline dans WorktreeTabs.jsx. Probablement similaire dans App.jsx.

**Action :**
- Extraire les styles dans des fichiers CSS modules (`*.module.css`) ou des fichiers CSS co-locates
- Alternative : adopter un outil comme CSS Modules natif de Vite (deja supporte)

**Critere de validation :** Zero balise `<style>` dans les fichiers JSX.

---

## Phase 4 - Performance (priorite moyenne)

### 4.1 Debouncer `broadcastRepoDiff` apres les messages assistant

**Fichiers concernes :** `server/src/index.js`

**Probleme :** Chaque message assistant declenche un `git status --porcelain` + `git diff` complet. Sur de gros repos, plusieurs messages rapprochés declenchent des diffs paralleles inutiles.

**Action :**
- Implementer un debounce par session (500ms) sur `broadcastRepoDiff`
- Si un diff est deja en cours pour la session, ignorer les appels suivants et planifier un dernier appel a la fin

**Critere de validation :** Au maximum un `git diff` est execute par session dans une fenetre de 500ms.

---

### 4.2 Remplacer les spawns recursifs dans `buildDirectoryTree`

**Fichiers concernes :** `server/src/index.js`

**Probleme :** Chaque niveau de l'arborescence spawn un process `find`. Pour 8 niveaux de profondeur, ca peut representer des centaines de spawns.

**Action :**
- Remplacer par un seul appel `find` avec `-printf "%y\t%d\t%P\0"` sur toute la profondeur
- Parser le resultat en une seule passe pour construire l'arbre

**Critere de validation :** `buildDirectoryTree` ne spawn qu'un seul process `find`.

---

### 4.3 Ajouter un `busy_timeout` a SQLite

**Fichiers concernes :** `server/src/storage/sqlite.js`

**Probleme :** Pas de `PRAGMA busy_timeout` configure. Les acces concurrents en mode WAL peuvent generer des `SQLITE_BUSY`.

**Action :**
- Ajouter `PRAGMA busy_timeout = 5000;` apres `PRAGMA journal_mode = WAL;`

**Critere de validation :** Le pragma est present dans `ensureConnected()`.

---

### 4.4 Nettoyer les Maps inutilisees dans index.js

**Fichiers concernes :** `server/src/index.js`

**Probleme :** `sessions`, `workspaces`, `workspaceUserIds` sont declares comme `new Map()` en haut du fichier (lignes 63-65) mais le code utilise le storage (Redis/SQLite) via `storage.getSession()`. Ces Maps semblent etre des vestiges.

**Action :**
- Verifier que ces Maps ne sont referencees nulle part (grep)
- Les supprimer si confirmees inutilisees

**Critere de validation :** Aucune Map orpheline dans le code.

---

## Phase 5 - Stockage (priorite moyenne)

### 5.1 Ajouter un mecanisme de purge pour SQLite

**Fichiers concernes :** `server/src/storage/sqlite.js`

**Probleme :** Contrairement a Redis (TTL natif), SQLite n'a aucune expiration automatique. Les sessions expirees restent en base indefiniment.

**Action :**
- Ajouter une methode `purgeExpiredSessions(maxAgMs)` dans le backend SQLite
- Appeler cette methode depuis le session GC (`runSessionGc`)
- Requete : `DELETE FROM sessions WHERE lastActivityAt < ?`

**Critere de validation :** Le GC supprime les sessions SQLite expirees.

---

### 5.2 Eviter de toucher `globalSessionsKey` a chaque operation Redis

**Fichiers concernes :** `server/src/storage/redis.js`

**Probleme :** `touchTtl(globalSessionsKey(), sessionTtlMs)` est appele a chaque `saveSession`. Ce set global est constamment mis a jour inutilement.

**Action :**
- Supprimer le TTL sur `globalSessionsKey` (c'est un index global, il ne doit pas expirer)
- Ou le toucher uniquement dans `touchSession`, pas dans `saveSession`

**Critere de validation :** `saveSession` ne touche plus le TTL du set global.

---

## Phase 6 - Qualite et maintenabilite (priorite basse)

### 6.1 Ajouter des tests

**Probleme :** Zero test dans le projet.

**Action :**
- Installer un framework de test (`vitest` pour le serveur et le client car deja sur Vite)
- Ecrire des tests unitaires pour les modules extraits en premier :
  - `server/src/services/auth.js` : JWT sign/verify, refresh token hash
  - `server/src/runAs.js` : `buildSandboxArgs`, `buildRunAsArgs`, `validateCwd`
  - `client/src/App.jsx` : `extractVibe80Blocks`, `parseFormFields`, `parseCommandArgs`
- Ajouter un script `test` dans `package.json`

**Critere de validation :** Au moins 20 tests unitaires couvrant les fonctions critiques.

---

### 6.2 Corriger `private: false` dans le root package.json

**Fichiers concernes :** `package.json`

**Probleme :** Le package racine est configure pour etre publie sur npm publiquement. Un `npm publish` accidentel exposerait les sources.

**Action :**
- Si la publication npm est intentionnelle : s'assurer que le champ `files` exclut les fichiers sensibles (Dockerfiles, `.drone.yml`, `tools/`)
- Si la publication n'est pas intentionnelle : passer `"private": true`

**Critere de validation :** Soit `private: true`, soit `files` filtre correctement.

---

### 6.3 Pinner la version de Claude dans Dockerfile.base

**Fichiers concernes :** `Dockerfile.base`

**Probleme :** `curl -fsSL https://claude.ai/install.sh | bash` installe la derniere version sans verification de signature ni pinning.

**Action :**
- Pinner une version specifique de la CLI Claude Code
- Verifier le checksum du binaire apres telechargement
- Ou utiliser un package npm avec version fixe (`npm install -g @anthropic/claude-code@x.y.z`)

**Critere de validation :** Le Dockerfile utilise une version pinnee et verifiable.

---

### 6.4 Internationaliser proprement (optionnel)

**Fichiers concernes :** `client/src/i18n.jsx`

**Probleme :** Dictionnaire i18n hardcode dans le code (380 lignes). Pas de pluralisation, cles = textes anglais (fragile).

**Action :**
- Extraire les traductions dans des fichiers JSON (`locales/en.json`, `locales/fr.json`)
- Utiliser des cles stables (`workspace.created`) au lieu des textes anglais
- Optionnel : migrer vers `react-i18next` pour la pluralisation et le lazy loading

**Critere de validation :** Les traductions sont dans des fichiers JSON separes.

---

## Ordre d'execution recommande

| Etape | Tache | Risque | Effort |
|---|---|---|---|
| 1 | 4.3 - `busy_timeout` SQLite | Nul | 5 min |
| 2 | 4.4 - Nettoyer Maps inutilisees | Nul | 15 min |
| 3 | 1.1 - Rate limiting | Faible | 30 min |
| 4 | 1.2 - Secret mono_user | Faible | 15 min |
| 5 | 6.2 - `private: false` | Nul | 5 min |
| 6 | 2.3 - Dedupliquer runCommand | Faible | 30 min |
| 7 | 5.2 - globalSessionsKey Redis | Faible | 15 min |
| 8 | 4.1 - Debounce broadcastRepoDiff | Faible | 30 min |
| 9 | 5.1 - Purge SQLite | Faible | 30 min |
| 10 | 2.2 - Dedupliquer event handlers | Moyen | 1h |
| 11 | 1.4 - Extraire claudeAuth.js | Faible | 30 min |
| 12 | 2.1 - Decouper index.js en routes | Moyen | 3-4h |
| 13 | 3.1 - Decouper App.jsx en composants | Moyen | 4-6h |
| 14 | 1.3 - Auth WebSocket sans query string | Moyen | 1h |
| 15 | 3.2 - Code splitting React.lazy | Faible | 1h |
| 16 | 3.3 - Extraire CSS inline | Faible | 1h |
| 17 | 4.2 - Optimiser buildDirectoryTree | Moyen | 1h |
| 18 | 6.1 - Ajouter des tests | Faible | 2-3h |
| 19 | 6.3 - Pinner Claude dans Dockerfile | Faible | 15 min |
| 20 | 6.4 - i18n propre (optionnel) | Faible | 2h |
