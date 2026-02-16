# Plan Sprint 1 — Stratégie de tests serveur (validation)

## Objectif Sprint 1 (1 semaine)
Mettre en place l’infrastructure de test serveur + premiers tests sur les flux critiques auth/workspace, avec exécution automatique en CI.

## Résultats attendus (Definition of Done Sprint)
- Framework de test installé et configuré.
- Environnement de test isolé fonctionnel.
- Premiers tests **unitaires** + **intégration API** verts.
- Coverage générée, seuils minimaux activés.
- Pipeline CI qui bloque en cas d’échec.

---

## Backlog Sprint 1 (ordonné)

### 1) Initialisation outillage test
**Tâches**
- Installer `vitest` (ou `jest`) + `supertest`.
- Ajouter scripts npm :
  - `test`
  - `test:watch`
  - `test:coverage`
- Créer config test (`vitest.config.*` ou équivalent).

**DoD**
- `npm --workspace server run test` passe (même avec test dummy).

---

### 2) Standardiser l’environnement de test serveur
**Tâches**
- Créer un bootstrap test (`tests/setup.*`).
- Charger env test (`NODE_ENV=test`, `STORAGE_BACKEND=sqlite` recommandé au début).
- Isoler la base/stockage test (fichier DB temporaire ou mémoire).
- Ajouter hooks `beforeAll/afterAll` pour init/cleanup storage.

**DoD**
- Aucun test n’écrit dans les données dev/prod.
- Cleanup garanti après run.

---

### 3) Arborescence de tests
**Proposition**
- `server/tests/setup/`
- `server/tests/unit/services/`
- `server/tests/integration/routes/`
- `server/tests/fixtures/`
- `server/tests/factories/`

**DoD**
- Structure créée + README court “comment lancer”.

---

### 4) Vague unitaires (priorité auth/workspace)
**Cibles**
- `services/workspace.js` :
  - validation `workspaceIdPattern`
  - vérification secret (cas valid/invalid)
  - rotation secret (si ajoutée)
- `services/auth.js` :
  - génération tokens
  - refresh token : valid, expired, reused

**DoD**
- Cas nominaux + cas erreur couverts.
- Tests déterministes (pas flaky).

---

### 5) Vague intégration API (routes critiques)
**Cibles minimales**
- `POST /api/v1/workspaces/login`
  - credentials valides → 200
  - invalides → 401
- `POST /api/v1/workspaces/refresh`
  - refresh valide → 200
  - refresh invalide/expiré → 401
- `GET /api/v1/workspaces/:workspaceId`
  - accès autorisé/interdit

**DoD**
- Assertions sur code HTTP + payload + erreurs attendues.

---

### 6) Fixtures et factories
**Tâches**
- Factory workspace test.
- Helper pour créer credentials/tokens.
- Seed minimal réutilisable.

**DoD**
- Pas de duplication massive dans les tests.

---

### 7) Coverage + quality gates
**Tâches**
- Activer rapport coverage.
- Seuil Sprint 1 (réaliste) :
  - global: 50%
  - services auth/workspace: 70%

**DoD**
- Le run échoue si seuil non atteint.

---

### 8) CI (PR gate)
**Tâches**
- Ajouter job CI :
  1. install
  2. test
  3. coverage
- Publier artefact coverage (si supporté).

**DoD**
- PR bloquée si test rouge.

---

## Planning suggéré (5 jours)
- **J1**: Outillage + config + scripts npm
- **J2**: Env test isolé + setup/teardown
- **J3**: Unit tests workspace/auth
- **J4**: Intégration routes login/refresh/workspace
- **J5**: Coverage thresholds + CI + stabilisation

---

## Risques Sprint 1
- Couplage fort routes/services/storage rendant les tests lents.
- Setup env incomplet (variables obligatoires serveur).
- Flakiness sur tokens/dates.

**Mitigation**
- Mock partiel ciblé, freeze time pour tests token, stockage sqlite test dédié.

---

## Livrables concrets fin Sprint 1
- Config test et scripts npm opérationnels.
- ~15–30 tests fiables (unit + intégration).
- Coverage rapportée + seuils actifs.
- CI test gate active.
