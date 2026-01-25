# M5Chat Mobile - Plan de Développement

## Vue d'ensemble

Application mobile native Android/iOS avec support futur WearOS, reproduisant les fonctionnalités essentielles de M5Chat.

**Architecture**: Kotlin Multiplatform (KMP)
**Exclusions**: Terminal, Logs JSONRPC, Diff avancé

---

## Phases de Développement

### Phase 1 : Fondations (Stable v0.1)

> **Objectif** : Structure projet KMP fonctionnelle avec communication serveur basique

#### 1.1 Setup Projet KMP
- [x] Initialisation projet Gradle multi-modules
- [x] Configuration module `shared` (commonMain, androidMain, iosMain)
- [x] Setup Kotlin Serialization
- [ ] Configuration CI/CD basique (GitHub Actions)

#### 1.2 Modèles de Données Partagés
- [x] `ChatMessage` (id, role, text, attachments, timestamp)
- [x] `MessageRole` enum (USER, ASSISTANT, TOOL_RESULT, COMMAND_EXECUTION)
- [x] `SessionState` (sessionId, provider, connected, processing)
- [x] `LLMProvider` enum (CODEX, CLAUDE)
- [x] `Worktree` modèle de base
- [x] `BranchInfo` et `RepoDiff`

#### 1.3 Client REST API
- [x] Configuration Ktor Client (shared)
- [x] Endpoint `POST /api/session` - création session
- [x] Endpoint `GET /api/session/:id` - état session
- [x] Endpoint `GET /api/branches` - liste branches
- [x] Endpoint `GET /api/models` - liste modèles
- [x] Gestion erreurs HTTP communes

#### 1.4 Android App Shell
- [x] Setup module Android avec Jetpack Compose
- [x] MainActivity + Navigation Compose
- [x] Écran placeholder SessionScreen
- [x] Écran placeholder ChatScreen
- [x] Theme Material 3

**Livrables v0.1** :
- Projet compile sur Android
- Module shared accessible depuis Android
- Appel REST API fonctionnel (création session)

---

### Phase 2 : Chat Temps Réel (Stable v0.2)

> **Objectif** : Conversation fonctionnelle avec streaming WebSocket

#### 2.1 Client WebSocket Shared
- [x] `WebSocketManager` avec Ktor WebSockets
- [x] Connexion avec sessionId en query param
- [x] Système ping/pong (25s interval)
- [x] Reconnexion automatique (exponential backoff)
- [x] États de connexion (Connecting, Connected, Disconnected, Error)

#### 2.2 Parsing Messages Serveur
- [x] Parser `ready` message
- [x] Parser `status` message
- [x] Parser `assistant_delta` (streaming)
- [x] Parser `assistant_message` (complet)
- [x] Parser `turn_started` / `turn_completed` / `turn_error`
- [x] Parser `provider_switched`
- [x] Parser `pong`

#### 2.3 Envoi Messages Client
- [x] Message `ping`
- [x] Message `send_message` avec texte
- [x] Message `switch_provider`
- [x] Sérialisation JSON des messages sortants

#### 2.4 UI Chat Android
- [x] `ChatViewModel` avec StateFlow
- [x] `MessageList` composable (LazyColumn)
- [x] `MessageBubble` composable (user/assistant)
- [x] `MessageComposer` (input + bouton send)
- [x] Indicateur de typing/processing
- [x] Auto-scroll sur nouveau message

#### 2.5 Rendu Markdown
- [x] Intégration Markwon
- [x] Support GFM (tables, strikethrough)
- [x] Blocs de code avec background
- [x] Liens cliquables

**Livrables v0.2** :
- Chat fonctionnel avec streaming
- Messages user/assistant affichés
- Markdown rendu correctement
- Reconnexion automatique

---

### Phase 3 : Session & Providers (Stable v0.3)

> **Objectif** : Création de session complète et switch provider

