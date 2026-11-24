# po0fw

把固定出口网段加入 po0 防火墙白名单，提供 iOS、macOS 上的 Surge 模块和 ASUSWRT-Merlin 路由器插件。白名单按槽位分配，每个槽位保存一个 /24，默认 5 个槽位，可付费增加。每台设备固定一个槽位，换 IP 时只替换自己的槽位，不会被先进先出淘汰。

## 方案

每个方案对应一个顶层目录，各自维护 README、测试和发布方式。

| 目录 | 方案 | 适用环境 | 快速开始 |
|---|---|---|---|
| [`surge/`](surge/) | Surge 模块 | iOS、macOS 上的 Surge | [一键安装](https://zhdsmy.github.io/po0fw/surge/) · [安装说明](surge/README.md#安装) |
| [`asus-merlin/`](asus-merlin/) | 软件中心插件（KoolShare / KoolCenter，ASUSWRT-Merlin） | 华硕路由器，目前仅测试过 hnd 平台 | [安装与升级](asus-merlin/README.md#安装与升级) |

新增方案时，新建顶层目录并在上表补充一行。需要打包的方案，发布 tag 格式为 `<目录>/v<版本>`，见 `.github/workflows/release.yml`。

## 槽位规划示例

| 槽位 | 用途 | 维护方 |
|---|---|---|
| 0 | 手机（蜂窝或外部 Wi-Fi） | 手机上的 Surge 模块，`tokens=pgnfw_xxx@0`，`skip_ssid=<家里的 Wi-Fi>` |
| 1 | 家宽 | 路由器插件（槽位 1）；家里常驻的 Surge 设备可用 `@1` 作备份 |
| 其余 | 其他固定出口 | 按需分配 |

手机连接家里 Wi-Fi 时，用 `skip_ssid` 跳过请求，避免把家宽网段写入手机槽位。同一网段已在其他槽位时，服务端会返回 `403 IP is already pinned to another slot.`，两个方案都按成功处理。

## API

`POST https://124.221.69.228/api/firewall/<token>/add[?slot=N]` 用于把请求源 IP 所在的 /24 写入白名单；传入 `slot` 时写入槽位 N。

| 响应 | 含义 |
|---|---|
| `200 {enabled, limit, currentIp, whitelist:[{ip:"x.x.x.0/24", slot}]}` | 成功，重复请求幂等；JSON 中 `/` 会转义为 `\/` |
| `403 {"message":"IP is already pinned to another slot."}` | 本机网段已在其他槽位，等同于已加白 |
| `400 {"message":"serviceId is required"}` | token 无效 |
| `429 {"message":"Too many firewall update attempts. Please try again later."}` | 触发限频，阈值未知；同一 token 下的所有设备共用额度 |

API 不提供删除接口。token 位于 URL 路径中，会出现在请求日志里（例如 Surge 的最近请求列表），截图和抓包时注意避免泄露。

## 致谢与许可

- Surge 模块参考 [reallinzc/po0fw](https://github.com/reallinzc/po0fw) 的做法重新编写。
- 路由器插件网页沿用软件中心插件页的通用结构，包括 ASUS 页面外框和 `/_api/` 提交方式。

本仓库以 [MIT](LICENSE) 许可发布。
