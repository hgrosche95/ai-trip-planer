#!/bin/sh
# Lädt ein statisches ffmpeg (mit libx264, libvpx-vp9, libwebp) nach .bin/
set -e
cd "$(dirname "$0")"
mkdir -p .bin out
if [ ! -x .bin/ffmpeg ]; then
  curl -sL https://github.com/eugeneware/ffmpeg-static/releases/download/b6.0/ffmpeg-linux-x64.gz | gunzip > .bin/ffmpeg
  chmod +x .bin/ffmpeg
fi
.bin/ffmpeg -hide_banner -encoders 2>/dev/null | grep -qE 'libx264' && echo "ffmpeg bereit"
