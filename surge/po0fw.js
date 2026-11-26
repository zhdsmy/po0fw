/*
 * po0 防火墙加白（Surge 专用）
 * 参考 reallinzc/po0fw@7b99973 的做法重新编写，只保留 Surge 用到的部分。
 *
 * API：POST https://124.221.69.228/api/firewall/<token>/add[?slot=N]
 *   把请求源 IP 所在 /24 加入白名单，回显 {enabled, whitelist:[{ip,slot}], limit, currentIp}。
 *   - 重复请求幂等，不占新槽位。
 *   - 带 slot：本机网段顶替该槽位原有网段，永不被 FIFO 淘汰。
 *   - 403 {"code":403,"message":"IP is already pinned to another slot."}：
 *     本机网段已钉在另一个槽位，说明已经加白，按成功处理（响应不含 currentIp）。
 *   - 无效 token：400 {"code":400,"message":"serviceId is required"}。
 *
 * 参数：tokens=pgnfw_xxx[@槽位][,pgnfw_yyy[@槽位]]&skip_ssid=Wi-Fi名[,Wi-Fi名]
 *       &ssid_slot=Wi-Fi名@槽位[,Wi-Fi名@槽位]&notify_update=0|1
 *   skip_ssid：连着这些 Wi-Fi 时不请求（家宽由路由器维护时，避免手机把家宽网段钉进自己的槽位）。
 *   ssid_slot：连着这些 Wi-Fi 时，所有 token 改写对应槽位，代替 token 的 @槽位；skip_ssid 优先。
 *   notify_update：填 1 时，打开后第一次加白成功推送当前网段，之后网段变化推送「旧 → 新」。
 */

var API = "https://124.221.69.228/api/firewall/";
var RETRY_DELAYS = [3, 8]; // 秒。网络错误和 HTTP 5xx 重试，network-changed 触发时网络可能还没就绪
var STATE_KEY = "po0fw_state";
var SIG_KEY = "po0fw_tokens"; // po0fw_state 对应的 token 配置摘要
var LAST_KEY = "po0fw_last"; // notify_update 打开时，上次推送过的出口 /24
var NAME = "🛡️ po0 防火墙加白"; // 推送标题

function parseArgs(arg) {
  var out = {};
  String(arg || "")
    .split("&")
    .forEach(function (kv) {
      var i = kv.indexOf("=");
      if (i < 0) return;
      var v = kv.slice(i + 1);
      try {
        v = decodeURIComponent(v);
      } catch (e) {}
      out[kv.slice(0, i).trim()] = v;
    });
  return out;
}

// 格式不对的 token 保留为一条失败项，不静默丢弃
function parseTokens(s) {
  return String(s || "")
    .split(/[,|;\s]+/)
    .filter(Boolean)
    .map(function (t) {
      var m = t.match(/^(pgnfw_[A-Za-z0-9_-]+)(?:@(\d+))?$/);
      return m ? { token: m[1], slot: m[2] === undefined ? null : Number(m[2]) } : { bad: true, slot: null };
    });
}

// Wi-Fi名@槽位，按最后一个 @ 拆分（Wi-Fi 名里可以有 @）；格式不对的条目放进 bad
function parseSsidSlots(s) {
  var map = Object.create(null);
  var bad = [];
  String(s || "")
    .split(",")
    .forEach(function (e) {
      e = e.trim();
      if (!e) return;
      var m = e.match(/^(.*\S)\s*@(\d+)$/);
      if (m) map[m[1]] = Number(m[2]);
      else bad.push(e);
    });
  return { map: map, bad: bad };
}

