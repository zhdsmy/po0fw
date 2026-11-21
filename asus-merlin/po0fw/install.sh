#!/bin/sh
source /koolshare/scripts/base.sh
MODULE=po0fw
DIR=$(cd "$(dirname "$0")" && pwd)

for tool in curl flock cru; do
    which "$tool" >/dev/null 2>&1 || { echo_date "缺少 $tool，退出安装"; exit 1; }
done

cp -f "$DIR/scripts/po0fw_config.sh" /koolshare/scripts/po0fw_config.sh
cp -f "$DIR/uninstall.sh" /koolshare/scripts/uninstall_po0fw.sh
cp -f "$DIR/webs/Module_po0fw.asp" /koolshare/webs/Module_po0fw.asp
cp -f "$DIR/res/icon-po0fw.png" /koolshare/res/icon-po0fw.png
chmod 755 /koolshare/scripts/po0fw_config.sh /koolshare/scripts/uninstall_po0fw.sh
# 软件中心在 wan-start 时以 start 参数调用 init.d/S*
ln -sf /koolshare/scripts/po0fw_config.sh /koolshare/init.d/S99po0fw.sh

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
/koolshare/scripts/po0fw_config.sh start >/dev/null 2>&1
echo_date "po0fw $VERSION 安装完成"
exit 0
