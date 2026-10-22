#!/bin/sh
# Hob's app icon, README logo and disk image background: SVG → 1024 PNG (Electron) → .icns (iconutil, Mac).
set -e
cd "$(dirname "$0")/.."
node scripts/make-brand.mjs
npx electron build/render.cjs build/icon.svg build/icon.png
npx electron build/render.cjs ../docs/assets/hob-logo.svg ../docs/assets/hob-logo.png
# the disk image window ("Drag Hob into Applications")
npx electron build/render-dmg.cjs 1
npx electron build/render-dmg.cjs 2
set_dir=$(mktemp -d)/icon.iconset
mkdir -p "$set_dir"
for s in 16 32 128 256 512; do
  sips -z $s $s build/icon.png --out "$set_dir/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) build/icon.png --out "$set_dir/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$set_dir" -o build/icon.icns
echo "built build/icon.png, build/icon.icns, build/background(@2x).png, docs/assets/hob-logo.png"
