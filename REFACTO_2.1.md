# Plan: Tache 2.1 — Extraire les routes API dans des fichiers separes

## Contexte

`server/src/index.js` fait 4 427 lignes. Toutes les routes HTTP, le WebSocket, les helpers, les services workspace/session/auth sont dans un seul fichier monolithique. L'objectif est de decouper les routes HTTP dans des fichiers distincts sous `server/src/routes/`, d'extraire les helpers partages dans `server/src/services/` et `server/src/middleware/`, et de reduire `index.js` a ~150-200 lignes (point d'entree, middleware globaux, WebSocket, `server.listen`).

Le projet utilise **ES modules** (`"type": "module"` dans `package.json`).

**Contrainte importante** : Le fichier `clientEvents.js` est importe a la ligne 53 mais n'existe pas encore dans le worktree. Il faudra le creer en meme temps ou gerer cette dependance.

## Structure cible

```
server/src/
  index.js                (~200 lignes) — point d'entree, middleware globaux, WS, listen
  routes/
    health.js             — GET /api/health
    workspaces.js         — POST/GET/PATCH/DELETE /api/workspaces/*
    sessions.js           — GET/POST/DELETE /api/sessions/*, /api/session/:id/*
    chat.js               — POST /api/session/:id/message, branches, models
    files.js              — GET/POST /api/worktree/:id/tree, /file, attachments
    git.js                — GET/POST branches, diff, git-identity, switch
    worktrees.js          — GET/POST/PATCH/DELETE /api/worktree(s)/*
  middleware/
    auth.js               — verifyWorkspaceToken, isPublicApiRequest, JWT auth middleware
    errorTypes.js         — middleware error_type normalization (res.json wrapper)
    debug.js              — middleware debug logging
  services/
    workspace.js          — createWorkspace, updateWorkspace, readWorkspaceConfig, etc.
    session.js            — createSession, getSession, cleanupSession, sessionGc, etc.
    auth.js               — JWT generation/verification, refresh tokens, handoff tokens
  helpers.js              — petites fonctions utilitaires partagees (generateId, parseCommandArgs, etc.)
```

## Etapes d'implementation

### Etape 1 : Creer `server/src/helpers.js` — fonctions utilitaires pures

Extraire les fonctions sans effets de bord ni dependances sur l'etat global :
- `generateId` (L452)
- `generateSessionName` (L454)
- `hashRefreshToken` (L456)
- `generateRefreshToken` (L459)
- `createMessageId` (L1423)
- `parseCommandArgs` (L423)
- `sanitizeFilename` (L1712)
- `getSessionTmpDir` (L1714)
- `createDebugId` (L122)
- `formatDebugPayload` (L127)
- `logDebug` (L156)
- `classifySessionCreationError` (L337)

### Etape 2 : Creer `server/src/middleware/auth.js`

Extraire :
- `loadJwtKey` (L437) + `jwtKey` (L450)
- `createWorkspaceToken` (L1263)
- `verifyWorkspaceToken` (L1276)
- `isPublicApiRequest` (L296)
- Le middleware JWT `app.use("/api", ...)` (L315-335)
- Constantes : `jwtKeyPath`, `jwtIssuer`, `jwtAudience`, `accessTokenTtlSeconds`

Export : un `createAuthMiddleware()` factory ou des fonctions individuelles + le middleware.

### Etape 3 : Creer `server/src/middleware/errorTypes.js`

Extraire le middleware `app.use((req, res, next) => { ... })` (L196-255) qui normalise `error_type` sur les reponses JSON.

### Etape 4 : Creer `server/src/middleware/debug.js`

Extraire :
- `attachWebSocketDebug` (L161)
- Le middleware de debug HTTP (L256-294)
- Dependances: `debugApiWsLog`, `createDebugId`, `formatDebugPayload`

### Etape 5 : Creer `server/src/services/auth.js`

Extraire :
- `issueWorkspaceTokens` (L461)
- `createHandoffToken` (L480)
- `cleanupHandoffTokens` (L495)
- `handoffTokens` Map (L74)
- Dependances: `hashRefreshToken`, `generateRefreshToken`, `createWorkspaceToken`, `generateId`, `storage`

### Etape 6 : Creer `server/src/services/workspace.js`

Extraire toutes les fonctions workspace (L504-1262) :
- `getWorkspacePaths`, `getWorkspaceSshPaths`, `getWorkspaceAuthPaths`
- `ensureWorkspaceDir`, `writeWorkspaceFile`, `appendWorkspaceFile`
- `workspaceUserExists`, `listWorkspaceEntries`, `getWorkspaceStat`
- `workspacePathExists`, `readWorkspaceFileBuffer`, `writeWorkspaceFilePreserveMode`
- `getWorkspaceUserIds`, `ensureWorkspaceUserExists`, `buildWorkspaceEnv`
- `appendAuditLog`
- `validateProvidersConfig`, `sanitizeProvidersForResponse`, `mergeProvidersForUpdate`
- `listEnabledProviders`, `pickDefaultProvider`
- `ensureWorkspaceUser`, `ensureWorkspaceIdsRecorded`, `scanWorkspaceIds`, `allocateWorkspaceIds`, `recoverWorkspaceIds`
- `ensureWorkspaceDirs`, `writeWorkspaceProviderAuth`, `writeWorkspaceConfig`
- `readWorkspaceConfig`, `readWorkspaceSecret`
- `ensureDefaultMonoWorkspace`, `createWorkspace`, `updateWorkspace`
- Constantes : `workspaceIdPattern`, `workspaceUidMin/Max`, `workspaceIdsUsed`, etc.

### Etape 7 : Creer `server/src/services/session.js`

Extraire :
- `touchSession` (L807)
- `createSession` (L1475)
- `getSession` (L1685)
- `getSessionFromRequest` (L1699)
- `cleanupSession` (L1309)
- `runSessionGc` (L1354)
- `stopClient` (L1288)
- `buildSessionEnv`, `runSessionCommand`, `runSessionCommandOutput`, `runSessionCommandOutputWithStatus` (L396-421)
- `appendMainMessage` (L1813)
- `getMessagesSince` (L1820)
- `appendRpcLog` (L1834)
- `broadcastRepoDiff` (L1850)
- `getRepoDiff` (L1875)
- `broadcastToSession` (L1969)
- `broadcastWorktreeDiff` (L1983)
- `resolveWorktreeRoot` (L1738)
- `buildDirectoryTree` (L1752)
- `ensureUniqueFilename` (L1896)
- Constantes : `TREE_IGNORED_NAMES`, `MAX_TREE_ENTRIES`, `MAX_TREE_DEPTH`, `MAX_FILE_BYTES`, `MAX_WRITE_BYTES`
- Constantes session : `sessionGcIntervalMs`, `sessionIdleTtlMs`, `sessionMaxTtlMs`, `sessionIdPattern`
- `modelCache`, `modelCacheTtlMs`

### Etape 8 : Creer `server/src/routes/health.js`

```js
import { Router } from "express";
export default function healthRoutes(deps) {
  const router = Router();
  router.get("/health", async (req, res) => { ... });
  return router;
}
```

Route : `GET /api/health` (L3196-3211)

### Etape 9 : Creer `server/src/routes/workspaces.js`

Routes (L3078-3195) :
- `POST /api/workspaces`
- `POST /api/workspaces/login`
- `POST /api/workspaces/refresh`
- `GET /api/workspaces/:workspaceId`
- `PATCH /api/workspaces/:workspaceId`
- `DELETE /api/workspaces/:workspaceId`

### Etape 10 : Creer `server/src/routes/sessions.js`

Routes (L3213-3605) :
- `GET /api/sessions`
- `POST /api/sessions/handoff`
- `POST /api/sessions/handoff/consume`
- `GET /api/session/:sessionId`
- `DELETE /api/session/:sessionId`
- `POST /api/session`
- `GET /api/session/:sessionId/last-commit`
- `GET /api/session/:sessionId/rpc-logs`
- `POST /api/session/:sessionId/clear`
- `POST /api/session/:sessionId/backlog`
- `GET /api/session/:sessionId/backlog`
- `PATCH /api/session/:sessionId/backlog`

### Etape 11 : Creer `server/src/routes/git.js`

Routes :
- `GET /api/session/:sessionId/git-identity` (L3375)
- `POST /api/session/:sessionId/git-identity` (L3413)
- `GET /api/session/:sessionId/diff` (L3447)
- `GET /api/branches` (L3607)
- `POST /api/branches/switch` (L3677)
- `GET /api/models` (L3627)

Helpers internes :
- `readGitConfigValue` (L3366)
- `normalizeRemoteBranches` (L1371)
- `getCurrentBranch` (L1381)
- `getLastCommit` (L1392)
- `getBranchInfo` (L1403)

### Etape 12 : Creer `server/src/routes/worktrees.js`

Routes (L3759-4280) :
- `GET /api/worktrees`
- `POST /api/worktree`
- `GET /api/worktree/:worktreeId`
- `GET /api/worktree/:worktreeId/tree`
- `GET /api/worktree/:worktreeId/file`
- `POST /api/worktree/:worktreeId/file`
- `GET /api/worktree/:worktreeId/status`
- `DELETE /api/worktree/:worktreeId`
- `PATCH /api/worktree/:worktreeId`
- `GET /api/worktree/:worktreeId/diff`
- `GET /api/worktree/:worktreeId/commits`
- `POST /api/worktree/:worktreeId/merge`
- `POST /api/worktree/:worktreeId/abort-merge`
- `POST /api/worktree/:worktreeId/cherry-pick`

### Etape 13 : Creer `server/src/routes/files.js`

Routes :
- `GET /api/attachments/file` (L4282)
- `GET /api/attachments` (L4317)
- `POST /api/attachments/upload` (L4350)
- Error middleware pour attachments (L4379-4385)

Dependances : `upload` (multer), `ensureUniqueFilename`

### Etape 14 : Refactorer `index.js`

Le fichier final ne contiendra que :
1. Imports des modules
2. `const app = express()` + `const server = http.createServer(app)`
3. `await storage.init()`
4. `await ensureDefaultMonoWorkspace()` (si `isMonoUser`)
5. Middleware globaux : `express.json()`, errorTypes, debug, auth
6. Montage des routes : `app.use("/api", healthRoutes(deps))`, etc.
7. WebSocket handlers (`wss.on("connection", ...)` et `terminalWss.on("connection", ...)`)
8. Static file serving + catch-all
9. `server.listen(port)` + `server.on("upgrade")`
10. Timers (session GC, handoff cleanup)

## Pattern d'injection de dependances

Les routes et services ont besoin de nombreuses dependances partagees (storage, helpers, config, etc.). Pour eviter les imports circulaires, utiliser un objet `deps` passe aux factories :

```js
// routes/health.js
export default function healthRoutes(deps) {
  const { getSession, touchSession, getActiveClient, deploymentMode, debugApiWsLog } = deps;
  const router = Router();
  // ...
  return router;
}
```

```js
// index.js
import healthRoutes from "./routes/health.js";
app.use("/api", healthRoutes(deps));
```

## Gestion de `clientEvents.js`

Le fichier `clientEvents.js` est importe (L53) mais n'existe pas. Il faut :
1. Soit creer le fichier avec les fonctions `attachCodexEvents` et `attachClaudeEvents` (en les extrayant des fonctions wrapper lignes 2032-2068 + de `codexClient.js`/`claudeClient.js`)
2. Soit ajuster l'import pour le moment et inclure ces fonctions dans un module existant

Option recommandee : creer `clientEvents.js` avec un stub minimal qui reexporte les fonctions depuis les client modules, car c'est la tache 2.2 qui gere le refactoring complet des event handlers.

## Verification

1. `node server/src/index.js` demarre sans erreur
2. Toutes les routes API repondent comme avant (memes paths, memes status codes)
3. Les connexions WebSocket fonctionnent
4. `index.js` fait moins de 200 lignes
5. Chaque fichier route fait moins de 400 lignes