// token 配置的摘要，不存 token 原文。换 token、增删或调整顺序后摘要改变
function sign(items) {
  var s = items
    .map(function (it) {
      return it.bad ? "!" : it.token + "@" + it.slot;
    })
    .join(",");
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// 上次的 state。token 配置变了就当没有记录；旧版本没存摘要，按配置未变处理
function readState() {
  var sig = $persistentStore.read(SIG_KEY);
  return sig && sig !== SIG ? null : $persistentStore.read(STATE_KEY);
}

function redact(s) {
  return String(s).replace(/pgnfw_[A-Za-z0-9_-]*/g, "pgnfw_***");
}

// 白名单条目和出口是否同一 /24：两边都是精确 IP 时要求相同，有一边是 /24 时比较前三段
var IPV4 = /^(\d+\.\d+\.\d+)\.\d+(\/24)?$/;
function sameC24(a, b) {
  if (!a || !b) return false;
  var x = IPV4.exec(String(a));
  var y = IPV4.exec(String(b));
  if (!x || !y) return String(a) === String(b);
  if (!x[2] && !y[2]) return x[0] === y[0];
  return x[1] === y[1];
}

function c24(ip) {
  var m = IPV4.exec(String(ip || ""));
  return m ? m[1] + ".0/24" : "";
}

function post(url) {
  return new Promise(function (resolve) {
    // policy 强制直连：全局代理模式下也让 API 看到本机真实出口
    $httpClient.post({ url: url, policy: "DIRECT", timeout: 10, body: "" }, function (err, resp, body) {
      resolve({ err: err, status: resp && resp.status, body: body });
    });
  });
}

function sleep(sec) {
  return new Promise(function (resolve) {
    setTimeout(resolve, sec * 1000);
  });
}

function parseJson(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// transient：网络错误、5xx（重试用尽）和 429，面板显示失败，但不改通知状态
function addOnce(item) {
  var url = API + encodeURIComponent(item.token) + "/add" + (item.slot === null ? "" : "?slot=" + item.slot);
  return post(url).then(function (r) {
    if (r.err) return { retry: true, transient: true, error: "网络错误：" + r.err };
    var data = parseJson(r.body) || {};
    if (r.status === 403 && /pinned to another slot/i.test(data.message || "")) {
      return { ok: true, conflict: true };
    }
    if (r.status === 429) return { transient: true, error: "HTTP 429 请求过于频繁" };
    if (r.status >= 500) return { retry: true, transient: true, error: "HTTP " + r.status };
    if (r.status !== 200) {
      return { error: "HTTP " + r.status + " " + (data.message || String(r.body).slice(0, 60)) };
    }
    if (data.enabled === false) return { error: "防火墙未启用" };
    if (!Array.isArray(data.whitelist)) return { error: "响应缺少 whitelist：" + String(r.body).slice(0, 60) };
    var list = data.whitelist.map(function (e) {
      return e && typeof e === "object" ? e : { ip: e, slot: null };
    });
    var ok = list.some(function (e) {
      return sameC24(e.ip, data.currentIp);
    });
    return {
      ok: ok,
      error: ok ? null : "加白未生效",
      currentIp: data.currentIp,
      whitelist: list,
      limit: data.limit,
    };
  });
}

function add(item, attempt) {
  attempt = attempt || 0;
  return addOnce(item).then(function (res) {
    if (!res.retry || attempt >= RETRY_DELAYS.length) return res;
    return sleep(RETRY_DELAYS[attempt]).then(function () {
      return add(item, attempt + 1);
    });
  });
}

// 每个 token 一段，不显示 token 本身
function describe(item, res, i) {
  var head = "#" + (i + 1) + (item.slot === null ? "" : " 📌" + item.slot) + " ";
  if (!res.ok) return head + "❌ " + redact(res.error);
  if (res.conflict) return head + "✅ 本机网段已在其他槽位";
  var lines = res.whitelist.map(function (e) {
    return (
      "    " +
      e.ip +
      (e.slot === null || e.slot === undefined ? "" : " 📌" + e.slot) +
      (sameC24(e.ip, res.currentIp) ? " ←" : "")
    );
  });
  return head + "✅ " + res.whitelist.length + "/" + res.limit + "\n" + lines.join("\n");
}

// 推送正文里每个 token 一行；只有一个 token 时不写序号
function brief(item, res, i, multi) {
  var head = (multi ? "#" + (i + 1) + " " : "") + (item.slot === null ? "" : "📌" + item.slot + " ");
  if (!res.ok) return head + "❌ " + redact(res.error);
  return head + (res.conflict ? "✅ 本机网段已在其他槽位" : "✅ 已加白");
}

function isBad(state) {
  return state === "no-token" || /(^|,)fail(,|$)/.test(state || "");
}

// state：每个 token 一项 ok/fail（暂时性错误沿用上次的值，没有上次记 ?），或 no-token。
// 只在 state 变化时通知：变成有失败时通知失败；从失败恢复到全部 ok 时通知「已恢复」。
// 首次成功、错误措辞变化都不通知；出口网段由 noteExit 按 notify_update 处理。
// bad / good：推送的 [副标题, 正文]，分别用于失败和恢复。
function finish(allOk, state, title, content, bad, good) {
  var prev = readState();
  if (state !== prev) {
    $persistentStore.write(state, STATE_KEY);
    if (isBad(state)) $notification.post(NAME, bad[0], bad[1]);
    else if (isBad(prev) && state.indexOf("?") < 0) $notification.post(NAME, good[0], good[1]);
  }
  if ($persistentStore.read(SIG_KEY) !== SIG) $persistentStore.write(SIG, SIG_KEY);
  $done({
    title: title,
    content: content,
    icon: allOk ? "checkmark.shield" : "exclamationmark.shield",
    "icon-color": allOk ? "#34C759" : "#FF3B30",
  });
}

// notify_update 打开时：第一次加白成功推送当前网段，之后网段变化推送「旧 → 新」。
// 关闭时清掉记录，下次打开重新从第一次算。
function noteExit(net, slots) {
  var last = $persistentStore.read(LAST_KEY);
  if (!notifyUpdate) {
    if (last) $persistentStore.write("", LAST_KEY);
    return;
  }
  if (!net || net === last) return;
  $persistentStore.write(net, LAST_KEY);
  var where = slots.length ? " · 📌 槽位 " + slots.join(",") : "";
  if (last) $notification.post(NAME, "🔄 出口网段已更新" + where, "🌐 " + last + " → " + net);
  else $notification.post(NAME, "✅ 已加白" + where, "🌐 出口网段 " + net);
}

function run(items) {
  var prev = readState();
  var prevParts = prev && prev !== "no-token" ? prev.split(",") : [];
  return Promise.all(
    items.map(function (item) {
      return item.bad ? { error: "token 格式错误：只能含字母、数字、_ 和 -，槽位写成 @数字" } : add(item);
    })
  ).then(function (results) {
    var okCount = 0;
    var exitIp = "";
    var okNet = ""; // 只取加白成功的结果，未生效时不算变化
    var slots = [];
    var parts = [];
    var lines = [];
    var notes = [];
    var multi = items.length > 1;
    results.forEach(function (r, i) {
      if (r.ok) okCount++;
      if (r.currentIp) exitIp = r.currentIp;
      if (r.ok && r.currentIp) {
        okNet = c24(r.currentIp);
        if (items[i].slot !== null) slots.push(items[i].slot);
      }
      parts.push(r.ok ? "ok" : r.transient ? prevParts[i] || "?" : "fail");
      lines.push(describe(items[i], r, i));
      notes.push(brief(items[i], r, i, multi));
    });
    noteExit(okNet, slots);
    var n = results.length;
    var title = "po0 加白 " + okCount + "/" + n + (exitIp ? " · 出口 " + exitIp : "");
    var body = notes.join("\n") + (exitIp ? "\n🌐 出口 " + exitIp : "");
    var failTitle = multi ? "🚨 " + (n - okCount) + "/" + n + " 个 token 加白失败" : "🚨 加白失败";
    finish(okCount === n, parts.join(","), title, lines.join("\n"), [failTitle, body], ["🎉 已恢复", body]);
  });
}

var args = parseArgs(typeof $argument === "string" ? $argument : "");
var items = parseTokens(args.tokens);
var SIG = sign(items);
var skip = String(args.skip_ssid || "")
  .split(",")
  .map(function (s) {
    return s.trim();
  })
  .filter(Boolean);
var notifyUpdate = /^(1|true|on|yes)$/i.test(String(args.notify_update || "").trim());
var ssid = typeof $network === "object" && $network && $network.wifi ? $network.wifi.ssid : null;
var ssidSlots = parseSsidSlots(args.ssid_slot);
var ssidSlot = ssid && ssidSlots.map[ssid] !== undefined ? ssidSlots.map[ssid] : null;

if (ssid && skip.indexOf(ssid) >= 0) {
  // 不请求，也不改通知状态
  $done({
    title: "po0 加白 已跳过",
    content: "当前 Wi-Fi 在 skip_ssid 里，家宽槽位由路由器维护",
    icon: "house",
    "icon-color": "#8E8E93",
  });
} else if (items.length === 0) {
  var hint = "在模块参数 tokens 里填入 pgnfw_ token";
  finish(false, "no-token", "po0 加白：未配置 token", hint, ["⚠️ 未配置 token", hint]);
} else if (ssidSlots.bad.length) {
  var msg = "ssid_slot 格式错误：" + ssidSlots.bad.join("，") + "。应写成 Wi-Fi名@槽位";
  finish(false, "fail", "po0 加白：参数错误", msg, ["⚠️ 参数错误", msg]);
} else {
  // 槽位只在本次请求里替换；SIG 仍按 token 原配置算，切换网络不会重置通知状态
  if (ssidSlot !== null) {
    items = items.map(function (it) {
      return it.bad ? it : { token: it.token, slot: ssidSlot };
    });
  }
  run(items).catch(function (e) {
    var msg = redact((e && e.message) || e);
    finish(false, "fail", "po0 加白：脚本出错", msg, ["💥 脚本出错", msg]);
  });
}
