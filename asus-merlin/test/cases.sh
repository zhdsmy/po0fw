#!/bin/sh
# po0fw_config.sh 的回归用例，由 asus-merlin/test.sh 在 busybox 容器里运行。
# curl、dbus、cru、logger、sleep 都是 mock，见 test/mock/。IP 全部用文档保留网段。
S=/koolshare/scripts/po0fw_config.sh
HOME_C24=203.0.113.0/24
NEW_C24=198.51.100.0/24
PASS=0; FAIL=0
ok() { if eval "$2"; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "FAIL [$1] $2"; dump; fi; }
dump() {
    echo "  status: $(tr '\n' '|' </tmp/upload/po0fw_status.txt 2>/dev/null)"
    echo "  log: $(tr '\n' '|' </tmp/upload/po0fw_log.txt 2>/dev/null)"
    echo "  dbus: $(tr '\n' ' ' </state/dbus.env)"
    echo "  notify: $(tr '\n' '|' </state/notify.log 2>/dev/null)"
}
# t [last]：清空状态，写入默认设置（Bark 通知）
t() {
    rm -rf /state /tmp/upload /tmp/po0fw_*; mkdir -p /state
    printf '%s\n' po0fw_enable=1 po0fw_token=pgnfw_TESTtoken123 po0fw_slot=1 po0fw_interval=5 \
        po0fw_notify=bark po0fw_bark_url=https://bark.example/BARKKEY >/state/dbus.env
    [ -n "$1" ] && echo "po0fw_last=$1" >>/state/dbus.env
    return 0
}
set_db() { grep -v "^${1%%=*}=" /state/dbus.env >/state/dbus.t; echo "$1" >>/state/dbus.t; mv /state/dbus.t /state/dbus.env; }
resp() { n=$1; shift; printf '%s\n' "$@" >/state/resp.$n; }
slot1() { resp "${2:-1}" 200 "{\"enabled\":true,\"whitelist\":[{\"ip\":\"${1%/24}\\/24\",\"slot\":1}]}"; }
last() { sed -n 's/^po0fw_last=//p' /state/dbus.env; }
db() { sed -n "s/^po0fw_$1=//p" /state/dbus.env; }
st() { head -n1 /tmp/upload/po0fw_status.txt; }
st2() { sed -n 2p /tmp/upload/po0fw_status.txt; }
cnt() { if [ -f "$1" ]; then wc -l <"$1"; else echo 0; fi; }
logn() { cnt /tmp/upload/po0fw_log.txt; }
curls() { cnt /state/curl.log; }
notes() { cnt /state/notify.log; }

/bin/busybox ash -n $S && echo "ash -n OK"

# ---- 加白请求与解析
t; resp 1 200 '{"enabled":true,"limit":5,"currentIp":"203.0.113.0\/24","whitelist":[{"ip":"192.0.2.0\/24","slot":0},{"ip":"203.0.113.0\/24","slot":1},{"ip":"198.18.0.0\/24","slot":null},{"ip":"198.18.1.0\/24","slot":4}]}'
$S run cron; ok first '[ "$(last)" = $HOME_C24 ] && [ "$(notes)" = 0 ] && st2 | grep -q "^白名单 4/5：192.0.2.0/24 #0 203.0.113.0/24 #1 198.18.0.0/24 # 198.18.1.0/24 #4 *$"'

t $HOME_C24; slot1 $HOME_C24
$S run cron; ok unchanged 'st | grep -q 未变化 && st2 | grep -q "^白名单 1：" && [ "$(logn)" = 0 ] && [ "$(notes)" = 0 ]'

t $HOME_C24; resp 1 200 '{"whitelist":[{"ip":"198.51.100.77","slot":1}]}'
$S run cron; ok exact-ip '[ "$(last)" = $NEW_C24 ]'
t $HOME_C24; resp 1 200 '{"whitelist":[{"ip":"198.51.100.77\/24","slot":1}]}'
$S run cron; ok nonzero-host '[ "$(last)" = $NEW_C24 ]'
t $HOME_C24; resp 1 200 '{"enabled":true,"whitelist":[]}'
$S run cron; ok empty 'st | grep -q "没有槽位 1"'
t $HOME_C24; printf '200\n{\n  "enabled": true,\n  "whitelist": [\n    {\n      "slot": 1,\n      "ip": "198.51.100.0\\/24"\n    }\n  ]\n}\n' >/state/resp.1
$S run cron; ok pretty '[ "$(last)" = $NEW_C24 ]'
t $HOME_C24; resp 1 200 '{"enabled":false,"whitelist":[{"ip":"198.51.100.0\/24","slot":1}]}'
$S run cron; ok disabled 'st | grep -q 防火墙未启用 && [ "$(last)" = $HOME_C24 ]'

