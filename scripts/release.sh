#!/bin/bash
# Builds a signed Tezgah release locally: Release build → signed with Tezgah's own certificate (so macOS
# keeps permissions across updates) → zip → Sparkle signature → appcast.xml. Nothing is uploaded; the
# zip and appcast.xml in build/release are what a GitHub release would carry.
#
#   scripts/release.sh            # uses ~/Documents/Tezgah-Signing/tezgah.p12 and p12-password.txt
#   MAC_SIGN_P12=… MAC_SIGN_PASSWORD=… scripts/release.sh   # CI: base64 p12 and password
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=build/release
rm -rf "$OUT" && mkdir -p "$OUT"
xcodegen generate >/dev/null
# Sparkle compares build numbers, not version names: every release gets a higher one (the number of commits).
BUILD=$(git rev-list --count HEAD)
xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -derivedDataPath build/DD-release test | tail -1
xcodebuild -project TezgahMac.xcodeproj -scheme Tezgah -configuration Release -derivedDataPath build/DD-release CURRENT_PROJECT_VERSION="$BUILD" build | tail -1
APP="build/DD-release/Build/Products/Release/Tezgah.app"
VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist")

# Sign with the self-signed certificate in a throwaway keychain; the user's keychain list is restored after.
P12_FILE=$(mktemp -d)/cert.p12
if [ -n "${MAC_SIGN_P12:-}" ]; then echo "$MAC_SIGN_P12" | base64 --decode > "$P12_FILE"; PASS="$MAC_SIGN_PASSWORD"
else cp ~/Documents/Tezgah-Signing/tezgah.p12 "$P12_FILE"; PASS=$(cat ~/Documents/Tezgah-Signing/p12-password.txt); fi
KC="$(dirname "$P12_FILE")/sign.keychain-db"; KCPASS=$(uuidgen)
SAVED=()
while IFS= read -r line; do line="${line#"${line%%[![:space:]]*}"}"; line="${line%\"}"; line="${line#\"}"; [ -n "$line" ] && SAVED+=("$line"); done < <(security list-keychains -d user)
cleanup() { security list-keychains -d user -s "${SAVED[@]}"; security delete-keychain "$KC" 2>/dev/null || true; rm -rf "$(dirname "$P12_FILE")"; }
trap cleanup EXIT
security create-keychain -p "$KCPASS" "$KC"
security unlock-keychain -p "$KCPASS" "$KC"
security import "$P12_FILE" -k "$KC" -P "$PASS" -T /usr/bin/codesign >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "$KCPASS" "$KC" >/dev/null
security list-keychains -d user -s "$KC" "${SAVED[@]}"
ID=$(security find-identity -p codesigning "$KC" | grep -oE '[0-9A-F]{40}' | head -1)
codesign --force --deep --timestamp=none --sign "$ID" --keychain "$KC" "$APP"
codesign --verify --deep --strict "$APP"
echo "signed with ${ID:0:8}…"

ZIP="$OUT/Tezgah-$VERSION.zip"
ditto -c -k --keepParent "$APP" "$ZIP"
SPARKLE=build/DD-release/SourcePackages/artifacts/sparkle/Sparkle/bin
"$SPARKLE/generate_appcast" --download-url-prefix "https://github.com/itsyunusacar/tezgah/releases/download/v$VERSION/" "$OUT"
# A copy for installing by hand, then the build's own copies go: every Tezgah.app on the disk shows up in Launchpad.
rm -rf "$OUT/Tezgah.app" && ditto "$APP" "$OUT/Tezgah.app.noindex/Tezgah.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
for a in build/DD-release/Build/Products/*/*.app; do "$LSREG" -u "$PWD/$a" 2>/dev/null || true; done
rm -rf build/DD-release/Build/Products
echo "ready: $ZIP and $OUT/appcast.xml (not uploaded); the app itself: $OUT/Tezgah.app.noindex/Tezgah.app"
