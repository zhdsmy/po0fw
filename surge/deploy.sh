#!/bin/sh
# 把模块和脚本复制到 iCloud 上的 Surge 配置目录（同一 Apple ID 的 iOS、macOS 设备都从这里加载）。
set -eu
DEST="$HOME/Library/Mobile Documents/iCloud~com~nssurge~inc/Documents"
cd "$(dirname "$0")"
for f in po0fw.sgmodule po0fw.js; do
  if cmp -s "$f" "$DEST/$f"; then
    echo "unchanged: $f"
  else
    cp "$f" "$DEST/$f"
    echo "deployed:  $f"
  fi
done
