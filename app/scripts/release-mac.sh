#!/bin/sh
# Signed + notarized Mac installer to share: app/dist/Hob-<version>-arm64.dmg
# Needs the Developer ID certificate in the keychain and a notarytool profile:
#   xcrun notarytool store-credentials yap-notary --apple-id <Apple ID> --team-id 2JNSQVN3N8
set -e
cd "$(dirname "$0")/.."
ID="${HOB_SIGN_ID:-Christian Mathiesen (2JNSQVN3N8)}"
PROFILE="${HOB_NOTARY_PROFILE:-yap-notary}"
# HOB_OUT: build somewhere else, e.g. while a copy from dist/ is running
OUT="${HOB_OUT:-dist}"
rm -rf "$OUT"
npm run native
npx electron-vite build
npx electron-builder --mac -c.mac.identity="$ID" -c.directories.output="$OUT" --publish never
DMG=$(ls "$OUT"/*.dmg)
# electron-builder signs the app, not the disk image; downloads are checked against the image too
codesign --force --sign "Developer ID Application: $ID" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler staple "$OUT"/mac-arm64/Hob.app
spctl -a -t open --context context:primary-signature -vv "$DMG"
echo "Ready to share: $(pwd)/$DMG"
