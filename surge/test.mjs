// node --test test.mjs —— 用 mock 的 Surge 全局对象跑 po0fw.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const SRC = readFileSync(new URL("./po0fw.js", import.meta.url), "utf8");

// responses: 依次返回的 {err}、{throw} 或 {status, body}
function run({ argument, responses = [], store = {}, network }) {
  return new Promise((resolve) => {
    const calls = [];
    const notes = [];
    const delays = [];
    const ctx = {
      $argument: argument,
      $httpClient: {
        post(opts, cb) {
          calls.push(opts);
          const r = responses.shift() || { err: "no more responses" };
          if (r.throw) throw new Error(r.throw);
          setImmediate(() => cb(r.err || null, r.err ? undefined : { status: r.status }, JSON.stringify(r.body)));
        },
      },
      $persistentStore: { read: (k) => store[k] ?? null, write: (v, k) => (store[k] = v) },
      $notification: { post: (...a) => notes.push(a) },
      setTimeout: (fn, ms) => {
        delays.push(ms);
        setImmediate(fn); // 跳过重试等待，只记录间隔
      },
      $done: (out) => resolve({ out, calls, notes, store, delays }),
    };
    if (network) ctx.$network = network;
    vm.runInNewContext(SRC, ctx);
  });
}

const OK = {
  status: 200,
  body: {
    enabled: true,
    limit: 5,
    currentIp: "203.0.113.0/24",
    whitelist: [
      { ip: "192.0.2.0/24", slot: 0 },
      { ip: "203.0.113.0/24", slot: 1 },
    ],
  },
};
const PINNED = { status: 403, body: { code: 403, message: "IP is already pinned to another slot." } };
const BAD = { status: 400, body: { code: 400, message: "serviceId is required" } };
const NAME = "🛡️ po0 防火墙加白";
const RED = "exclamationmark.shield";
const GREEN = "checkmark.shield";

function okWith(body) {
  return { status: 200, body: { ...OK.body, ...body } };
}

test("200：加白成功，带槽位参数并强制直连", async () => {
  const r = await run({ argument: "tokens=pgnfw_abc@1", responses: [OK] });
  assert.equal(r.calls[0].url, "https://124.221.69.228/api/firewall/pgnfw_abc/add?slot=1");
  assert.equal(r.calls[0].policy, "DIRECT");
  assert.equal(r.out.title, "po0 加白 1/1 · 出口 203.0.113.0/24");
  assert.match(r.out.content, /203\.0\.113\.0\/24 📌1 ←/);
  assert.equal(r.notes.length, 0); // 首次成功不通知
});

test("403 pinned：已在其他槽位，按成功处理", async () => {
  const r = await run({ argument: "tokens=pgnfw_abc@0", responses: [PINNED] });
  assert.equal(r.out.icon, GREEN);
  assert.match(r.out.content, /本机网段已在其他槽位/);
  assert.equal(r.out.title, "po0 加白 1/1");
});

test("其他 403 按失败处理", async () => {
  const r = await run({ argument: "tokens=pgnfw_abc", responses: [{ status: 403, body: { message: "forbidden" } }] });
  assert.equal(r.out.icon, RED);
});

test("网络错误按 3s、8s 重试，第三次成功", async () => {
  const r = await run({ argument: "tokens=pgnfw_abc@1", responses: [{ err: "timeout" }, { err: "timeout" }, OK] });
  assert.equal(r.calls.length, 3);
  assert.deepEqual(r.delays, [3000, 8000]);
  assert.equal(r.out.icon, GREEN);
});

test("5xx 重试；429 不重试", async () => {
  let r = await run({ argument: "tokens=pgnfw_abc", responses: [{ status: 502, body: "" }, OK] });
  assert.equal(r.calls.length, 2);
  assert.equal(r.out.icon, GREEN);
  r = await run({ argument: "tokens=pgnfw_abc", responses: [{ status: 429, body: { message: "slow down" } }] });
  assert.equal(r.calls.length, 1);
  assert.equal(r.out.icon, RED);
});

