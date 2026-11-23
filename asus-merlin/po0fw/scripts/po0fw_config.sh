#!/bin/sh
# po0fw：把路由器当前公网出口所在 /24 写入 po0 防火墙白名单的固定槽位。
# 调用方式：
#   po0fw_config.sh start|restart  软件中心 wan-start（/koolshare/init.d/S99po0fw.sh）：注册定时任务并立即更新
#   po0fw_config.sh stop|kill      软件中心停止插件：删除定时任务
#   po0fw_config.sh run <原因>      定时任务（原因 cron）和手动更新
#   po0fw_config.sh notify-test    发送一条测试通知
#   po0fw_config.sh <id> <1|2|3|4> 网页 /_api/：1 保存并应用，2 立即更新，3 清空日志，4 测试通知

source /koolshare/scripts/base.sh
# 逐个读取设置，不 eval 整个 dbus export，值里的特殊字符不会被 shell 执行
for k in enable token slot interval last notify bark_url tg_token tg_chat tg_api proxy \
    notify_fail fail_count fail_alerted; do
    eval "po0fw_$k=\$(dbus get po0fw_$k)"
done

API=https://124.221.69.228/api/firewall
SELF=/koolshare/scripts/po0fw_config.sh
LOG=/tmp/upload/po0fw_log.txt
STATUS=/tmp/upload/po0fw_status.txt
LOCK=/tmp/po0fw_run.lock
BACKOFF=/tmp/po0fw_backoff   # 429 后定时任务暂停到这个时间（epoch 秒）
PINNED=/tmp/po0fw_pinned     # 403 pinned 标记：只在进入这个状态时记一次日志
CURL_ERR=/tmp/po0fw_curl.err
NOTIFY_ERR=/tmp/po0fw_notify.err
BACKOFF_MIN=15
NOTIFY_MAX=3                 # 变化通知连续失败这么多轮后放弃这次通知
FAIL_MAX=3                   # 连续失败这么多轮时发一次失败通知
TITLE="🛡️ po0 防火墙加白"   # 通知标题
ICON=https://raw.githubusercontent.com/zhdsmy/po0fw/main/asus-merlin/po0fw/res/icon-po0fw.png  # Bark 图标（iOS 15+）

now() { TZ=UTC-8 date '+%Y-%m-%d %H:%M:%S'; }

# 写入日志和状态前去掉换行、给 token 打码（/tmp/upload 网页可读）
redact() { tr '\r\n' '  ' | sed 's/pgnfw_[A-Za-z0-9_-]*/pgnfw_***/g'; }
short() { printf '%s' "$1" | tr '\r\n' '  ' | cut -c1-120; }

# 日志只记录变化和失败；每次运行的结果写在状态文件里
log() {
    mkdir -p /tmp/upload
    msg=$(printf '%s' "$*" | redact)
    echo "[$(now)] $msg" >>"$LOG"
    logger -t po0fw "$msg"
    if [ "$(wc -l <"$LOG")" -gt 400 ]; then
        tail -n 300 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
    fi
}

status() {
    mkdir -p /tmp/upload
    printf '%s\n%s\n' "[$(now)] $(printf '%s' "$1" | redact)" "$(printf '%s' "$2" | cut -c1-500 | redact)" >"$STATUS"
}

# 状态文件第一行去掉时间戳，用在通知正文里
last_status() { sed -n 1p "$STATUS" 2>/dev/null | cut -c23-; }

interval() {
    case "$po0fw_interval" in
        1|2|5|10|15|30) echo "$po0fw_interval";;
        *) echo 5;;
    esac
}

cron_set() {
    cru d po0fw >/dev/null 2>&1
    [ "$po0fw_enable" = 1 ] && cru a po0fw "*/$(interval) * * * * $SELF run cron"
}

