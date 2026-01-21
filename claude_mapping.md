# Claude JSONL mapping (retro-engineering)

## Structure generale (JSONL)
- Chaque ligne est un event JSON.
- Ordre typique: system(init) -> alternance assistant/user (avec outils) -> result(success|error).
- Types top-level observes: system, assistant, user, result.
- assistant.message et user.message portent content[] heterogene (text, tool_use, tool_result).
- Les resultats d'outils sont sur des events user (pas assistant).

## Schema minimal implicite

Assistant message (extrait):
```
{
  "type": "assistant",
  "message": {
    "role": "assistant",
    "type": "message",
    "content": [
      { "type": "text", "text": "..." },
      { "type": "tool_use", "id": "toolu_...", "name": "Write", "input": { ... } }
    ],
    "usage": { ... }
  },
  "session_id": "...",
  "uuid": "..."
}
```

User tool result (extrait):
```
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "tool_result", "tool_use_id": "toolu_...", "content": "...", "is_error": true }
    ]
  },
  "tool_use_result": { "type": "create", "filePath": "...", "content": "...", "structuredPatch": [] }
}
```

Result final (extrait):
```
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "result": "texte final",
  "usage": { ... },
  "modelUsage": { ... }
}
```

## Details par type
- system.init: cwd, session_id, tools[], permissionMode, model, claude_code_version, slash_commands[], agents[].
- assistant.message.content:
  - text: message final (pas de delta).
  - tool_use: id, name (Write, Read, Glob, Bash, ...), input (objet libre).
- user.message.content:
  - tool_result: tool_use_id, content (string), is_error optionnel.
  - tool_use_result top-level: objet structure (type, filePath, content...) ou string d'erreur.
- result: synthese de fin + usage, modelUsage, permission_denials.

## Fonctionnalites portables
- Messages assistant: utiliser assistant.message.content[type=text] -> assistant_message.
- Outils: mapper tool_use + tool_result vers l'UI "command execution" existante.
  - tool_use -> item_started
  - tool_result -> command_execution_completed (output = content, status ok/err)
- Repo diff: inchange (calcul cote serveur apres reponse).
- Usage/cout: possible via result.usage et result.modelUsage.

## Fonctionnalites difficiles ou non portables telles quelles
- Streaming token-delta: pas de delta natif (messages complets). Simulable mais artificiel.
- turn_interrupt: pas d'API Claude CLI, seulement tuer le process.
- model/list + model/set: non exposes par le CLI; modele fixe ou param via config.
- Login OpenAI: non applicable; remplacer par upload credentials.json.
- Session persistante: process termine apres chaque requete; etat a reconstruire cote serveur.
