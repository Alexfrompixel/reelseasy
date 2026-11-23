#!/bin/bash
# Builds "ReelsEasy.app" in the project folder.
#
#   bash app/build.sh
#
# Needs only the Xcode command line tools (swiftc), not the full Xcode setup.
# The app remembers where this project folder is, so run this again if the
# folder is moved.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/ReelsEasy.app"
BUILD="$ROOT/app/.build"
BUN="$(command -v bun || true)"
[ -n "$BUN" ] || { echo "bun is not installed (brew install bun)"; exit 1; }

rm -rf "$APP" "$BUILD" "$ROOT/Reel Editor.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$BUILD"

# Where the project and bun live, compiled into the app.
cat > "$BUILD/Config.swift" <<EOF
let projectRoot = "$ROOT"
let bunPath = "$BUN"
EOF

swiftc -O -parse-as-library -o "$APP/Contents/MacOS/ReelsEasy" "$BUILD/Config.swift" "$ROOT/app/ReelsEasy.swift" \
  -framework Cocoa -framework WebKit

# Icon: built from the logo by brand/build.sh.
[ -f "$ROOT/brand/AppIcon.icns" ] || bash "$ROOT/brand/build.sh"
cp "$ROOT/brand/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>ReelsEasy</string>
  <key>CFBundleDisplayName</key><string>ReelsEasy</string>
  <key>CFBundleIdentifier</key><string>com.reelseasy.app</string>
  <key>CFBundleExecutable</key><string>ReelsEasy</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
  </dict>
  <key>CFBundleDocumentTypes</key>
  <array>
    <dict>
      <key>CFBundleTypeName</key><string>Video clip</string>
      <key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key>
      <array>
        <string>public.movie</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
EOF

codesign --force --sign - "$APP" >/dev/null 2>&1 || true
echo "Built: $APP"