# 发送通知（Bark 或 Telegram，可走代理；加白请求本身不走代理）。参数：摘要、详情。
# Bark：摘要作副标题，详情作正文；Telegram：标题、摘要、详情各一行。
# 通知关闭时直接成功；失败时在 stdout 输出原因（不含 key 和 bot token）。
send() {
    n_head=$1 n_body=$2
    set -- -sS -m 10 -w '\n%{http_code}' -X POST
    [ -n "$po0fw_proxy" ] && set -- "$@" -x "$po0fw_proxy"
    case "$po0fw_notify" in
        bark)
            n_out=$(curl "$@" "${po0fw_bark_url%/}" --data-urlencode "title=$TITLE" \
                --data-urlencode "subtitle=$n_head" --data-urlencode "body=$n_body" \
                --data-urlencode "icon=$ICON" --data-urlencode "group=po0fw" 2>"$NOTIFY_ERR")
            ;;
        telegram)
            n_out=$(curl "$@" "${po0fw_tg_api:-https://api.telegram.org}/bot$po0fw_tg_token/sendMessage" \
                --data-urlencode "chat_id=$po0fw_tg_chat" --data-urlencode "text=$TITLE
$n_head
$n_body" 2>"$NOTIFY_ERR")
            ;;
        *) return 0;;
    esac
    n_code=$(printf '%s\n' "$n_out" | tail -n 1)
    [ "$n_code" = 200 ] && return 0
    if [ "$n_code" = 000 ]; then
        tail -n 1 "$NOTIFY_ERR"
    else
        # Telegram 的 description 不含 token，例如 "Bad Request: chat not found"
        echo "HTTP $n_code $(printf '%s' "$n_out" | sed -n 's/.*"description":"\([^"]*\)".*/\1/p' | head -n 1)"
    fi
    return 1
}

# 返回值：0 成功（含已在其他槽位、未变化），1 失败，2 不计入失败（跳过、429、变化通知待重试）
update() {
    reason=$1
    # 429 退避期间跳过定时任务；wan-start 和网页照常请求
    if [ "$reason" = cron ] && [ -f "$BACKOFF" ] && [ "$(date +%s)" -lt "$(cat "$BACKOFF")" ] 2>/dev/null; then
        return 2
    fi
    # 定时任务抢不到锁就跳过；wan-start 和网页等前一次运行结束
    exec 9>"$LOCK"
    if [ "$reason" = cron ]; then flock -n 9 || return 2; else flock 9; fi
    # 卸载期间排队的更新拿到锁时脚本已删除，不再请求、不写状态和 dbus
    [ -f "$SELF" ] || return 2

    case "$po0fw_token" in
        pgnfw_*) ;;
        *) status "❌ 未配置 token" ""; log "$reason: 未配置 token"; return 1;;
    esac
    case "$po0fw_token" in *[!A-Za-z0-9_-]*) status "❌ token 含非法字符" ""; return 1;; esac
    case "$po0fw_slot" in [0-9]) slot=$po0fw_slot;; *) slot=1;; esac

    # 网络错误和 5xx 重试；wan-start 时链路可能还没完全就绪
    for delay in 0 5 15; do
        sleep "$delay"
        out=$(curl -sS -m 10 -X POST -w '\n%{http_code}' "$API/$po0fw_token/add?slot=$slot" 2>"$CURL_ERR")
        code=$(printf '%s\n' "$out" | tail -n 1)
        body=$(printf '%s\n' "$out" | sed '$d' | tr -d '\\\r\n')
        case "$code" in 000|5??) continue;; esac
        break
    done

    case "$code" in
        200) ;;
        403)
            case "$body" in
                *"pinned to another slot"*)
                    rm -f "$BACKOFF"
                    [ -f "$PINNED" ] || { : >"$PINNED"; log "$reason: 出口网段已固定在其他槽位，槽位 $slot 未改动"; }
                    status "⚠️ 出口网段已固定在其他槽位，槽位 $slot 未改动" "常见原因：家里的其他设备（例如手机）把这个网段写进了自己的槽位"
                    return 0;;
            esac
            status "❌ HTTP 403" "$body"; log "$reason: HTTP 403 $(short "$body")"; return 1;;
        429)
            echo $(($(date +%s) + BACKOFF_MIN * 60)) >"$BACKOFF"
            status "⏸ HTTP 429 限频，定时任务暂停 $BACKOFF_MIN 分钟" "$body"
            log "$reason: HTTP 429，定时任务暂停 $BACKOFF_MIN 分钟"
            return 2;;
        000)
            err=$(tail -n 1 "$CURL_ERR" 2>/dev/null)
            status "❌ 无法连接 API" "$err"; log "$reason: 无法连接 API $(short "$err")"; return 1;;
        *) status "❌ HTTP $code" "$body"; log "$reason: HTTP $code $(short "$body")"; return 1;;
    esac
    rm -f "$BACKOFF" "$PINNED"

    if printf '%s' "$body" | grep -q '"enabled": *false'; then
        status "❌ 防火墙未启用" "$body"; log "$reason: 防火墙未启用"; return 1
    fi

    # 白名单条目：{"ip":"x.x.x.0/24","slot":1}
    list=$(printf '%s' "$body" | tr '{}' '\n\n' |
        sed -n 's/.*"ip": *"\([0-9.\/]*\)".*"slot": *\([0-9]*\).*/\1 #\2/p; s/.*"slot": *\([0-9]*\).*"ip": *"\([0-9.\/]*\)".*/\2 #\1/p')
    new=$(printf '%s\n' "$list" | sed -n "s/ #$slot\$//p" | head -n 1)
    # 统一成 x.x.x.0/24（条目可能是精确 IP，或主机位不为 0 的 /24）
    ip=${new%/24}
    case "$ip" in
        [0-9]*.[0-9]*.[0-9]*.[0-9]*) new=${ip%.*}.0/24;;
        *) status "❌ 响应里没有槽位 $slot" "$body"; log "$reason: 响应里没有槽位 $slot"; return 1;;
    esac
    limit=$(printf '%s' "$body" | sed -n 's/.*"limit": *\([0-9][0-9]*\).*/\1/p')
    summary="白名单 $(printf '%s\n' "$list" | grep -c .)${limit:+/$limit}：$(printf '%s\n' "$list" | tr '\n' ' ')"

    old=$po0fw_last
    if [ "$new" = "$old" ]; then
        status "✅ 槽位 $slot：$new（未变化）" "$summary"
        return 0
    fi
    # 首次记录不通知。通知失败时不更新记录，下一轮重试；连续失败 NOTIFY_MAX 轮后放弃这次通知
    if [ -n "$old" ] && ! err=$(send "🔄 出口网段已更新 · 📌 槽位 $slot" "🌐 $old → $new"); then
        fails=$((${po0fw_notify_fail:-0} + 1))
        if [ "$fails" -lt "$NOTIFY_MAX" ]; then
            dbus set po0fw_notify_fail="$fails"
            status "⚠️ 槽位 $slot 已更新为 $new，通知发送失败（第 $fails 次），下一轮重试" "$summary"
            log "$reason: 槽位 $slot $old -> $new，通知发送失败（第 $fails 次）$(short "$err")"
            return 2
        fi
        log "$reason: 通知连续 $fails 次发送失败，放弃这次通知 $(short "$err")"
    fi
    dbus remove po0fw_notify_fail
    dbus set po0fw_last="$new"
    log "$reason: 槽位 $slot ${old:-无} -> $new"
    status "✅ 槽位 $slot：${old:-无} → $new" "$summary"
}

