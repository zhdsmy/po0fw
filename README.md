# po0fw

给需要把固定出口网段加入 po0 防火墙白名单的用户使用，支持 iOS、macOS 上的 Surge 和 ASUSWRT-Merlin 路由器插件。白名单按槽位计，每个槽位放一个 /24，默认 5 个槽位，可以付费增加。每台设备固定一个槽位，换 IP 时只替换自己的槽位，不会被先进先出淘汰。

## 方案

每个方案放在一个顶层目录里，各自有 README、测试和发布方式。

| 目录 | 方案 | 适用 | 快速开始 |
|---|---|---|---|
| [`surge/`](surge/) | Surge 模块 | iOS、macOS 上的 Surge | [安装](surge/README.md#安装) |
| [`asus-merlin/`](asus-merlin/) | 软件中心插件（KoolShare / KoolCenter，ASUSWRT-Merlin） | 华硕路由器，目前只测过 hnd 平台 | [安装与升级](asus-merlin/README.md#安装与升级) |

以后加新方案时，新建一个顶层目录，并在上表加一行。需要打包的方案，发布 tag 用 `<目录>/v<版本>`，见 `.github/workflows/release.yml`。

## 槽位规划示例

| 槽位 | 用途 | 维护方 |
|---|---|---|
| 0 | 手机（蜂窝或外部 Wi-Fi） | 手机上的 Surge 模块，`tokens=pgnfw_xxx@0`，`skip_ssid=<家里的 Wi-Fi>` |
| 1 | 家宽 | 路由器插件（槽位 1）；家里常驻的 Surge 设备可以用 `@1` 作备份 |
| 其余 | 其他固定出口 | 按需分配 |

手机连家里 Wi-Fi 时用 `skip_ssid` 跳过请求，避免把家宽网段钉进手机的槽位。同一网段已在别的槽位时服务端返回 `403 IP is already pinned to another slot.`，两个方案都按成功处理。

## API

`POST https://124.221.69.228/api/firewall/<token>/add[?slot=N]`，把请求源 IP 所在的 /24 写入白名单。带 `slot` 时写入槽位 N。

| 响应 | 含义 |
|---|---|
| `200 {enabled, limit, currentIp, whitelist:[{ip:"x.x.x.0/24", slot}]}` | 成功，重复请求幂等。JSON 里 `/` 转义成 `\/` |
| `403 {"message":"IP is already pinned to another slot."}` | 本机网段已在另一个槽位，等于已加白 |
| `400 {"message":"serviceId is required"}` | token 无效 |
| `429 {"message":"Too many firewall update attempts. Please try again later."}` | 限频，阈值未知。同一个 token 的所有设备共用 |

API 没有删除接口。token 在 URL 路径里，所以会出现在请求日志中，例如 Surge 的最近请求列表。截图和抓包时注意。

## 致谢与许可

- Surge 模块参考了 [reallinzc/po0fw](https://github.com/reallinzc/po0fw) 的做法，代码重新编写。
- 路由器插件的网页沿用软件中心插件页的通用结构，包括页头、表单和 `/_api/` 提交方式。

本仓库以 [MIT](LICENSE) 许可发布。
