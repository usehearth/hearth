#!/usr/bin/env bash
# Installer branding: renders the sidebar (164x314, welcome and finish pages) and header (150x57) images for the
# Windows installer from brand/logo.svg with headless Edge, then converts them to 24-bit BMP (what NSIS wants).
#   bash brand/make-installer.sh   ->  src-tauri/installer/sidebar.bmp, header.bmp
set -euo pipefail
cd "$(dirname "$0")"
EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
OUT="$(cygpath -m "$PWD/../src-tauri/installer")"
HERE="$(cygpath -m "$PWD")"
FONT='font-family:"Segoe UI",system-ui,sans-serif'
shot() { # name width height html
  printf '%s' "$4" > "r-$1.html"
  "$EDGE" --headless=new --disable-gpu --hide-scrollbars --window-size=$2,$3 \
    --screenshot="$HERE/$1.png" "file:///$(cygpath -m "$PWD")/r-$1.html" >/dev/null 2>&1
  rm "r-$1.html"
  powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; \$i=[System.Drawing.Image]::FromFile('$HERE/$1.png'); \$b=New-Object System.Drawing.Bitmap $2,$3,([System.Drawing.Imaging.PixelFormat]::Format24bppRgb); \$g=[System.Drawing.Graphics]::FromImage(\$b); \$g.DrawImage(\$i,0,0,$2,$3); \$b.Save('$OUT/$1.bmp',[System.Drawing.Imaging.ImageFormat]::Bmp); \$g.Dispose(); \$b.Dispose(); \$i.Dispose()"
  rm "$1.png"
}
# Sidebar: the night-blue tile colour, the logo, the name and the line from the app.
shot sidebar 164 314 "<!doctype html><style>html,body{margin:0;width:164px;height:314px;background:#141A2B;overflow:hidden;$FONT}
div{display:flex;flex-direction:column;align-items:center;padding-top:62px}img{width:96px;height:96px;image-rendering:pixelated}
h1{margin:18px 0 0;font-size:24px;font-weight:600;color:#EADBC8;letter-spacing:.3px}p{margin:6px 0 0;font-size:12px;color:#F2A04A}</style>
<div><img src='logo.svg'><h1>Hearth</h1><p>Your AI, at home</p></div>"
# Header: sits at the top right of the white installer pages.
shot header 150 57 "<!doctype html><style>html,body{margin:0;width:150px;height:57px;background:#fff;overflow:hidden;$FONT}
div{display:flex;align-items:center;justify-content:flex-end;gap:8px;height:57px;padding-right:10px;box-sizing:border-box}
img{width:36px;height:36px;image-rendering:pixelated}span{font-size:17px;font-weight:600;color:#141A2B}</style>
<div><span>Hearth</span><img src='logo.svg'></div>"
echo "wrote $OUT/sidebar.bmp and header.bmp"
