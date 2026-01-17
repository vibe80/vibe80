# m5chat

Application Node.js + React pour discuter avec `codex app-server` en JSON-RPC via stdin/stdout.

## Demarrage rapide

1. Installer les dependances :
   ```bash
   npm install
   ```

2. Lancer le frontend + backend :
   ```bash
   npm run dev
   ```

3. Ouvrir l'application :
   - Frontend : http://localhost:5173
   - Backend : http://localhost:5179/api/health

## Production (optionnel)

1. Construire le frontend :
   ```bash
   npm run build
   ```

2. Lancer le serveur :
   ```bash
   npm start
   ```

Le serveur sert alors le frontend construit depuis `client/dist`.

## Notes

- Le serveur demarre `codex app-server` et garde un thread unique associe au repertoire courant.
- Les messages sont envoyes via WebSocket et les reponses sont diffusees en streaming.