#### 3.1 SessionScreen Complet
- [x] Input URL repository
- [x] Sélection méthode auth (SSH / HTTP)
- [x] Input credentials (clé SSH ou user/password)
- [x] Sélection provider initial (Codex/Claude)
- [x] Bouton "Créer Session"
- [x] État de chargement (clonage repo)
- [x] Gestion erreurs (repo invalide, auth échouée)

#### 3.2 Provider Switching
- [x] UI chip/badge provider actif
- [x] Dialog sélection provider
- [x] Envoi `switch_provider` WebSocket
- [x] Réception `provider_switched`
- [x] Mise à jour historique messages
- [x] Animation transition

#### 3.3 Gestion État Session
- [x] Persistance sessionId (DataStore)
- [x] Reprise session existante au lancement
- [x] Détection session expirée
- [x] Bouton déconnexion/nouvelle session

#### 3.4 Gestion Attachments
- [x] Bouton attach dans composer
- [x] Sélecteur fichier Android
- [x] Upload fichier vers serveur
- [x] Affichage attachments dans messages
- [x] Preview images inline

**Livrables v0.3** :
- Création session depuis l'app
- Switch provider fonctionnel
- Persistence session
- Upload fichiers

---

### Phase 4 : Git & Branches (Stable v0.4)

> **Objectif** : Gestion branches et visualisation diff

#### 4.1 BranchesSheet
- [x] Bottom sheet branches
- [x] Affichage branche courante (badge)
- [x] Liste branches remote
- [ ] Bouton Fetch
- [x] Action switch branche
- [ ] Confirmation changement

#### 4.2 DiffSheet Simplifié
- [x] Bottom sheet diff
- [x] Endpoint `GET /api/worktree/:id/diff`
- [x] Liste fichiers modifiés avec status (A/M/D)
- [x] Vue diff unifiée par fichier
- [x] Coloration simple (+ vert, - rouge)
- [x] Scroll horizontal pour lignes longues

#### 4.3 Status Repository
- [ ] Indicateur changements non commités
- [ ] Badge nombre fichiers modifiés
- [ ] Refresh automatique après action LLM

#### 4.4 TopBar Enrichie
- [ ] Affichage nom branche
- [ ] Bouton accès branches
- [ ] Bouton accès diff
- [ ] Indicateur status connexion

**Livrables v0.4** :
- Navigation branches
- Visualisation diff basique
- Status repo visible

---

### Phase 5 : Worktrees (Stable v0.5)

> **Objectif** : Contextes parallèles fonctionnels

#### 5.1 Modèles Worktree Complets
- [ ] `WorktreeStatus` enum complet
- [ ] Messages par worktree
- [ ] Provider par worktree
- [ ] Couleur worktree

#### 5.2 UI Tabs Worktrees
- [ ] Barre tabs horizontale scrollable
- [ ] Tab "main" par défaut
- [ ] Tabs worktrees avec couleur
- [ ] Bouton "+" création
- [ ] Indicateur status (creating, processing)
- [ ] Swipe to close (avec confirmation)

#### 5.3 Création Worktree
- [ ] Bottom sheet création
- [ ] Input nom worktree
- [ ] Sélection provider
- [ ] Sélection branche source (optionnel)
- [ ] Envoi `create_parallel_request`
- [ ] Réception `worktree_created`

#### 5.4 Messages par Worktree
- [ ] Parser `worktree_message` events
- [ ] Historique séparé par worktree
- [ ] Switch contexte au tap tab
- [ ] Envoi message avec `worktreeId`

#### 5.5 Merge Worktree
- [ ] Bouton merge dans menu worktree
- [ ] Endpoint `POST /api/worktree/:id/merge`
- [ ] Affichage résultat merge
- [ ] Gestion conflits (message erreur)

**Livrables v0.5** :
- Création worktrees
- Chat par worktree
- Merge basique

---

### Phase 6 : iOS (Stable v0.6)

> **Objectif** : Application iOS fonctionnelle

