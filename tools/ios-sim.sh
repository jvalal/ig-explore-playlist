#!/bin/zsh
# Builds the Safari (iPhone) extension and installs it in the iPhone Simulator.
#   tools/ios-sim.sh            build + install + launch
# Needs full Xcode (App Store) selected: sudo xcode-select -s /Applications/Xcode.app
# Written before Xcode was installed (2026-10-06): the converter's flags are checked against its
# --help first, and the script stops if any are missing.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="Explore Finds"
BUNDLE="com.jvalal.ExploreFinds"
OUT="build/ios"

xcodebuild -version >/dev/null 2>&1 || { echo "Full Xcode isn't selected. Install it from the App Store, then: sudo xcode-select -s /Applications/Xcode.app"; exit 1; }

node tools/build-safari.mjs

HELP="$(xcrun safari-web-extension-converter --help 2>&1 || true)"
for flag in --project-location --app-name --bundle-identifier --ios-only --no-open --copy-resources --force; do
  [[ "$HELP" == *"$flag"* ]] || { echo "safari-web-extension-converter has no $flag; update this script."; exit 1; }
done
rm -rf "$OUT"
xcrun safari-web-extension-converter dist/safari --project-location "$OUT" --app-name "$APP" \
  --bundle-identifier "$BUNDLE" --ios-only --no-open --copy-resources --force

PROJECT="$(find "$OUT" -maxdepth 2 -name '*.xcodeproj' | head -1)"
SIM="$(xcrun simctl list devices available | grep -E '^\s+iPhone' | head -1 | sed -E 's/^ *([^(]+[^ ]) \(([0-9A-F-]+)\).*/\2/')"
[[ -n "$SIM" ]] || { echo "No iPhone simulator found. Open Xcode once so it installs one."; exit 1; }
xcrun simctl boot "$SIM" 2>/dev/null || true
open -a Simulator

xcodebuild -project "$PROJECT" -scheme "$APP" -configuration Debug \
  -destination "id=$SIM" -derivedDataPath "$OUT/DerivedData" build | tail -5
APPDIR="$(find "$OUT/DerivedData/Build/Products" -maxdepth 2 -name "$APP.app" | head -1)"
xcrun simctl install "$SIM" "$APPDIR"
xcrun simctl launch "$SIM" "$BUNDLE" || true
echo "Installed in the Simulator. Next: Settings → Apps → Safari → Extensions → Explore Finds → on."