test("400 不重试，失败只通知一次，换措辞不再通知，恢复再通知", async () => {
  const store = {};
  let r = await run({ argument: "tokens=pgnfw_bad", responses: [BAD], store });
  assert.equal(r.calls.length, 1);
  assert.match(r.out.content, /serviceId is required/);
  assert.deepEqual(r.notes, [[NAME, "🚨 加白失败", "❌ HTTP 400 serviceId is required"]]);
  r = await run({ argument: "tokens=pgnfw_bad", responses: [BAD], store });
  assert.equal(r.notes.length, 0);
  r = await run({ argument: "tokens=pgnfw_bad", responses: [{ status: 400, body: { message: "other" } }], store });
  assert.equal(r.notes.length, 0);
  r = await run({ argument: "tokens=pgnfw_bad", responses: [OK], store });
  assert.deepEqual(r.notes, [[NAME, "🎉 已恢复", "✅ 已加白\n🌐 出口 203.0.113.0/24"]]);
});

test("暂时性错误面板显示失败，但不改状态、不通知", async () => {
  const store = {};
  await run({ argument: "tokens=pgnfw_abc", responses: [OK], store });
  const offline = [{ err: "offline" }, { err: "offline" }, { err: "offline" }];
  let r = await run({ argument: "tokens=pgnfw_abc", responses: offline, store });
  assert.equal(r.out.icon, RED);
  assert.equal(r.notes.length, 0);
  assert.equal(store.po0fw_state, "ok");
  r = await run({ argument: "tokens=pgnfw_abc", responses: [{ status: 429, body: {} }], store });
  assert.equal(r.notes.length, 0);
  r = await run({ argument: "tokens=pgnfw_abc", responses: [OK], store });
  assert.equal(r.notes.length, 0); // 没有进入失败，也就没有「已恢复」

  // 已经失败时，暂时性错误不算恢复
  await run({ argument: "tokens=pgnfw_abc", responses: [BAD], store });
  r = await run({ argument: "tokens=pgnfw_abc", responses: [{ status: 429, body: {} }], store });
  assert.equal(store.po0fw_state, "fail");
  assert.equal(r.notes.length, 0);
});

test("notify_update 默认关闭：出口变化不推送，也不留记录", async () => {
  const store = { po0fw_last: "192.0.2.0/24" }; // 之前打开过
  await run({ argument: "tokens=pgnfw_abc", responses: [OK], store });
  const r = await run({ argument: "tokens=pgnfw_abc", responses: [okWith({ currentIp: "192.0.2.0/24" })], store });
  assert.equal(r.notes.length, 0);
  assert.ok(!store.po0fw_last);
});

test("notify_update=1：第一次成功推送当前网段，变化推送旧 → 新，未变化不推送", async () => {
  const store = {};
  const argument = "tokens=pgnfw_abc@0&notify_update=1";
  const moved = { currentIp: "192.0.2.7", whitelist: [{ ip: "192.0.2.0/24", slot: 0 }] };
  let r = await run({ argument, responses: [OK], store });
  assert.deepEqual(r.notes, [[NAME, "✅ 已加白 · 📌 槽位 0", "🌐 出口网段 203.0.113.0/24"]]);
  r = await run({ argument, responses: [OK], store });
  assert.equal(r.notes.length, 0);
  r = await run({ argument, responses: [okWith(moved)], store });
  assert.deepEqual(r.notes, [[NAME, "🔄 出口网段已更新 · 📌 槽位 0", "🌐 203.0.113.0/24 → 192.0.2.0/24"]]);

  // 403 pinned（没有 currentIp）和加白未生效都不改记录、不推送
  r = await run({ argument, responses: [PINNED], store });
  assert.equal(r.notes.length, 0);
  r = await run({ argument, responses: [okWith({ currentIp: "198.51.100.4", whitelist: [{ ip: "192.0.2.0/24", slot: 0 }] })], store });
  assert.equal(store.po0fw_last, "192.0.2.0/24");
  assert.equal(r.notes.filter((n) => /已加白|出口网段/.test(n[1])).length, 0);

  // 关掉再打开：重新从第一次算
  await run({ argument: "tokens=pgnfw_abc@0", responses: [okWith(moved)], store });
  r = await run({ argument, responses: [okWith(moved)], store });
  assert.deepEqual(r.notes, [[NAME, "✅ 已加白 · 📌 槽位 0", "🌐 出口网段 192.0.2.0/24"]]);
});

