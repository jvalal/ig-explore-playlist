#!/bin/zsh
# Builds the Safari extension as a macOS app and opens it, for testing in your own Safari.
#   tools/mac-safari.sh
# No paid Apple account needed: it is signed with your free Personal Team. In Safari: Settings → Advanced →
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
# Our own start screen in place of the converter's default one (platforms/safari/mac-app/).
SRC="$(dirname "$PROJECT")/$APP"
cp platforms/safari/mac-app/Main.html "$SRC/Resources/Base.lproj/Main.html"
cp platforms/safari/mac-app/Script.js platforms/safari/mac-app/Style.css "$SRC/Resources/"
cp platforms/safari/mac-app/ViewController.swift "$SRC/ViewController.swift"
# Safari refuses ad hoc signing ("Computing the code signing dictionary failed"). A free Personal
# Team (Xcode › Settings › Accounts, any Apple ID) is enough for your own Safari. TEAM overrides.
TEAM="${TEAM:-$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null | sed -n 's/.*teamID = \([A-Z0-9]*\);/\1/p' | head -1)}"
[[ -n "$TEAM" ]] || { echo "No Apple team in Xcode. Add your Apple ID in Xcode › Settings › Accounts, or set TEAM=<team id>."; exit 1; }
xcodebuild -project "$PROJECT" -scheme "$APP" -configuration Debug -derivedDataPath "$OUT/DerivedData" \
  -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" build | tail -3
BUILT="$(find "$OUT/DerivedData/Build/Products" -maxdepth 2 -name "$APP.app" | head -1)"
# Safari ignores extensions from apps inside a cloud-synced folder (this repo is in OneDrive), so
# the app runs from ~/Applications. Unregister the build copy so Safari doesn't see two.
APPDIR="$HOME/Applications/$APP.app"
mkdir -p "$HOME/Applications"; rm -rf "$APPDIR"; ditto "$BUILT" "$APPDIR"
pluginkit -r "$BUILT/Contents/PlugIns/$APP Extension.appex" 2>/dev/null || true
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APPDIR"
open "$APPDIR"
echo "Installed $APPDIR. Next, in Safari: Develop → Allow Unsigned Extensions, then Settings → Extensions → $APP."
