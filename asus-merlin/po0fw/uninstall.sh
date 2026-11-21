#!/bin/sh
source /koolshare/scripts/base.sh

cru d po0fw >/dev/null 2>&1
# 等正在运行的更新结束，避免它在删除之后重新写出状态文件和 dbus
flock /tmp/po0fw_run.lock true
rm -f /koolshare/init.d/S99po0fw.sh
rm -f /koolshare/scripts/po0fw_config.sh
rm -f /koolshare/webs/Module_po0fw.asp
rm -f /koolshare/res/icon-po0fw.png
rm -f /tmp/upload/po0fw_log.txt /tmp/upload/po0fw_status.txt /tmp/po0fw_run.lock \
    /tmp/po0fw_backoff /tmp/po0fw_pinned /tmp/po0fw_curl.err /tmp/po0fw_notify.err

for key in $(dbus list po0fw_ | cut -d '=' -f 1) $(dbus list softcenter_module_po0fw_ | cut -d '=' -f 1); do
    dbus remove "$key"
done

rm -f /koolshare/scripts/uninstall_po0fw.sh
exit 0