# ---- 错误处理
t $HOME_C24; resp 1 403 '{"code":403,"message":"IP is already pinned to another slot."}'
$S run cron; r=$?; $S run cron; ok pinned-once '[ $r = 0 ] && st | grep -q "⚠️" && [ "$(logn)" = 1 ] && [ -f /tmp/po0fw_pinned ]'
slot1 $HOME_C24 2; slot1 $HOME_C24 3
$S run cron; ok pinned-cleared '[ ! -f /tmp/po0fw_pinned ] && st | grep -q 未变化'

t $HOME_C24; resp 1 429 '{"code":429,"message":"Too many firewall update attempts. Please try again later."}'; slot1 $HOME_C24 2
$S run cron; ok 429 '[ -f /tmp/po0fw_backoff ] && st | grep -q 429 && [ "$(curls)" = 1 ] && [ -z "$(db fail_count)" ]'
$S run cron; ok 429-cron-skipped '[ "$(curls)" = 1 ]'
$S run web; ok 429-web-runs '[ "$(curls)" = 2 ] && [ ! -f /tmp/po0fw_backoff ] && st | grep -q 未变化'
t $HOME_C24; echo 1 >/tmp/po0fw_backoff; slot1 $HOME_C24
$S run cron; ok backoff-expired '[ "$(curls)" = 1 ] && st | grep -q 未变化'

t $HOME_C24; printf '502\n<html>\n<head><title>502 Bad Gateway</title></head>\n<body>x</body>\n</html>\n' >/state/resp.1
$S run cron; ok 5xx '[ "$(curls)" = 3 ] && [ "$(logn)" = 1 ] && [ "$(cnt /tmp/upload/po0fw_status.txt)" = 2 ]'
t $HOME_C24; resp 1 000; slot1 $HOME_C24 2
$S run cron; ok 000-then-200 '[ "$(curls)" = 2 ] && st | grep -q 未变化'
t $HOME_C24; resp 1 404 '<pre>Cannot POST /api/firewall/pgnfw_TESTtoken123/add</pre>'
$S run cron; ok redact '! grep -q TESTtoken /tmp/upload/po0fw_status.txt /tmp/upload/po0fw_log.txt /state/syslog.log && grep -q "pgnfw_\*\*\*" /tmp/upload/po0fw_status.txt'
t; set_db 'po0fw_token=pgnfw_a;b'; $S run cron; ok bad-token 'st | grep -q 非法字符 && [ "$(curls)" = 0 ]'
t; set_db 'po0fw_token=x$(touch /state/pwned)`touch /state/pwned2`'; $S run cron
ok no-eval '[ ! -e /state/pwned ] && [ ! -e /state/pwned2 ] && st | grep -q 未配置'

# ---- 变化通知
t $HOME_C24; slot1 $NEW_C24; set_db po0fw_notify_fail=2
$S run cron; ok bark-sent '[ "$(last)" = $NEW_C24 ] && [ -z "$(db notify_fail)" ] && grep -q "https://bark.example/BARKKEY" /state/notify.log && grep -q "title=🛡️ po0 防火墙加白 --data-urlencode subtitle=🔄 出口网段已更新 · 📌 槽位 1 --data-urlencode body=🌐 $HOME_C24 → $NEW_C24 --data-urlencode icon=https://raw.githubusercontent.com/zhdsmy/po0fw/main/asus-merlin/po0fw/res/icon-po0fw.png " /state/notify.log && grep -q "group=po0fw" /state/notify.log && ! grep -q -- " -x " /state/notify.log'
t $HOME_C24; slot1 $NEW_C24; set_db po0fw_bark_url=https://bark.example/BARKKEY/
$S run cron; ok bark-trailing-slash 'grep -q "POST https://bark.example/BARKKEY --data" /state/notify.log'

t $HOME_C24; slot1 $NEW_C24; set_db po0fw_notify=telegram; set_db po0fw_tg_token=123:ABC_def; set_db po0fw_tg_chat=-100123; set_db po0fw_proxy=socks5h://192.0.2.9:7891
$S run cron; ok telegram-proxy 'grep -q "https://api.telegram.org/bot123:ABC_def/sendMessage" /state/notify.log && grep -q "chat_id=-100123 --data-urlencode text=🛡️ po0 防火墙加白|🔄 出口网段已更新 · 📌 槽位 1|🌐 $HOME_C24 → $NEW_C24$" /state/notify.log && grep -q -- "-x socks5h://192.0.2.9:7891" /state/notify.log && ! grep -q -- "-x" /state/curl.log'
t $HOME_C24; slot1 $NEW_C24; set_db po0fw_notify=telegram; set_db po0fw_tg_token=123:ABC; set_db po0fw_tg_chat=1; set_db po0fw_tg_api=https://tg.example
$S run cron; ok telegram-api 'grep -q "https://tg.example/bot123:ABC/sendMessage" /state/notify.log'

