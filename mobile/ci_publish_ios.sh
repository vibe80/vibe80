#!/usr/bin/env bash
# Build + sign + export + upload (App Store Connect) in CI, fully non-interactive.
set -euo pipefail

# =========================
# CONFIG (adjust if needed)
# =========================
PROJECT_PATH="iosApp/iosApp.xcodeproj"
SCHEME="iosApp"
BUNDLE_ID="io.vibe80.app"
ARCHIVE_NAME="iosApp"
EXPORT_METHOD="app-store-connect"   # "app-store" is deprecated

# =========================
# REQUIRED ENV VARS / SECRETS
# =========================
: "${TEAM_ID:?Missing TEAM_ID}"
: "${KEYCHAIN_PASSWORD:?Missing KEYCHAIN_PASSWORD}"
: "${IOS_CERT_P12_B64:?Missing IOS_CERT_P12_B64}"
: "${IOS_CERT_P12_PASSWORD:?Missing IOS_CERT_P12_PASSWORD}"
: "${IOS_PROFILE_B64:?Missing IOS_PROFILE_B64}"

# ASC creds: prefer upload-specific secrets if provided, fallback to generic ones.
ASC_UPLOAD_KEY_ID="${ASC_UPLOAD_KEY_ID:-${ASC_KEY_ID:-}}"
ASC_UPLOAD_ISSUER_ID="${ASC_UPLOAD_ISSUER_ID:-${ASC_ISSUER_ID:-}}"
ASC_UPLOAD_KEY_P8_B64="${ASC_UPLOAD_KEY_P8_B64:-${ASC_KEY_P8_B64:-}}"

: "${ASC_UPLOAD_KEY_ID:?Missing ASC_UPLOAD_KEY_ID (or ASC_KEY_ID)}"
: "${ASC_UPLOAD_ISSUER_ID:?Missing ASC_UPLOAD_ISSUER_ID (or ASC_ISSUER_ID)}"
: "${ASC_UPLOAD_KEY_P8_B64:?Missing ASC_UPLOAD_KEY_P8_B64 (or ASC_KEY_P8_B64)}"

# =========================
# PATHS
# =========================
WORKDIR="$(pwd)"
BUILD_DIR="${WORKDIR}/build/appstore"
EXPORT_DIR="${BUILD_DIR}/export"
mkdir -p "$BUILD_DIR" "$EXPORT_DIR"

RUN_TMP="${RUNNER_TEMP:-/tmp}"

log() { echo "==> $*"; }
fail() { echo "❌ $*" >&2; exit 1; }

b64decode() {
  tr -d '\n\r ' | base64 --decode
}

command -v xcodebuild >/dev/null || fail "xcodebuild not found (need macOS runner with Xcode)."
command -v security   >/dev/null || fail "security tool not found."
command -v openssl    >/dev/null || fail "openssl not found."
command -v xcrun      >/dev/null || fail "xcrun not found."

log "Preparing temporary keychain"
KEYCHAIN_PATH="${RUN_TMP}/ci-signing.keychain-db"

security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security list-keychains -d user -s "$KEYCHAIN_PATH"
security default-keychain -d user -s "$KEYCHAIN_PATH"

log "Decoding P12 from base64"
P12_RAW="${RUN_TMP}/ios_cert.raw.p12"
echo "$IOS_CERT_P12_B64" | b64decode > "$P12_RAW" || fail "Failed to decode IOS_CERT_P12_B64"
chmod 600 "$P12_RAW"

log "Validating P12 password using openssl"
openssl pkcs12 -in "$P12_RAW" -nokeys -passin "pass:${IOS_CERT_P12_PASSWORD}" >/dev/null

log "Extracting certificate + private key from P12 (PEM)"
CERT_PEM="${RUN_TMP}/dist_cert.pem"
KEY_PEM="${RUN_TMP}/dist_key.pem"

openssl pkcs12 -in "$P12_RAW" \
  -passin "pass:${IOS_CERT_P12_PASSWORD}" \
  -clcerts -nokeys -out "$CERT_PEM" >/dev/null

