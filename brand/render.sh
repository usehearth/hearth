#!/usr/bin/env bash
# Renders brand/logo.svg to logo-512.png and logo-1024.png with headless Edge (Windows).
cd "$(dirname "$0")"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
for s in 512 1024; do
  printf '<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:%spx;height:%spx;image-rendering:pixelated}</style><img src="logo.svg">' $s $s > r$s.html
  "$EDGE" --headless=new --disable-gpu --default-background-color=00000000 --hide-scrollbars --window-size=$s,$s --screenshot="$(cygpath -w "$PWD")\logo-$s.png" "file:///$(cygpath -m "$PWD")/r$s.html" >/dev/null 2>&1
  rm r$s.html
done
