#!/bin/sh
# Signed + notarized Mac installer to share: app/dist/Hob-mac-arm64.dmg
# Needs the Developer ID certificate in the keychain and a notarytool profile:
#   xcrun notarytool store-credentials yap-notary --apple-id <Apple ID> --team-id 2JNSQVN3N8
# Builds into dist/ only: with another output folder electron-builder packs the whole project.
# To build while a copy from dist/ is running, run this in a separate checkout (git worktree).
set -e
cd "$(dirname "$0")/.."
ID="${HOB_SIGN_ID:-Christian Mathiesen (2JNSQVN3N8)}"
PROFILE="${HOB_NOTARY_PROFILE:-yap-notary}"
rm -rf dist
npm run native
npx electron-vite build
CSC_NAME="$ID" npx electron-builder --mac --publish never
# the app holds only the built code: a source folder inside means the build settings weren't applied
if npx --yes @electron/asar list dist/mac-arm64/Hob.app/Contents/Resources/app.asar | grep -qE '^/(src|dist|test|e2e)/'; then
  echo "app.asar has source folders in it; stopping" >&2
  exit 1
fi
DMG=$(ls dist/*.dmg)
# electron-builder signs the app, not the disk image; downloads are checked against the image too
codesign --force --sign "Developer ID Application: $ID" --timestamp "$DMG"
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler staple "$DMG"
xcrun stapler staple dist/mac-arm64/Hob.app
spctl -a -t open --context context:primary-signature -vv "$DMG"
echo "Ready to share: $(pwd)/$DMG"
