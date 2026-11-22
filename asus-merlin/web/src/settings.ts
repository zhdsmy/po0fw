export const defaults = {
  po0fw_enable: "0", po0fw_token: "", po0fw_slot: "1", po0fw_interval: "5",
  po0fw_notify: "off", po0fw_bark_url: "", po0fw_tg_token: "", po0fw_tg_chat: "",
  po0fw_tg_api: "", po0fw_proxy: "", po0fw_version: "",
};
export type Settings = typeof defaults;
export type Action = 1 | 2 | 3 | 4;

export function fieldsFor(action: Action, s: Settings): Record<string, string> {
  if (action === 2 || action === 3) return {};
  const token = s.po0fw_token.trim();
  if (action === 1 && (s.po0fw_enable === "1" || token) && !/^pgnfw_[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("请填写 pgnfw_ 开头的 API token（不要带 @槽位）。");
  }
  const notify = {
    po0fw_notify: s.po0fw_notify,
    po0fw_bark_url: s.po0fw_bark_url.trim(),
    po0fw_tg_token: s.po0fw_tg_token.trim(),
    po0fw_tg_chat: s.po0fw_tg_chat.trim(),
    po0fw_tg_api: s.po0fw_tg_api.trim().replace(/\/+$/, ""),
    po0fw_proxy: s.po0fw_proxy.trim(),
  };
  if (notify.po0fw_notify === "bark" && !/^https?:\/\/\S+\/[^\/\s]+\/?$/.test(notify.po0fw_bark_url)) {
    throw new Error("Bark 地址格式：https://api.day.app/你的key");
  }
  if (notify.po0fw_notify === "telegram") {
    if (!/^\d+:[A-Za-z0-9_-]+$/.test(notify.po0fw_tg_token)) {
      throw new Error("Telegram Bot Token 格式：123456789:ABC...");
    }
    if (!/^(-?\d+|@[A-Za-z0-9_]+)$/.test(notify.po0fw_tg_chat)) {
      throw new Error("Telegram Chat ID 是数字（群组以 - 开头），或 @频道名");
    }
    if (notify.po0fw_tg_api && !/^https?:\/\/\S+$/.test(notify.po0fw_tg_api)) {
      throw new Error("Telegram API 地址以 http:// 或 https:// 开头，留空用官方地址");
    }
  }
  if (notify.po0fw_proxy && !/^(https?|socks4a?|socks5h?):\/\/\S+$/.test(notify.po0fw_proxy)) {
    throw new Error("代理格式：http://host:port 或 socks5h://host:port，留空直连");
  }
  if (action === 4) {
    if (notify.po0fw_notify === "off") throw new Error("先选择通知渠道。");
    return notify;
  }
  return { ...notify, po0fw_enable: s.po0fw_enable, po0fw_token: token,
    po0fw_slot: s.po0fw_slot, po0fw_interval: s.po0fw_interval };
}
