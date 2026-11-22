# ASUS Merlin 方案（KoolShare / KoolCenter 软件中心插件）

`po0fw/` 是软件中心插件，在路由器上维护家宽槽位（默认槽位 1）。拨号拿到的可能是运营商内网地址（CGNAT），公网 IP 也可能在不重拨的情况下变化，所以设置了两个触发点：

- 拨号成功：软件中心在 wan-start 时调用 `/koolshare/init.d/S99po0fw.sh start`。它会注册定时任务，并立即更新一次。
- 定时：`cru` 任务 `po0fw`，间隔在网页里设置，默认 5 分钟。

设置都存在 dbus 的 `po0fw_*` 键里，在「软件中心 → po0 防火墙加白」页面里修改。状态和日志分别在 `/tmp/upload/po0fw_status.txt` 和 `/tmp/upload/po0fw_log.txt`，日志只记录变化和失败。

## 请求和错误处理

| 情况 | 处理 |
|---|---|
| 网络错误、HTTP 5xx | 间隔 5s、15s 再试两次，一次运行最长约 50 秒 |
| `403 pinned to another slot` | 家宽网段已在别的槽位（常见原因：手机在家时写进了自己的槽位），本槽位不改；状态显示 ⚠️，进入这个状态时记一次日志 |
| `429` 限频 | 定时任务暂停 15 分钟；wan-start 和网页「立即更新」不受影响 |
| 200 但 `enabled:false` | 按失败处理 |

定时任务在前一次运行没结束时跳过；wan-start 和网页触发的更新会等前一次结束。错误响应体写进日志和状态前会去掉换行、截断，并把 token 打码成 `pgnfw_***`。

## 通知

通知渠道可选 Bark 或 Telegram：

| 渠道 | 设置 |
|---|---|
| Bark | Bark 地址，形如 `https://api.day.app/<key>`，自建服务器同样填完整地址 |
| Telegram | Bot Token、Chat ID；API 地址留空用 `https://api.telegram.org`，也可以填自建中转 |

「通知代理」只用于发通知，支持 `http://`、`https://`、`socks4(a)://`、`socks5(h)://`。加白请求始终直连，否则写进白名单的会是代理出口。路由器连不上 Telegram 官方地址时，填代理或 API 中转。

发送时机：

- 槽位网段变化时。首次记录不通知。发送失败时先不更新记录，下一轮重试；连续失败 3 轮后放弃这次通知，照常更新记录。
- 连续失败 3 轮时通知一次；发出过失败通知的，恢复后再通知一次。429 和定时任务跳过不算失败。
- 网页「测试通知」会先保存通知设置，再发一条测试消息，结果写在日志里。

通知标题是「🛡️ po0 防火墙加白」（Telegram 写在正文第一行）。正文第一行是摘要，第二行是详情：

| 情况 | 摘要 | 详情 |
|---|---|---|
| 槽位网段变化 | 🔄 出口网段已更新 · 📌 槽位 1 | `🌐 旧网段 → 新网段` |
| 连续失败 3 轮 | 🚨 连续 3 次加白失败 | 当前状态，例如 `❌ HTTP 400` |
| 失败后恢复 | 🎉 已恢复 | 当前状态，例如 `✅ 槽位 1：…` |
| 测试通知 | 🔔 测试通知 | 当前状态 |

Bark key 和 Telegram Bot Token 以明文存在路由器的 dbus 里（API token 也是），能登录路由器后台的人都能看到。

从 1.0.x 升级：1.0.x 的「Bark 通知」开关依赖外部中转服务，1.1.0 起去掉了。升级后通知渠道默认是「关闭」，需要重新选择并填写。

## 测试、构建与发布

```sh
asus-merlin/test.sh    # 在 busybox 1.25 容器里用 mock 跑 po0fw_config.sh 的回归用例（需要 docker）
asus-merlin/build.sh   # 生成 dist/po0fw-<版本>.tar.gz
```

在软件中心选「离线安装」，上传 `po0fw-<版本>.tar.gz`。覆盖安装会保留现有设置。

发布新版本：先改 `po0fw/version`，提交到 `main` 后推送 tag `asus-merlin/v<版本>`（如 `asus-merlin/v1.1.0`）。GitHub Actions 会检查 tag 在 `main` 上、和版本号一致，然后构建安装包并上传到 Release。

已在 RT-AX86U（KoolCenter，hnd 平台）上验证。`.valid` 目前只写了 `hnd`；其他平台没有测试过。
