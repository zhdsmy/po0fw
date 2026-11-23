#!/bin/sh
source /koolshare/scripts/base.sh

# A concurrent package switch must finish before another installer prunes assets.
exec 8>/tmp/po0fw_install.lock || exit 1
flock 8 || exit 1

cru d po0fw >/dev/null 2>&1
# 持有运行锁直到卸载结束：正在运行的更新先结束；排队的更新拿到锁时脚本已删除，直接退出
exec 7>/tmp/po0fw_run.lock && flock 7
rm -f /koolshare/init.d/S99po0fw.sh
rm -f /koolshare/scripts/po0fw_config.sh /koolshare/scripts/.po0fw-app.new
rm -f /koolshare/webs/Module_po0fw.asp /koolshare/webs/.po0fw-app.new || exit 1
rm -f /koolshare/res/icon-po0fw.png /koolshare/res/po0fw-app.js /koolshare/res/po0fw-app.css /koolshare/res/.po0fw-app.new || exit 1
for asset in /koolshare/res/po0fw-app.*.js /koolshare/res/po0fw-app.*.css; do
    echo "${asset##*/}" | grep -Eq '^po0fw-app\.[0-9a-f]{20}\.(js|css)$' || continue
    rm -f "$asset" || exit 1
done
rm -f /tmp/upload/po0fw_log.txt /tmp/upload/po0fw_status.txt /tmp/po0fw_run.lock \
    /tmp/po0fw_backoff /tmp/po0fw_pinned /tmp/po0fw_curl.err /tmp/po0fw_notify.err

for key in $(dbus list po0fw_ | cut -d '=' -f 1) $(dbus list softcenter_module_po0fw_ | cut -d '=' -f 1); do
    dbus remove "$key"
done

rm -f /koolshare/scripts/uninstall_po0fw.sh
exit 0
