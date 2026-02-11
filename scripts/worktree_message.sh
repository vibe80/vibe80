#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/worktree_message.sh \
    --text "Your message" \
    [--file /path/to/file]... \
    [-h|--help]

Description:
  1) Login workspace -> retrieves workspaceToken
  2) Wakeup worktree (endpoint /wakeup, fallback /wakup)
  3) Optional attachments upload
  4) Send user message to worktree

Environment variables (required unless marked optional):
  BASE_URL
  WORKSPACE_ID
  WORKSPACE_SECRET
  SESSION_ID
  WORKTREE_ID
  TIMEOUT (optional, default: 30)

Requirements:
  - curl
  - jq
USAGE
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Erreur: commande requise introuvable: $1" >&2
    exit 1
  }
}

BASE_URL="${BASE_URL:-}"
WORKSPACE_ID="${WORKSPACE_ID:-}"
WORKSPACE_SECRET="${WORKSPACE_SECRET:-}"
SESSION_ID="${SESSION_ID:-}"
WORKTREE_ID="${WORKTREE_ID:-}"
TEXT=""
TIMEOUT="${TIMEOUT:-30}"
FILES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --text) TEXT="$2"; shift 2 ;;
    --file) FILES+=("$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd curl
require_cmd jq

[[ -n "$BASE_URL" ]] || { echo "BASE_URL is required" >&2; exit 1; }
[[ -n "$WORKSPACE_ID" ]] || { echo "WORKSPACE_ID is required" >&2; exit 1; }
[[ -n "$WORKSPACE_SECRET" ]] || { echo "WORKSPACE_SECRET is required" >&2; exit 1; }
[[ -n "$SESSION_ID" ]] || { echo "SESSION_ID is required" >&2; exit 1; }
[[ -n "$WORKTREE_ID" ]] || { echo "WORKTREE_ID is required" >&2; exit 1; }
[[ -n "$TEXT" ]] || { echo "--text is required" >&2; exit 1; }

if [[ ${#FILES[@]} -gt 0 ]]; then
  for f in "${FILES[@]}"; do
    [[ -f "$f" ]] || { echo "File not found: $f" >&2; exit 1; }
  done
fi

api() {
  local method="$1" url="$2" data="${3:-}" auth_token="${4:-}"
  local -a args
  args=(-sS -X "$method" "$url" --connect-timeout "$TIMEOUT" --max-time "$TIMEOUT")
  if [[ -n "$auth_token" ]]; then
    args+=(-H "Authorization: Bearer $auth_token")
  fi
  if [[ -n "$data" ]]; then
    args+=(-H "Content-Type: application/json" --data "$data")
  fi
  curl "${args[@]}"
}

echo "[1/4] Login workspace..."
LOGIN_BODY=$(jq -nc --arg workspaceId "$WORKSPACE_ID" --arg workspaceSecret "$WORKSPACE_SECRET" '{workspaceId:$workspaceId, workspaceSecret:$workspaceSecret}')
LOGIN_RESP=$(api POST "$BASE_URL/api/workspaces/login" "$LOGIN_BODY")
WORKSPACE_TOKEN=$(echo "$LOGIN_RESP" | jq -r '.workspaceToken // empty')

if [[ -z "$WORKSPACE_TOKEN" ]]; then
  echo "Workspace login failed. Response:" >&2
  echo "$LOGIN_RESP" | jq . >&2 || echo "$LOGIN_RESP" >&2
  exit 1
fi

echo "[2/4] Wakeup worktree..."
WAKE_URL="$BASE_URL/api/sessions/$SESSION_ID/worktrees/$WORKTREE_ID/wakeup"
WAKE_RESP=$(curl -sS -X POST "$WAKE_URL" \
  -H "Authorization: Bearer $WORKSPACE_TOKEN" \
  --connect-timeout "$TIMEOUT" --max-time "$TIMEOUT" \
  -w '\n%{http_code}')
WAKE_BODY=$(echo "$WAKE_RESP" | sed '$d')
WAKE_CODE=$(echo "$WAKE_RESP" | tail -n1)

if [[ "$WAKE_CODE" == "404" ]]; then
  WAKE_URL="$BASE_URL/api/sessions/$SESSION_ID/worktrees/$WORKTREE_ID/wakup"
  WAKE_RESP=$(curl -sS -X POST "$WAKE_URL" \
    -H "Authorization: Bearer $WORKSPACE_TOKEN" \
    --connect-timeout "$TIMEOUT" --max-time "$TIMEOUT" \
    -w '\n%{http_code}')
  WAKE_BODY=$(echo "$WAKE_RESP" | sed '$d')
  WAKE_CODE=$(echo "$WAKE_RESP" | tail -n1)
fi

if [[ "$WAKE_CODE" -lt 200 || "$WAKE_CODE" -ge 300 ]]; then
  echo "Wakeup failed ($WAKE_CODE). Response:" >&2
  echo "$WAKE_BODY" | jq . >&2 || echo "$WAKE_BODY" >&2
  exit 1
fi

ATTACHMENTS_JSON='[]'
if [[ ${#FILES[@]} -gt 0 ]]; then
  echo "[3/4] Upload attachments..."
  UPLOAD_URL="$BASE_URL/api/attachments/upload?session=$SESSION_ID"
  CURL_ARGS=(-sS -X POST "$UPLOAD_URL" -H "Authorization: Bearer $WORKSPACE_TOKEN" --connect-timeout "$TIMEOUT" --max-time "$TIMEOUT")
  for f in "${FILES[@]}"; do
    CURL_ARGS+=(-F "files=@$f")
  done
  UPLOAD_RESP=$(curl "${CURL_ARGS[@]}")

  ATTACHMENTS_JSON=$(echo "$UPLOAD_RESP" | jq -c '
    if type=="array" then
      map({name:(.name // .filename // "file"), path:(.path // .url // .id // ""), size:(.size // 0)})
    elif type=="object" and (.files|type)=="array" then
      .files | map({name:(.name // .filename // "file"), path:(.path // .url // .id // ""), size:(.size // 0)})
    else
      []
    end
  ')

  if [[ -z "$ATTACHMENTS_JSON" || "$ATTACHMENTS_JSON" == "null" ]]; then
    ATTACHMENTS_JSON='[]'
  fi

  if [[ "$ATTACHMENTS_JSON" == "[]" ]]; then
    echo "Note: upload completed, but no usable attachments were detected in the response."
  fi
else
  echo "[3/4] No attachments provided (optional)."
fi

echo "[4/4] Envoi message..."
MSG_BODY=$(jq -nc \
  --arg role "user" \
  --arg text "$TEXT" \
  --argjson attachments "$ATTACHMENTS_JSON" \
  '{role:$role, text:$text, attachments:$attachments}')

MSG_URL="$BASE_URL/api/sessions/$SESSION_ID/worktrees/$WORKTREE_ID/messages"
MSG_RESP=$(api POST "$MSG_URL" "$MSG_BODY" "$WORKSPACE_TOKEN")

echo "Success. /messages response:"
echo "$MSG_RESP" | jq . || echo "$MSG_RESP"