#### 6.1 Setup iOS
- [ ] Configuration Xcode projet
- [ ] Intégration XCFramework KMP
- [ ] Podfile ou SPM setup
- [ ] Signing & capabilities

#### 6.2 UI SwiftUI - Écrans Principaux
- [ ] `SessionView` (création session)
- [ ] `ChatView` (conversation)
- [ ] `MessageRow` (bulle message)
- [ ] `ComposerView` (input)

#### 6.3 UI SwiftUI - Features
- [ ] `BranchesSheet`
- [ ] `DiffSheet`
- [ ] `WorktreeTabs`
- [ ] Provider switcher

#### 6.4 Intégration Module Shared
- [ ] Appels Ktor depuis iOS
- [ ] WebSocket manager
- [ ] Mapping types Kotlin → Swift
- [ ] Gestion async/await

#### 6.5 Spécificités iOS
- [ ] Haptic feedback
- [ ] Keyboard avoidance
- [ ] Safe area handling
- [ ] Dark mode support

**Livrables v0.6** :
- App iOS feature-complete
- Parité fonctionnelle avec Android

---

### Phase 7 : Polish & Production (Stable v1.0)

> **Objectif** : Application prête pour production

#### 7.1 Gestion Erreurs
- [ ] Écrans d'erreur dédiés
- [ ] Retry automatique intelligent
- [ ] Messages d'erreur user-friendly
- [ ] Logging Crashlytics/Sentry

#### 7.2 Performance
- [ ] Optimisation LazyColumn/LazyStack
- [ ] Caching images et attachments
- [ ] Debounce inputs
- [ ] Memory profiling

#### 7.3 Offline Partiel
- [ ] Cache local messages (Room/CoreData)
- [ ] Queue messages en attente
- [ ] Sync au retour connexion
- [ ] Banner mode offline

#### 7.4 Tests
- [ ] Tests unitaires module shared
- [ ] Tests UI Android (Compose)
- [ ] Tests UI iOS (XCTest)
- [ ] Tests intégration WebSocket

#### 7.5 Release
- [ ] Configuration ProGuard/R8
- [ ] App signing (release keys)
- [ ] Store listings (Play Store, App Store)
- [ ] Screenshots et assets

**Livrables v1.0** :
- Application stable production-ready
- Disponible sur stores

---

### Phase 8 : WearOS (Stable v1.1)

> **Objectif** : Companion app WearOS

#### 8.1 Setup Module Wear
- [ ] Module Gradle wear
- [ ] Compose for Wear OS
- [ ] Manifest WearOS

#### 8.2 DataLayer Communication
- [ ] `WearableClient` phone side
- [ ] `WearableListenerService` watch side
- [ ] Sync état session
- [ ] Sync dernier message

#### 8.3 UI Watch
- [ ] Écran principal simplifié
- [ ] Affichage dernier message
- [ ] Bouton commande vocale
- [ ] Bouton stop/continue
- [ ] Bouton ouvrir phone

#### 8.4 Tile
- [ ] `M5ChatTileService`
- [ ] Layout tile (status + message)
- [ ] Refresh périodique
- [ ] Click action

#### 8.5 Complications
- [ ] Short text (status)
- [ ] Icon (indicateur)
- [ ] Long text (message tronqué)

#### 8.6 Voice Input
- [ ] Intégration Speech-to-Text
- [ ] Envoi message vocal → phone → serveur
- [ ] Feedback confirmation

**Livrables v1.1** :
- App WearOS companion
- Tile fonctionnelle
- Commandes vocales

---

## Récapitulatif des Versions

| Version | Phase | Fonctionnalités Clés |
|---------|-------|---------------------|
| v0.1 | Fondations | Projet KMP, REST API, shell Android |
| v0.2 | Chat Temps Réel | WebSocket, streaming, Markdown |
| v0.3 | Session & Providers | Création session, switch provider, attachments |
| v0.4 | Git & Branches | Navigation branches, diff simplifié |
| v0.5 | Worktrees | Contextes parallèles, merge |
| v0.6 | iOS | App iOS complète |
| v1.0 | Production | Polish, tests, stores |
| v1.1 | WearOS | Companion watch, tile, voice |