t $HOME_C24; slot1 $NEW_C24; echo 400 >/state/notify_code
$S run cron; r1=$?; ok notify-fail-1 '[ $r1 = 2 ] && [ "$(last)" = $HOME_C24 ] && [ "$(db notify_fail)" = 1 ] && st | grep -q "第 1 次" && grep -q "HTTP 400" /tmp/upload/po0fw_log.txt && ! grep -q BARKKEY /tmp/upload/po0fw_log.txt'
$S run cron; ok notify-fail-2 '[ "$(last)" = $HOME_C24 ] && [ "$(db notify_fail)" = 2 ]'
$S run cron; r3=$?; ok notify-fail-3-give-up '[ $r3 = 0 ] && [ "$(last)" = $NEW_C24 ] && [ -z "$(db notify_fail)" ] && [ "$(notes)" = 3 ] && grep -q "连续 3 次发送失败" /tmp/upload/po0fw_log.txt && [ -z "$(db fail_count)" ]'

t $HOME_C24; slot1 $NEW_C24; set_db po0fw_notify=off
$S run cron; ok notify-off '[ "$(last)" = $NEW_C24 ] && [ "$(notes)" = 0 ]'

# ---- 失败通知与恢复
t $HOME_C24; resp 1 400 '{"code":400,"message":"serviceId is required"}'
$S run cron; $S run cron; ok fail-2-quiet '[ "$(db fail_count)" = 2 ] && [ "$(notes)" = 0 ]'
$S run cron; ok fail-3-alert '[ "$(notes)" = 1 ] && grep -q "subtitle=🚨 连续 3 次加白失败 --data-urlencode body=❌ HTTP 400" /state/notify.log && [ "$(db fail_alerted)" = 1 ]'
$S run cron; ok fail-4-quiet '[ "$(notes)" = 1 ] && [ "$(db fail_count)" = 4 ]'
slot1 $HOME_C24 5; $S run cron; ok recovered '[ "$(notes)" = 2 ] && grep -q "subtitle=🎉 已恢复 --data-urlencode body=✅ 槽位 1" /state/notify.log && [ -z "$(db fail_count)" ] && [ -z "$(db fail_alerted)" ]'

t $HOME_C24; resp 1 400 '{}'; echo 000 >/state/notify_code
$S run cron; $S run cron; $S run cron; $S run cron
ok alert-send-fail '[ "$(notes)" = 2 ] && [ -z "$(db fail_alerted)" ] && [ "$(grep -c 失败通知发送失败 /tmp/upload/po0fw_log.txt)" = 1 ]'
slot1 $HOME_C24 5; rm /state/notify_code; $S run cron; ok no-recovery-without-alert '[ "$(notes)" = 2 ] && [ -z "$(db fail_count)" ]'

t $HOME_C24; resp 1 400 '{}'; set_db po0fw_fail_count=1; $S run cron; slot1 $HOME_C24 2
$S run cron; ok short-failure-quiet '[ "$(notes)" = 0 ] && [ -z "$(db fail_count)" ]'

# ---- 测试通知、并发、网页和启动参数
t $HOME_C24; slot1 $HOME_C24; $S run cron; $S notify-test
ok notify-test 'grep -q "subtitle=🔔 测试通知 --data-urlencode body=✅ 槽位 1" /state/notify.log && grep -q "测试通知已发送（bark）" /tmp/upload/po0fw_log.txt'
t; echo 000 >/state/notify_code; $S notify-test; ok notify-test-fail 'grep -q "测试通知发送失败（bark）curl: (7)" /tmp/upload/po0fw_log.txt && grep -q "body=还没有运行记录 " /state/notify.log'
t; set_db po0fw_notify=off; $S notify-test; ok notify-test-off 'grep -q "没有选择通知渠道" /tmp/upload/po0fw_log.txt && [ "$(notes)" = 0 ]'

t $HOME_C24; echo 1 >/state/real_sleep; echo 2 >/state/curl_sleep; slot1 $HOME_C24
$S run cron & /bin/busybox sleep 1; $S run cron; c1=$(curls); $S run wan-start; c2=$(curls); wait
ok lock '[ "$c1" = 1 ] && [ "$c2" = 2 ]'
rm -f /state/real_sleep /state/curl_sleep

t $HOME_C24; slot1 $HOME_C24
$S 12345 1; $S 12346 3; $S 12348 4; $S 12347 9; r9=$?; $S stop; $S kill; /bin/busybox sleep 1
ok web 'grep -q "RESP 12345" /state/resp.log && grep -q "RESP 12346" /state/resp.log && grep -q "RESP 12348" /state/resp.log && ! grep -q 12347 /state/resp.log && [ $r9 = 1 ] && ! grep -q "RESP stop" /state/resp.log && [ "$(grep -c "CRU d po0fw" /state/cru.log)" = 3 ] && grep -q 测试通知 /tmp/upload/po0fw_log.txt'

t; $S start; /bin/busybox sleep 1; ok start 'grep -q "CRU a po0fw \*/5 \* \* \* \* /koolshare/scripts/po0fw_config.sh run cron" /state/cru.log'
t; set_db po0fw_enable=0; $S restart; /bin/busybox sleep 1; ok restart-disabled '[ "$(grep -c "CRU a" /state/cru.log)" = 0 ] && [ "$(curls)" = 0 ]'

echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = 0 ]
