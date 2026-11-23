#!/bin/bash
# Builds every ReelsEasy icon and logo file from the two renders in brand/source.
#
#   bash brand/build.sh
#
# source/icon-render.png    the app icon alone, 2048 px, transparent
# source/lockup-render.png  icon and name side by side, transparent
set -euo pipefail

cd "$(dirname "$0")"
NAVY="0x0A0E17"
rm -rf icon favicon logo social AppIcon.icns
mkdir -p icon favicon logo social .iconset

# The squircle fills about 74% of the render; macOS icons fill about 80%.
ffmpeg -v error -y -i source/icon-render.png -vf "crop=1896:1896,scale=1024:1024:flags=lanczos" icon/icon-1024.png
for size in 512 256 128 64 48 32 16; do
  ffmpeg -v error -y -i icon/icon-1024.png -vf "scale=$size:$size:flags=lanczos" "icon/icon-$size.png"
done
cp icon/icon-512.png icon.png

# macOS app icon.
for size in 16 32 128 256 512; do
  double=$((size * 2))
  ffmpeg -v error -y -i icon/icon-1024.png -vf "scale=$size:$size:flags=lanczos" ".iconset/icon_${size}x${size}.png"
  ffmpeg -v error -y -i icon/icon-1024.png -vf "scale=$double:$double:flags=lanczos" ".iconset/icon_${size}x${size}@2x.png"
done
mv .iconset AppIcon.iconset
iconutil -c icns AppIcon.iconset -o AppIcon.icns
rm -rf AppIcon.iconset

# Website icons. The phone ones sit on the brand's navy: phones do not show transparency.
cp icon/icon-16.png favicon/favicon-16.png
cp icon/icon-32.png favicon/favicon-32.png
cp icon/icon-48.png favicon/favicon-48.png
ffmpeg -v error -y -i icon/icon-48.png favicon/favicon.ico
for size in 180 192 512; do
  inner=$((size * 84 / 100))
  ffmpeg -v error -y -f lavfi -i "color=c=$NAVY:s=${size}x${size}" -i icon/icon-1024.png \
    -filter_complex "[1]scale=$inner:$inner:flags=lanczos[i];[0][i]overlay=(W-w)/2:(H-h)/2" -frames:v 1 "favicon/touch-$size.png"
done

# Logo with the name: as rendered (transparent), and on navy.
cp source/lockup-render.png logo/reelseasy-logo-transparent.png
ffmpeg -v error -y -f lavfi -i "color=c=$NAVY:s=2688x1520" -i source/lockup-render.png \
  -filter_complex "[0][1]overlay" -frames:v 1 logo/reelseasy-logo-on-navy.png

# Link preview picture for the website (1200x630).
ffmpeg -v error -y -f lavfi -i "color=c=$NAVY:s=1200x630" -i source/lockup-render.png \
  -filter_complex "[1]scale=1040:-1:flags=lanczos[l];[0][l]overlay=(W-w)/2:(H-h)/2" -frames:v 1 social/link-preview-1200x630.png

echo "Built: $(find icon favicon logo social -type f | wc -l | tr -d ' ') files and AppIcon.icns"