---

## Structure Projet Cible

```
mobile/
├── build.gradle.kts              # Root build config
├── settings.gradle.kts
├── gradle.properties
│
├── shared/                       # Module KMP partagé
│   ├── build.gradle.kts
│   └── src/
│       ├── commonMain/
│       │   └── kotlin/
│       │       ├── models/       # Data classes
│       │       ├── network/      # Ktor clients
│       │       ├── websocket/    # WebSocket manager
│       │       └── repository/   # Data repositories
│       ├── androidMain/
│       │   └── kotlin/
│       └── iosMain/
│           └── kotlin/
│
├── androidApp/                   # Application Android
│   ├── build.gradle.kts
│   └── src/main/
│       ├── kotlin/
│       │   ├── ui/
│       │   │   ├── screens/      # SessionScreen, ChatScreen
│       │   │   ├── components/   # MessageBubble, Composer
│       │   │   └── theme/        # Material 3 theme
│       │   └── viewmodel/        # ViewModels
│       └── res/
│
├── iosApp/                       # Application iOS
│   ├── iosApp.xcodeproj
│   └── iosApp/
│       ├── Views/                # SwiftUI views
│       ├── ViewModels/
│       └── Assets.xcassets
│
└── wearApp/                      # Application WearOS
    ├── build.gradle.kts
    └── src/main/
        ├── kotlin/
        │   ├── ui/               # Wear Compose screens
        │   ├── tile/             # TileService
        │   └── complication/     # ComplicationDataSource
        └── res/
```

---

## Notes Techniques

### Dépendances Principales

**Shared (KMP)**
- `io.ktor:ktor-client-core` - HTTP/WebSocket
- `org.jetbrains.kotlinx:kotlinx-serialization-json`
- `org.jetbrains.kotlinx:kotlinx-coroutines-core`

**Android**
- `androidx.compose.*` - Jetpack Compose
- `io.noties.markwon:core` - Markdown
- `com.google.android.gms:play-services-wearable`

**iOS**
- SwiftUI (natif)
- swift-markdown (SPM)

**WearOS**
- `androidx.wear.compose:compose-*`
- `androidx.wear.tiles:tiles`

### Points d'Attention

1. **WebSocket mobile** : Gestion cycle de vie (foreground/background)
2. **Streaming texte** : Buffering pour éviter re-renders excessifs
3. **WearOS batterie** : Limiter syncs, utiliser ambient mode
4. **iOS KMP** : Mapping coroutines → async/await

---

*Dernière mise à jour : 2026-01-25*

---

## Changelog

### 2026-01-25 - Phase 1 Complétée

**Fichiers créés :**
- `mobile/settings.gradle.kts` - Configuration multi-modules
- `mobile/build.gradle.kts` - Build root avec version catalog
- `mobile/gradle.properties` - Propriétés Gradle/KMP
- `mobile/gradle/libs.versions.toml` - Catalogue de versions
- `mobile/gradle/wrapper/gradle-wrapper.properties`

**Module Shared :**
- `shared/build.gradle.kts` - Config KMP (Android + iOS)
- `shared/src/commonMain/kotlin/app/m5chat/shared/`
  - `Platform.kt` - Interface plateforme
  - `models/ChatMessage.kt` - Messages et attachments
  - `models/Session.kt` - État session
  - `models/Worktree.kt` - Worktrees
  - `models/Branch.kt` - Branches et diff
  - `models/WebSocketMessages.kt` - Messages WS (client/serveur)
  - `network/HttpClientFactory.kt` - Factory Ktor
  - `network/ApiClient.kt` - Client REST API
  - `network/WebSocketManager.kt` - Gestionnaire WebSocket
  - `repository/SessionRepository.kt` - Repository session
  - `di/SharedModule.kt` - Module Koin

