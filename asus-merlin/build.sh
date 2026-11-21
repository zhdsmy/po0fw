#!/bin/sh
# 打包 KoolCenter 离线安装包：dist/po0fw-<版本>.tar.gz（软件中心 → 离线安装）
# 软件中心按文件名第一个 - 或 _ 之前的部分识别插件名，所以文件名可以带版本号。
set -eu
cd "$(dirname "$0")"
VERSION=$(cat po0fw/version)
OUT=../dist/po0fw-$VERSION.tar.gz
for f in po0fw/install.sh po0fw/uninstall.sh po0fw/scripts/po0fw_config.sh; do sh -n "$f"; done
chmod 755 po0fw/install.sh po0fw/uninstall.sh po0fw/scripts/po0fw_config.sh
mkdir -p ../dist
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$OUT" --exclude .DS_Store po0fw
echo "$OUT $(md5 -q "$OUT" 2>/dev/null || md5sum "$OUT" | cut -d' ' -f1)"
