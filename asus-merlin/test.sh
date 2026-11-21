#!/bin/sh
# 在 busybox 容器里用 mock 跑 po0fw_config.sh 的回归用例，需要 docker。
# 用法：asus-merlin/test.sh [busybox 版本]，默认 1.25（RT-AX86U 上的版本）
set -eu
cd "$(dirname "$0")"
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
cp test/mock/koolshare/base.sh po0fw/scripts/po0fw_config.sh "$T/"
docker run --rm -v "$PWD/test/mock/bin:/mock/bin:ro" -v "$T:/koolshare/scripts:ro" \
    -v "$PWD/test/cases.sh:/cases.sh:ro" "busybox:${1:-1.25}" sh /cases.sh
