#!/bin/sh
# 打包 KoolCenter 离线安装包：dist/po0fw-<版本>.tar.gz（软件中心 → 离线安装）
# 软件中心按文件名第一个 - 或 _ 之前的部分识别插件名，所以文件名可以带版本号。
set -eu
cd "$(dirname "$0")"
VERSION=$(cat po0fw/version)
OUT=../dist/po0fw-$VERSION.tar.gz
for tool in node npm; do
    command -v "$tool" >/dev/null 2>&1 || { echo "构建网页需要 ${tool}（Node.js 22.18+）" >&2; exit 1; }
done
(cd web && npm ci --include=dev --no-audit --no-fund && npm run build) || { echo "网页构建失败" >&2; exit 1; }
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp -R po0fw "$stage/po0fw"
cp web/dist/Module_po0fw.asp "$stage/po0fw/webs/Module_po0fw.asp"
for f in po0fw/install.sh po0fw/uninstall.sh po0fw/scripts/po0fw_config.sh; do sh -n "$f"; done
chmod 755 "$stage/po0fw/install.sh" "$stage/po0fw/uninstall.sh" "$stage/po0fw/scripts/po0fw_config.sh"
mkdir -p ../dist
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$stage/package.tar.gz" --exclude .DS_Store -C "$stage" po0fw
mv "$stage/package.tar.gz" "$OUT"
echo "$OUT $(md5 -q "$OUT" 2>/dev/null || md5sum "$OUT" | cut -d' ' -f1)"