test("多 token；部分失败；未配置 token 只通知一次", async () => {
  let r = await run({ argument: "tokens=pgnfw_a@0,pgnfw_b", responses: [OK, OK] });
  assert.equal(r.calls[1].url, "https://124.221.69.228/api/firewall/pgnfw_b/add");
  assert.equal(r.out.title, "po0 加白 2/2 · 出口 203.0.113.0/24");
  r = await run({ argument: "tokens=pgnfw_a@0,pgnfw_b", responses: [OK, BAD] });
  assert.equal(r.store.po0fw_state, "ok,fail");
  assert.deepEqual(r.notes, [
    [NAME, "🚨 1/2 个 token 加白失败", "#1 📌0 ✅ 已加白\n#2 ❌ HTTP 400 serviceId is required\n🌐 出口 203.0.113.0/24"],
  ]);
  assert.equal(r.out.title, "po0 加白 1/2 · 出口 203.0.113.0/24");
  const store = {};
  r = await run({ argument: "tokens=", store });
  assert.deepEqual(r.notes, [[NAME, "⚠️ 未配置 token", "在模块参数 tokens 里填入 pgnfw_ token"]]);
  r = await run({ argument: "tokens=", store });
  assert.equal(r.notes.length, 0);
});

test("格式错误的 token 显示为失败项，不发请求", async () => {
  const r = await run({ argument: "tokens=pgnfw_a@1,pgnfw_b@", responses: [OK] });
  assert.equal(r.calls.length, 1);
  assert.equal(r.out.title, "po0 加白 1/2 · 出口 203.0.113.0/24");
  assert.equal(r.out.icon, RED);
  assert.match(r.out.content, /#2 ❌ token 格式错误/);
});

test("错误文本里的 token 打码", async () => {
  const echo = { status: 404, body: { message: "Cannot POST /api/firewall/pgnfw_s3cret/add" } };
  const r = await run({ argument: "tokens=pgnfw_s3cret", responses: [echo] });
  assert.doesNotMatch(r.out.content, /s3cret/);
  assert.match(r.out.content, /pgnfw_\*\*\*/);
  assert.doesNotMatch(JSON.stringify(r.notes), /s3cret/);
});

test("异常走 catch，仍然调用 $done", async () => {
  const r = await run({ argument: "tokens=pgnfw_s3cret", responses: [{ throw: "boom pgnfw_s3cret" }] });
  assert.equal(r.out.icon, RED);
  assert.match(r.out.content, /boom pgnfw_\*\*\*/);
  assert.deepEqual(r.notes, [[NAME, "💥 脚本出错", "boom pgnfw_***"]]);
});

test("enabled:false 先于 whitelist 检查", async () => {
  const r = await run({ argument: "tokens=pgnfw_abc", responses: [{ status: 200, body: { enabled: false } }] });
  assert.match(r.out.content, /防火墙未启用/);
});

test("sameC24：两个精确 IP 要求全等；兼容旧格式字符串条目", async () => {
  let r = await run({
    argument: "tokens=pgnfw_abc",
    responses: [okWith({ currentIp: "198.51.100.4", whitelist: [{ ip: "198.51.100.9", slot: 1 }] })],
  });
  assert.match(r.out.content, /加白未生效/);
  r = await run({
    argument: "tokens=pgnfw_abc",
    responses: [okWith({ currentIp: "198.51.100.4", whitelist: ["198.51.100.0/24"] })],
  });
  assert.equal(r.out.icon, GREEN);
  r = await run({
    argument: "tokens=pgnfw_abc",
    responses: [okWith({ currentIp: "198.51.100.4", whitelist: [{ ip: "198.51.101.0/24", slot: 1 }] })],
  });
  assert.match(r.out.content, /加白未生效/);
});

test("skip_ssid：连着家里 Wi-Fi 时不请求、不改状态", async () => {
  const store = { po0fw_state: "ok" };
  const home = { wifi: { ssid: "Home 5G" } };
  let r = await run({ argument: "tokens=pgnfw_abc@0&skip_ssid=Home 5G,Office", network: home, store });
  assert.equal(r.calls.length, 0);
  assert.equal(r.out.title, "po0 加白 已跳过");
  assert.equal(store.po0fw_state, "ok");
  r = await run({
    argument: "tokens=pgnfw_abc@0&skip_ssid=Home 5G",
    network: { wifi: { ssid: "Cafe" } },
    responses: [OK],
  });
  assert.equal(r.calls.length, 1);
  r = await run({ argument: "tokens=pgnfw_abc@0&skip_ssid=", network: home, responses: [OK] });
  assert.equal(r.calls.length, 1);
});