openssl pkcs12 -in "$P12_RAW" \
  -passin "pass:${IOS_CERT_P12_PASSWORD}" \
  -nocerts -nodes -out "$KEY_PEM" >/dev/null

chmod 600 "$CERT_PEM" "$KEY_PEM"

log "Importing signing material into keychain"
security import "$KEY_PEM" -k "$KEYCHAIN_PATH" -A >/dev/null
security import "$CERT_PEM" -k "$KEYCHAIN_PATH" -A >/dev/null
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

log "Installing provisioning profile"
PROFILE_PATH="${RUN_TMP}/appstore.mobileprovision"
echo "$IOS_PROFILE_B64" | b64decode > "$PROFILE_PATH" || fail "Failed to decode IOS_PROFILE_B64"
chmod 600 "$PROFILE_PATH"

mkdir -p "$HOME/Library/MobileDevice/Provisioning Profiles"

PROFILE_PLIST="${RUN_TMP}/profile.plist"
security cms -D -i "$PROFILE_PATH" > "$PROFILE_PLIST"

PROFILE_UUID=$(/usr/libexec/PlistBuddy -c 'Print UUID' "$PROFILE_PLIST" 2>/dev/null || true)
[[ -n "${PROFILE_UUID:-}" ]] || fail "Could not read UUID from provisioning profile."
cp "$PROFILE_PATH" "$HOME/Library/MobileDevice/Provisioning Profiles/${PROFILE_UUID}.mobileprovision"

log "Archiving (Release, generic iOS device)"
rm -rf "${BUILD_DIR}/${ARCHIVE_NAME}.xcarchive"

xcodebuild \
  -project "$PROJECT_PATH" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "${BUILD_DIR}/${ARCHIVE_NAME}.xcarchive" \
  PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" \
  DEVELOPMENT_TEAM="$TEAM_ID" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="Apple Distribution" \
  PROVISIONING_PROFILE="$PROFILE_UUID" \
  clean archive

log "Creating ExportOptions.plist"
cat > "${BUILD_DIR}/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${EXPORT_METHOD}</string>
  <key>teamID</key>
  <string>${TEAM_ID}</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>${BUNDLE_ID}</key>
    <string>${PROFILE_UUID}</string>
  </dict>
  <key>uploadSymbols</key>
  <true/>
  <key>stripSwiftSymbols</key>
  <true/>
</dict>
</plist>
PLIST

log "Exporting IPA"
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

xcodebuild -exportArchive \
  -archivePath "${BUILD_DIR}/${ARCHIVE_NAME}.xcarchive" \
  -exportOptionsPlist "${BUILD_DIR}/ExportOptions.plist" \
  -exportPath "$EXPORT_DIR"

IPA_PATH="$(ls -1 "$EXPORT_DIR"/*.ipa 2>/dev/null | head -n 1 || true)"
[[ -n "${IPA_PATH:-}" && -f "$IPA_PATH" ]] || { ls -lah "$EXPORT_DIR" || true; fail "IPA not found after export."; }
log "IPA ready: $IPA_PATH"

log "Writing App Store Connect API private key file for altool"
ASC_KEYS_DIR="$HOME/.appstoreconnect/private_keys"
mkdir -p "$ASC_KEYS_DIR"

AUTHKEY_PATH="$ASC_KEYS_DIR/AuthKey_${ASC_UPLOAD_KEY_ID}.p8"
echo "$ASC_UPLOAD_KEY_P8_B64" | b64decode > "$AUTHKEY_PATH" || fail "Failed to decode ASC_UPLOAD_KEY_P8_B64/ASC_KEY_P8_B64"
chmod 600 "$AUTHKEY_PATH"
[[ -s "$AUTHKEY_PATH" ]] || fail "AuthKey file is empty: $AUTHKEY_PATH"

log "Uploading IPA to App Store Connect"
xcrun altool --upload-app \
  --type ios \
  --file "$IPA_PATH" \
  --apiKey "$ASC_UPLOAD_KEY_ID" \
  --apiIssuer "$ASC_UPLOAD_ISSUER_ID"

log "✅ Done: uploaded to App Store Connect"
