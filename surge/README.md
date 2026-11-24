# Surge 方案

适用于 iOS 和 macOS 的 Surge 模块，用于把本机直连出口所在的 /24 加入白名单。本模块参考 [reallinzc/po0fw@7b99973](https://github.com/reallinzc/po0fw/tree/7b99973) 的做法重新编写，仅保留 Surge 所需部分。

## 安装

[![一键安装到 Surge](../docs/surge/badge.svg)](https://zhdsmy.github.io/po0fw/surge/)

1. 在装有 Surge 的 iPhone、iPad 或 Mac 上点击上方按钮，页面会打开 Surge 并安装模块。Mac 需要 Surge 6.7.0 及以上。也可以在 Surge 中从 URL 安装模块，填入 `https://raw.githubusercontent.com/zhdsmy/po0fw/main/surge/po0fw.sgmodule`。
2. 启用「po0 防火墙加白」模块，并按下表填写参数。参数保存在本机的模块实例中，模块更新后保留。
3. 若之前用过上游模块或本仓库旧版的本地模块（`script-path=po0fw.js`），请先停用并删除，以免请求量翻倍。在 macOS 上可运行 `surge-cli script list | grep -i po0`，确认只保留了 `po0fw-cron`、`po0fw-event`、`po0fw-panel`。

模块和脚本都从本仓库 `main` 分支的 raw 地址加载，安装和更新时需要能访问 `raw.githubusercontent.com`。Surge 默认每天检查一次脚本更新。

## 参数

| 参数 | 说明 | 示例 |
|---|---|---|
| `tokens` | `pgnfw_` 开头的 token，多个用英文逗号分隔；后缀 `@槽位` 用于固定槽位 | 手机 `pgnfw_xxx@0`，家里设备 `pgnfw_xxx@1` |
| `skip_ssid` | 连接这些 Wi-Fi 时跳过请求，多个用英文逗号分隔；名称不能含 `&` 和 `,` | 手机填家里的 Wi-Fi 名；常驻家里的设备留空 |
| `cron` | 定时检查的 cron 表达式，默认 `*/10 * * * *` | 作为备份的设备可用 `7,37 * * * *` |
| `notify_update` | 填 `1` 时推送加白结果（含首次成功及后续网段变化），默认 `0` | 想了解加白情况时开启；手机使用蜂窝网络时网段变化频繁，推送会较多 |

同一 token 下的所有设备共用限频额度。若家宽已由路由器维护，家里的备份设备应降低 `cron` 频率，并与路由器的整 5 分钟错开。

## 通知

每个 token 单独记录 ok 或 fail 状态，仅在状态变化时通知。更换、增删 token 或调整顺序后会重新记录，不沿用旧状态。

- 有 token 转为失败时通知一次，错误信息变化不再重复通知。
- 从失败恢复为全部成功时，通知「已恢复」。
- 网络错误、5xx（重试用尽后）和 429 属于暂时性错误；面板会显示红色，但不改变通知状态，也不发通知。
- 加白成功默认不通知。设为 `notify_update=1` 时，开启后首次成功会推送当前网段，之后网段变化时推送「旧 → 新」（403 pinned 和加白未生效不算作成功，不触发这类推送）。关闭后会清空记录，再次开启时重新从首次成功算起。

推送标题统一为「🛡️ po0 防火墙加白」。以下以槽位 0 为例：

| 情况 | 副标题 | 正文 |
|---|---|---|
| 转为失败 | 🚨 加白失败；多个 token 时为「🚨 1/2 个 token 加白失败」 | 每个 token 一行，例如 `📌0 ❌ HTTP 400 …`，末行 `🌐 出口 …` |
| 从失败恢复 | 🎉 已恢复 | `📌0 ✅ 已加白`，末行 `🌐 出口 …` |
| `notify_update=1`，首次成功 | ✅ 已加白 · 📌 槽位 0 | `🌐 出口网段 203.0.113.0/24` |
| `notify_update=1`，网段变化 | 🔄 出口网段已更新 · 📌 槽位 0 | `🌐 203.0.113.0/24 → 192.0.2.0/24` |
| 未配置 token / 脚本出错 | ⚠️ 未配置 token / 💥 脚本出错 | 提示或错误信息 |

## 面板与运行行为

- 切换网络（`network-changed`）时立即执行，同时按 `cron` 参数定时检查；在面板中可手动刷新。
- 本机脚本发出的请求带 `policy: "DIRECT"`，即使本机切到全局代理模式，也不会把代理出口写入槽位。其他设备经这台 Surge 网关出网时，依赖模块中的 `[Rule]` 使 API 直连；网关切到全局代理模式时该规则不生效。
- 403 pinned 按成功处理。
- 遇到网络错误或 HTTP 5xx 时，分别在 3s 和 8s 后各重试一次；429 不重试。
- 连接 `skip_ssid` 中列出的 Wi-Fi 时跳过请求，面板显示「已跳过」。
- 格式错误的 token 会显示为失败项，不会被静默忽略；错误文本中的 token 会替换为 `pgnfw_***`。

手机配置 `skip_ssid` 是为了避免家宽换 IP 时的竞态：若手机在家先于路由器发起请求，新的家宽网段会被写入手机槽位；随后路由器请求收到 403，家宽槽位仍保留旧网段。等手机出门后，手机槽位切为蜂窝网段，家里就会断连，直到路由器下一次运行完成。

若 Surge 没有定位权限，手机无法读取 Wi-Fi 名称，也就不会跳过请求。在家时如果面板未显示「已跳过」，请检查定位权限。

## 开发

修改脚本后运行 `node --test surge/test.mjs`。推送到 `main` 后，设备在下次检查脚本更新时获取新版本；在 macOS 上可运行 `surge-cli external-resource update all` 立即更新。

一键安装按钮链接到 GitHub Pages 上的中转页 `docs/surge/index.html`，它再跳转到 `surge:///install-module?url=<模块地址>`。GitHub 会过滤 README 中的 `surge://` 链接，所以不能直接链接。
