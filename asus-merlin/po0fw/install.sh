#!/bin/sh
source /koolshare/scripts/base.sh
MODULE=po0fw
DIR=$(cd "$(dirname "$0")" && pwd)

for tool in curl flock cru; do
    which "$tool" >/dev/null 2>&1 || { echo_date "缺少 $tool，退出安装"; exit 1; }
done

# A concurrent package switch must finish before another installer prunes assets.
exec 8>/tmp/po0fw_install.lock || exit 1
flock 8 || exit 1

# The software-center /res/ handler requires literal filenames (no query string).
res=/koolshare/res
page=/koolshare/webs/Module_po0fw.asp
js=$(sed -n 's@.*src="/res/\(po0fw-app\.[0-9a-f]\{20\}\.js\)".*@\1@p' "$DIR/webs/Module_po0fw.asp")
[ -n "$js" ] || { echo_date "安装页缺少资源文件名"; exit 1; }
css=${js%.js}.css
for asset in "$js" "$css"; do
    [ -s "$DIR/res/$asset" ] || { echo_date "安装包缺少 $asset"; exit 1; }
done

# Copy to sibling temporary files so the active ASP always sees complete assets.
# Optional $3 sets the mode before the rename (scripts run from cron).
publish() {
    tmp=${2%/*}/.po0fw-app.new
    cp -f "$1" "$tmp" && { [ -z "$3" ] || chmod "$3" "$tmp"; } && mv -f "$tmp" "$2" && return 0
    rm -f "$tmp"
    return 1
}
if ! publish "$DIR/res/$js" "$res/$js" || ! publish "$DIR/res/$css" "$res/$css" ||
   ! publish "$DIR/webs/Module_po0fw.asp" "$page"; then
    if ! grep -Fq "src=\"/res/$js\"" "$page" 2>/dev/null; then
        rm -f "$res/$js" "$res/$css"
    fi
    echo_date "网页资源安装失败"
    exit 1
fi
# Retire the former fixed-name pair and any other build after the ASP switches.
rm -f "$res/po0fw-app.js" "$res/po0fw-app.css" || exit 1
for old in "$res"/po0fw-app.*.js "$res"/po0fw-app.*.css; do
    case "${old##*/}" in "$js"|"$css") continue;; esac
    echo "${old##*/}" | grep -Eq '^po0fw-app\.[0-9a-f]{20}\.(js|css)$' || continue
    rm -f "$old" || exit 1
done
# 脚本同样先写临时文件再改名，定时任务不会读到写了一半的脚本
# 软件中心在 wan-start 时以 start 参数调用 init.d/S*
publish "$DIR/scripts/po0fw_config.sh" /koolshare/scripts/po0fw_config.sh 755 &&
    publish "$DIR/uninstall.sh" /koolshare/scripts/uninstall_po0fw.sh 755 &&
    publish "$DIR/res/icon-po0fw.png" /koolshare/res/icon-po0fw.png &&
    ln -sf /koolshare/scripts/po0fw_config.sh /koolshare/init.d/S99po0fw.sh ||
    { echo_date "脚本安装失败"; exit 1; }

# 只在首次安装时写默认值，覆盖安装保留用户设置
[ -n "$(dbus get po0fw_slot)" ] || dbus set po0fw_slot=1
[ -n "$(dbus get po0fw_interval)" ] || dbus set po0fw_interval=5
[ -n "$(dbus get po0fw_enable)" ] || dbus set po0fw_enable=0
[ -n "$(dbus get po0fw_notify)" ] || dbus set po0fw_notify=off
# 1.0.x 的 Bark 开关在 1.1.0 改成了通知渠道设置，删除旧键
dbus remove po0fw_bark

VERSION=$(cat "$DIR/version")
dbus set po0fw_version="$VERSION"
dbus set softcenter_module_po0fw_install=1
dbus set softcenter_module_po0fw_name=po0fw
dbus set softcenter_module_po0fw_title="po0 防火墙加白"
dbus set softcenter_module_po0fw_description="把公网出口 /24 写入 po0 防火墙白名单的固定槽位"
dbus set softcenter_module_po0fw_version="$VERSION"

# 覆盖安装时按现有设置重新注册定时任务
/koolshare/scripts/po0fw_config.sh start 8>&- >/dev/null 2>&1
echo_date "po0fw $VERSION 安装完成"
exit 0