**Module Android :**
- `androidApp/build.gradle.kts` - Config Android + Compose
- `androidApp/src/main/AndroidManifest.xml`
- `androidApp/src/main/kotlin/app/m5chat/android/`
  - `M5ChatApplication.kt` - Application avec Koin
  - `MainActivity.kt` - Activité principale
  - `di/AppModule.kt` - Module DI Android
  - `viewmodel/SessionViewModel.kt`
  - `viewmodel/ChatViewModel.kt`
  - `ui/navigation/NavHost.kt` - Navigation Compose
  - `ui/theme/Theme.kt` - Thème Material 3
  - `ui/screens/SessionScreen.kt` - Écran création session
  - `ui/screens/ChatScreen.kt` - Écran chat
  - `ui/components/MessageBubble.kt` - Composant message
- Ressources (strings, themes, colors, icons)

### 2026-01-25 - Phases 2 & 3 Avancées

**Améliorations Markdown :**
- `MessageBubble.kt` - Support blocs de code avec background coloré
- `MessageBubble.kt` - Liens cliquables avec LinkifyPlugin
- Ajout dépendance `markwon-html`

**Persistance Session (DataStore) :**
- `data/SessionPreferences.kt` - Gestion préférences session
- `SessionViewModel.kt` - Vérification session existante au lancement
- `SessionViewModel.kt` - Reprise session / détection expiration
- `SessionScreen.kt` - UI carte "Session précédente" avec reprise/oubli
- `SessionRepository.kt` - Méthode `reconnectSession()`

**DI :**
- `AppModule.kt` - Injection SessionPreferences dans ViewModels

### 2026-01-25 - Phase 3 Complétée

**Provider Switching avec Dialog :**
- `ui/components/ProviderSelectionDialog.kt` - Dialog sélection provider animé
- `ChatScreen.kt` - Intégration dialog provider
- `ChatViewModel.kt` - Méthodes showProviderDialog/hideProviderDialog
- Animation couleur sur sélection provider

**Gestion Attachments :**
- `data/AttachmentUploader.kt` - Service upload fichiers via OkHttp multipart
- `ChatScreen.kt` - File picker Android avec ActivityResultContracts
- `ChatScreen.kt` - Preview chips des fichiers en attente
- `ChatScreen.kt` - Barre de progression upload
- `ChatViewModel.kt` - Gestion pendingAttachments et upload
- `MessageBubble.kt` - Affichage attachments avec preview images (Coil)
- `MessageBubble.kt` - Affichage fichiers non-image avec icône et taille
- Ajout dépendance OkHttp pour multipart upload

**Modifications modèles :**
- `WebSocketMessages.kt` - Support List<Attachment> au lieu de List<String>
- `WebSocketManager.kt` - Mise à jour sendMessage avec attachments
- `SessionRepository.kt` - Méthode uploadAttachments
- `Session.kt` - Modèles AttachmentUploadResponse, UploadedFile

**CI/CD :**
- `.drone.yml` - Étape build_android_apk pour générer et publier APK
- `mobile/gradlew` - Wrapper Gradle pour CI
- `mobile/.gitignore` - Exclusion fichiers build

### 2026-01-25 - Phase 4 DiffSheet Complet

**Nouveau composant DiffSheet :**
- `ui/components/DiffSheet.kt` - Composant complet pour afficher les diffs
  - Parsing du diff git en structure de données (DiffFile, DiffHunk, DiffLine)
  - Liste des fichiers avec badge status (A/M/D/R)
  - Statistiques +/- par fichier et total
  - Vue diff expandable par fichier
  - Coloration syntaxique (+vert, -rouge)
  - Numéros de ligne (ancien/nouveau)
  - Scroll horizontal pour lignes longues
  - État vide élégant
