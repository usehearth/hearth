#!/usr/bin/env bash
# Renders brand/logo.svg with headless Edge (Windows):
#   brand/logo-512.png, brand/logo-1024.png        the rounded tile on transparent
#   public/icon-192.png, public/icon-512.png       the rounded tile on transparent (PWA)
#   public/apple-touch-icon.png                    180x180, full-bleed ember square (iOS rounds it itself)
#   public/icon-maskable-512.png                   full-bleed ember square, flame at 62% inside the safe zone
# Then regenerate the Tauri icons from logo-1024.png:
#   npx --yes @tauri-apps/cli@2.12.4 icon brand/logo-1024.png -o src-tauri/icons
#   (and delete the android/ and ios/ folders it adds; the app ships the files that were there before)
set -euo pipefail
cd "$(dirname "$0")"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
HERE="$(cygpath -m "$PWD")"
PUB="$(cygpath -m "$PWD/../public")"

# The flame and doorway from logo.svg, without the tile.
FLAME='<path d="M34 6C36 16 48 22 48 38A16 16 0 0 1 16 38C16 30 20 26 23 21C24 27 27 29 29 29C27 20 29 12 34 6Z" fill="#FFF3C4"/><path d="M26 55V45A6 6 0 0 1 38 45V55Z" fill="#E4501E"/>'

shot() { # out-path size html
  printf '%s' "$3" > r-shot.html
  "$EDGE" --headless=new --disable-gpu --default-background-color=00000000 --hide-scrollbars \
    --window-size=$2,$2 --screenshot="$1" "file:///$HERE/r-shot.html" >/dev/null 2>&1
  rm r-shot.html
}
tile() { # out-path size
  shot "$1" $2 "<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:${2}px;height:${2}px}</style><img src=\"logo.svg\">"
}
square() { # out-path size flame-transform
  shot "$1" $2 "<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style><svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" width=\"$2\" height=\"$2\"><rect width=\"64\" height=\"64\" fill=\"#E4501E\"/><g transform=\"$3\">$FLAME</g></svg>"
}

tile "$HERE/logo-512.png" 512
tile "$HERE/logo-1024.png" 1024
tile "$PUB/icon-192.png" 192
tile "$PUB/icon-512.png" 512
square "$PUB/apple-touch-icon.png" 180 'translate(0 2)'
# Scale the flame group (as it sits in the tile) by 0.62 about the centre: it fits the maskable safe circle (r = 40%).
square "$PUB/icon-maskable-512.png" 512 'translate(32 32) scale(0.62) translate(-32 -32) translate(0 2)'
echo "wrote brand/logo-512.png, logo-1024.png and public/icon-192.png, icon-512.png, apple-touch-icon.png, icon-maskable-512.png"
