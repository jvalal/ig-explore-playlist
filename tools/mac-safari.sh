#!/bin/zsh
# Builds the Safari extension as a macOS app and opens it, for testing in your own Safari.
#   tools/mac-safari.sh                        build, install to ~/Applications, open
#   TEAM=<paid team id> tools/mac-safari.sh --store    Mac App Store: archive, export a .pkg to build/mac/export
#   TEAM=<paid team id> tools/mac-safari.sh --upload   the same, uploaded to App Store Connect
# The store modes need the paid Apple Developer team (Team ID: developer.apple.com › Membership details).
# No paid Apple account needed: it is signed with your free Personal Team. In Safari: Settings → Advanced →
# "Show features for web developers", then Develop → "Allow Unsigned Extensions" (resets each
# Safari launch), then Settings → Extensions → tick Explore Playlist Gen.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="Explore Playlist Gen"
BUNDLE="com.jvalal.Explore-Playlist-Gen" # the converter names the app after APP; the extension must share its prefix
OUT="build/mac"
MODE="${1:-}"
[[ -z "$MODE" || "$MODE" == --store || "$MODE" == --upload ]] || { echo "Unknown option $MODE (use --store or --upload)"; exit 1; }
[[ -z "$MODE" || -n "${TEAM:-}" ]] || { echo "Set TEAM=<paid team id>: a Personal Team can't sign for the App Store."; exit 1; }

xcodebuild -version >/dev/null 2>&1 || { echo "Full Xcode isn't selected: sudo xcode-select -s /Applications/Xcode.app"; exit 1; }

node tools/build-safari.mjs --mac
rm -rf "$OUT"
xcrun safari-web-extension-converter dist/safari-mac --project-location "$OUT" --app-name "$APP" \
  --bundle-identifier "$BUNDLE" --macos-only --no-open --no-prompt --copy-resources --force

PROJECT="$(find "$OUT" -maxdepth 2 -name '*.xcodeproj' | head -1)"
# Our own start screen in place of the converter's default one (platforms/safari/mac-app/).
SRC="$(dirname "$PROJECT")/$APP"
cp platforms/safari/mac-app/Main.html "$SRC/Resources/Base.lproj/Main.html"
cp platforms/safari/mac-app/Script.js platforms/safari/mac-app/Style.css "$SRC/Resources/"
cp platforms/safari/mac-app/ViewController.swift "$SRC/ViewController.swift"
# Sharp app icon (AppIcon-1024.png, drawn from AppIcon.svg) in place of the converter's enlarged 128 px one.
for f in "$SRC/Assets.xcassets/AppIcon.appiconset/"*.png; do
  sips -z "$(sips -g pixelHeight "$f" | awk '/pixelHeight/{print $2}')" "$(sips -g pixelWidth "$f" | awk '/pixelWidth/{print $2}')" \
    platforms/safari/mac-app/AppIcon-1024.png --out "$f" >/dev/null
done
# Version from the extension's manifest; the build number must go up with every App Store upload.
VERSION="$(node -p "require('./dist/safari-mac/manifest.json').version")"
SETTINGS=(MARKETING_VERSION="$VERSION" CURRENT_PROJECT_VERSION="$(date +%Y%m%d%H%M)"
  INFOPLIST_KEY_LSApplicationCategoryType=public.app-category.music)
# Safari refuses ad hoc signing ("Computing the code signing dictionary failed"). A free Personal
# Team (Xcode › Settings › Accounts, any Apple ID) is enough for your own Safari. TEAM overrides.
TEAM="${TEAM:-$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null | sed -n 's/.*teamID = \([A-Z0-9]*\);/\1/p' | head -1)}"
[[ -n "$TEAM" ]] || { echo "No Apple team in Xcode. Add your Apple ID in Xcode › Settings › Accounts, or set TEAM=<team id>."; exit 1; }

if [[ -n "$MODE" ]]; then
  ARCHIVE="$OUT/$APP.xcarchive"
  xcodebuild -project "$PROJECT" -scheme "$APP" -configuration Release -derivedDataPath "$OUT/DerivedData" \
    -archivePath "$ARCHIVE" -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" \
    "${SETTINGS[@]}" archive | tail -3
  DEST=export; [[ "$MODE" == --upload ]] && DEST=upload
  cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DEST</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
</dict></plist>
PLIST
  xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportPath "$OUT/export" \
    -exportOptionsPlist "$OUT/ExportOptions.plist" -allowProvisioningUpdates | tail -3
  [[ "$DEST" == upload ]] && echo "Uploaded $VERSION. It shows in App Store Connect › TestFlight after Apple processes it." \
    || echo "Exported $VERSION to $OUT/export. Upload it with --upload, or with Apple's Transporter app."
  exit 0
fi
xcodebuild -project "$PROJECT" -scheme "$APP" -configuration Debug -derivedDataPath "$OUT/DerivedData" \
  -allowProvisioningUpdates CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM="$TEAM" "${SETTINGS[@]}" build | tail -3
BUILT="$(find "$OUT/DerivedData/Build/Products" -maxdepth 2 -name "$APP.app" | head -1)"
# Safari ignores extensions from apps inside a cloud-synced folder (this repo is in OneDrive), so
# the app runs from ~/Applications. Unregister the build copy so Safari doesn't see two.
APPDIR="$HOME/Applications/$APP.app"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
osascript -e "quit app \"$APP\"" 2>/dev/null || true # a running copy would only come to the front, still old
mkdir -p "$HOME/Applications"; rm -rf "$APPDIR"; ditto "$BUILT" "$APPDIR"
pluginkit -r "$BUILT/Contents/PlugIns/$APP Extension.appex" 2>/dev/null || true
"$LSREGISTER" -u "$BUILT" 2>/dev/null || true # so Spotlight and Launchpad open only the ~/Applications copy
"$LSREGISTER" -f "$APPDIR"
open "$APPDIR"
echo "Installed $APPDIR. Next, in Safari: Develop → Allow Unsigned Extensions, then Settings → Extensions → $APP."
