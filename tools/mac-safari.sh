#!/bin/zsh
# Builds the Safari extension as a macOS app and opens it, for testing in your own Safari.
#   tools/mac-safari.sh
# No paid Apple account needed: the app is signed ad hoc. In Safari: Settings → Advanced →
# "Show features for web developers", then Develop → "Allow Unsigned Extensions" (resets each
# Safari launch), then Settings → Extensions → tick Explore Playlist Gen.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="Explore Playlist Gen"
BUNDLE="com.jvalal.Explore-Playlist-Gen" # the converter names the app after APP; the extension must share its prefix
OUT="build/mac"

xcodebuild -version >/dev/null 2>&1 || { echo "Full Xcode isn't selected: sudo xcode-select -s /Applications/Xcode.app"; exit 1; }

node tools/build-safari.mjs
rm -rf "$OUT"
xcrun safari-web-extension-converter dist/safari --project-location "$OUT" --app-name "$APP" \
  --bundle-identifier "$BUNDLE" --macos-only --no-open --no-prompt --copy-resources --force

PROJECT="$(find "$OUT" -maxdepth 2 -name '*.xcodeproj' | head -1)"
xcodebuild -project "$PROJECT" -scheme "$APP" -configuration Debug -derivedDataPath "$OUT/DerivedData" \
  CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build | tail -3
APPDIR="$(find "$OUT/DerivedData/Build/Products" -maxdepth 2 -name "$APP.app" | head -1)"
open "$APPDIR"
echo "Built $APPDIR. Next, in Safari: Develop → Allow Unsigned Extensions, then Settings → Extensions → $APP."