# 连续失败 FAIL_MAX 轮时发一次失败通知；发出过失败通知的，成功后再发一次恢复通知
alert() {
    case "$1" in
        0)
            [ -n "$po0fw_fail_count" ] || return 0
            dbus remove po0fw_fail_count
            [ "$po0fw_fail_alerted" = 1 ] || return 0
            dbus remove po0fw_fail_alerted
            err=$(send "🎉 已恢复" "$(last_status)") || log "恢复通知发送失败 $(short "$err")"
            ;;
        1)
            n=$((${po0fw_fail_count:-0} + 1))
            dbus set po0fw_fail_count="$n"
            [ "$n" -ge "$FAIL_MAX" ] && [ "$po0fw_fail_alerted" != 1 ] || return 0
            # 通知关闭时不算发过失败通知，打开通知后下一轮失败照常通知
            case "$po0fw_notify" in bark|telegram) ;; *) return 0;; esac
            if err=$(send "🚨 连续 $n 次加白失败" "$(last_status)"); then
                dbus set po0fw_fail_alerted=1
            elif [ "$n" = "$FAIL_MAX" ]; then
                log "失败通知发送失败，之后每轮重试 $(short "$err")"
            fi
            ;;
    esac
}

case "$1" in
    start|restart)
        cron_set
        [ "$po0fw_enable" = 1 ] && "$SELF" run wan-start >/dev/null 2>&1 &
        ;;
    stop|kill)
        cru d po0fw >/dev/null 2>&1
        ;;
    run)
        update "${2:-manual}"
        rc=$?
        alert "$rc"
        exit "$rc"
        ;;
    notify-test)
        case "$po0fw_notify" in
            bark|telegram)
                # 还没运行过时没有状态，正文不能为空
                st=$(last_status)
                if err=$(send "🔔 测试通知" "${st:-还没有运行记录}"); then log "测试通知已发送（$po0fw_notify）"
                else log "测试通知发送失败（$po0fw_notify）$(short "$err")"; fi;;
            *) log "测试通知：没有选择通知渠道";;
        esac
        ;;
    *)
        # 更新可能因重试耗时近一分钟，放到后台，网页轮询状态和日志
        case "$2" in
            1) cron_set
               if [ "$po0fw_enable" = 1 ]; then "$SELF" run web >/dev/null 2>&1 &
               else status "⏸ 已停用" ""; fi;;
            2) "$SELF" run web >/dev/null 2>&1 &;;
            3) mkdir -p /tmp/upload; : >"$LOG";;
            4) "$SELF" notify-test >/dev/null 2>&1 &;;
            *) exit 1;;
        esac
        http_response "$1"
        ;;
esac
