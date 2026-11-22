import assert from "node:assert/strict";
import { test } from "node:test";
import { button, choose, openPreview, ready, shot } from "./fixture.mjs";

const names = ["保存并应用", "立即更新", "清空日志", "测试通知"];
const notifications = {
  po0fw_notify: "telegram", po0fw_bark_url: "https://example.test/TEST-bark",
  po0fw_tg_token: "123456:TEST_only", po0fw_tg_chat: "@TEST_channel",
  po0fw_tg_api: "https://example.test/api", po0fw_proxy: "socks5h://192.0.2.1:7890",
};
const logText = Array.from({ length: 80 }, (_, i) => `[12:00:${i}] 槽位 1：192.0.2.0/24`).join("\n");

test("defaults, four wire payloads, conditional fields, visibility and saved settings", async (t) => {
  const { page, url } = await openPreview(t);
  await page.goto(url);
  await ready(page);
  const field = (id) => page.locator("#" + id);
  const combo = (name) => page.getByRole("combobox", { name });
  const visible = async (id, expected) => assert.equal(await field(id).isVisible(), expected);
  const typeSecret = async (id, raw) => {
    assert.equal(await field(id).getAttribute("type"), "password");
    await field(id).fill(raw);
    const toggle = page.locator(`button[aria-controls="${id}"]`);
    await toggle.click();
    assert.equal(await field(id).getAttribute("type"), "text");
    await toggle.click();
    assert.equal(await field(id).getAttribute("type"), "password");
  };
  async function action(n, expected) {
    const [request] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/_api/")),
      button(page, names[n - 1]).click(),
    ]);
    const { id, ...body } = JSON.parse(request.postData());
    assert.ok(Number.isInteger(id) && id >= 0 && id < 100000000);
    assert.deepEqual(body, { method: "po0fw_config.sh", params: [n], fields: expected });
    assert.equal(request.headers()["content-type"], "application/x-www-form-urlencoded; charset=UTF-8");
    await ready(page);
  }
  const enabled = page.getByRole("switch", { name: "启用" });
  assert.equal(await enabled.getAttribute("aria-checked"), "true");
  await enabled.click();
  assert.equal(await enabled.getAttribute("aria-checked"), "false");
  await typeSecret("po0fw_token", " pgnfw_TESTtoken123 ");
  await combo("固定槽位").click();
  await page.getByRole("option").first().waitFor();
  assert.deepEqual(await page.getByRole("option").allTextContents(), Array.from({ length: 10 }, (_, i) => String(i)));
  await page.getByRole("option", { name: "9", exact: true }).click();
  await choose(page, "检查间隔", "30 分钟");
  await combo("通知渠道").click();
  await page.getByRole("option").first().waitFor();
  assert.deepEqual(await page.getByRole("option").allTextContents(), ["关闭", "Bark", "Telegram"]);
  await page.keyboard.press("Escape");
  await visible("po0fw_bark_url", false);
  await visible("po0fw_tg_chat", false);
  await visible("po0fw_proxy", false);
  await choose(page, "通知渠道", "Bark");
  await typeSecret("po0fw_bark_url", " " + notifications.po0fw_bark_url + " ");
  await visible("po0fw_proxy", true);
  await visible("po0fw_tg_token", false);
  await choose(page, "通知渠道", "Telegram");
  await visible("po0fw_bark_url", false);
  await typeSecret("po0fw_tg_token", " " + notifications.po0fw_tg_token + " ");
  await field("po0fw_tg_chat").fill(" @TEST_channel ");
  await field("po0fw_tg_api").fill(" https://example.test/api/// ");
  await field("po0fw_proxy").fill(" " + notifications.po0fw_proxy + " ");
  await action(4, notifications);
  await action(1, { ...notifications, po0fw_enable: "0", po0fw_token: "pgnfw_TESTtoken123",
    po0fw_slot: "9", po0fw_interval: "30" });
  await action(2, {});
  await action(3, {});
  assert.equal(await page.getByRole("log", { name: "日志", exact: true }).innerText(), "暂无日志");
  await page.reload();
  await ready(page);
  assert.equal(await enabled.getAttribute("aria-checked"), "false");
  assert.equal(await combo("固定槽位").innerText(), "9");
  assert.equal(await combo("检查间隔").innerText(), "30 分钟");
  assert.equal(await combo("通知渠道").innerText(), "Telegram");
  assert.equal(await field("po0fw_tg_api").inputValue(), notifications.po0fw_tg_api);
});

test("all legacy validation branches and their bypass conditions", async (t) => {
  const { page, url } = await openPreview(t);
  const posts = [];
  page.on("request", (r) => { if (r.method() === "POST") posts.push(JSON.parse(r.postData())); });
  await page.goto(url);
  await ready(page);
  const fill = (id, v) => page.locator("#po0fw_" + id).fill(v);
  async function reject(name, message) {
    const before = posts.length;
    await button(page, name).click();
    await page.getByRole("alert").getByText(message, { exact: true }).waitFor();
    assert.equal(posts.length, before);
  }
  const save = "保存并应用", notify = "测试通知";
  const badToken = "请填写 pgnfw_ 开头的 API token（不要带 @槽位）。";
  await fill("token", "");
  await reject(save, badToken);
  await shot(page, "validation-1280");
  await page.getByRole("switch").click();
  await fill("token", "pgnfw_TEST@9");
  await reject(save, badToken);
  await fill("token", " ");
  await button(page, save).click();
  await ready(page);
  assert.equal(posts.at(-1).fields.po0fw_token, "");
  await reject(notify, "先选择通知渠道。");
  await choose(page, "通知渠道", "Bark");
  await fill("bark_url", "https://example.test/");
  await reject(notify, "Bark 地址格式：https://api.day.app/你的key");
  await fill("bark_url", "http://example.test/TEST/");
  await fill("token", "invalid");
  await button(page, notify).click();
  await ready(page);
  assert.equal(posts.at(-1).params[0], 4);
  await choose(page, "通知渠道", "Telegram");
  await reject(notify, "Telegram Bot Token 格式：123456789:ABC...");
  await fill("tg_token", "123:TEST-abc_");
  await fill("tg_chat", "@not valid");
  await reject(notify, "Telegram Chat ID 是数字（群组以 - 开头），或 @频道名");
  await fill("tg_chat", "-100123");
  await fill("tg_api", "ftp://example.test");
  await reject(notify, "Telegram API 地址以 http:// 或 https:// 开头，留空用官方地址");
  await fill("tg_api", "");
  const badProxy = "代理格式：http://host:port 或 socks5h://host:port，留空直连";
  await fill("proxy", "ftp://example.test");
  await reject(notify, badProxy);
  await choose(page, "通知渠道", "关闭");
  await reject(notify, badProxy); // Legacy validates stale proxy even when its field is hidden.
  await choose(page, "通知渠道", "Telegram");
  for (const scheme of ["http", "https", "socks4", "socks4a", "socks5", "socks5h"]) {
    await fill("proxy", scheme + "://192.0.2.1:7890");
    await button(page, notify).click();
    await ready(page);
    assert.equal(posts.at(-1).fields.po0fw_proxy, scheme + "://192.0.2.1:7890");
  }
  await button(page, "立即更新").click();
  await ready(page);
  assert.deepEqual(posts.at(-1).fields, {});
});

test("wide and narrow layouts, dark controls, slot board, notes and scrolled log", async (t) => {
  const { page, url } = await openPreview(t);
  await page.goto(url);
  await ready(page);
  for (const note of ["把路由器公网出口所在的 /24 写进 po0 防火墙白名单的固定槽位。", "换 IP 时只替换这个槽位",
    "每次拨号成功也会立即更新", "网段变化、连续失败 3 次、失败后恢复时各通知一次"]) {
    await page.getByText(note, { exact: true }).waitFor();
  }
  const bays = page.getByRole("list", { name: "白名单槽位" }).getByRole("listitem");
  assert.deepEqual(await bays.allInnerTexts(), ["#0\n192.0.2.0/24", "#1\n本路由器\n198.51.100.0/24",
    "#2\n空闲", "#3\n空闲", "#4\n203.0.113.0/24"]);
  for (const bay of await bays.all()) {
    assert.equal(await bay.evaluate((el) => el.scrollWidth <= el.clientWidth), true, "IP must not overflow its bay");
  }
  await page.getByText("白名单已用 3/5", { exact: true }).waitFor();
  await page.getByText("槽位 1：198.51.100.0/24（未变化）", { exact: true }).waitFor();
  for (const width of [1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator("main").evaluate((el) => el.getBoundingClientRect().right <= innerWidth), true);
    if (width !== 1280) await shot(page, "after-" + width);
  }
  await page.route("**/_temp/po0fw_log.txt", (r) => r.fulfill({ body: logText }));
  await page.reload();
  await ready(page);
  const log = page.getByRole("log", { name: "日志", exact: true });
  assert.equal(await log.getByRole("listitem").count(), 80);
  assert.equal(await log.evaluate((el) => el.scrollHeight > el.clientHeight &&
    Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1), true);
  const sw = page.getByRole("switch");
  const colors = () => sw.evaluate((el) => [el, el.firstElementChild].map((part) => getComputedStyle(part).backgroundColor));
  const light = await colors();
  await page.emulateMedia({ colorScheme: "dark" });
  assert.deepEqual(await colors(), light);

});

test("busy actions and polling await either status or log; clear reads only once", async (t) => {
  const { page, url } = await openPreview(t);
  let status = "初始状态\n详情", log = "初始日志\n", statusReads = 0, logReads = 0;
  await page.route("**/_temp/po0fw_status.txt", (r) => { statusReads++; return r.fulfill({ body: status }); });
  await page.route("**/_temp/po0fw_log.txt", (r) => { logReads++; return r.fulfill({ body: log }); });
  await page.route("**/_api/", (r) => r.fulfill({ json: "arbitrary success" }));
  await page.goto(url);
  await ready(page);
  for (const change of ["log", "status"]) {
    const firstRead = page.waitForResponse((r) => r.url().endsWith("/_temp/po0fw_log.txt"));
    await button(page, "立即更新").click();
    await firstRead;
    for (const name of names) assert.equal(await button(page, name).isDisabled(), true);
    if (change === "log") await shot(page, "running-1280");
    const start = performance.now();
    if (change === "log") log += "测试日志\n";
    else status = "新状态\n新详情";
    await ready(page);
    assert.ok(performance.now() - start > 1400, "the repoll should wait about two seconds");
  }
  const before = [statusReads, logReads];
  await button(page, "清空日志").click();
  await ready(page);
  assert.deepEqual([statusReads, logReads], before.map((n) => n + 1));
});

test("poll timeout, malformed JSON, HTTP failure and settings read failure", async (t) => {
  const { page, url } = await openPreview(t);
  await page.addInitScript(() => {
    const nativeTimeout = window.setTimeout;
    window.pollWaits = [];
    window.setTimeout = (callback, delay, ...args) => {
      if (delay === 2000) { window.pollWaits.push(delay); delay = 5; }
      return nativeTimeout(callback, delay, ...args);
    };
  });
  let reply = { json: {} };
  let statusReads = 0;
  page.on("response", (r) => { if (r.url().endsWith("/_temp/po0fw_status.txt")) statusReads++; });
  await page.route("**/_api/", (r) => r.fulfill(reply));
  await page.goto(url);
  await ready(page);
  const before = statusReads;
  await button(page, "立即更新").click();
  await ready(page);
  assert.equal(statusReads - before, 31);
  assert.equal(await page.evaluate(() => window.pollWaits.length), 30);
  for (const [result, message] of [[{ body: "no-json" }, "软件中心返回的 JSON 无效。"],
    [{ status: 503, body: "" }, "请求失败（HTTP 503）"]]) {
    reply = result;
    await button(page, "立即更新").click();
    await page.getByText(message, { exact: true }).waitFor();
    for (const name of names) assert.equal(await button(page, name).isEnabled(), true);
  }
  await page.route("**/_api/po0fw", (r) => r.fulfill({ status: 503 }));
  await page.route("**/_temp/po0fw_status.txt", (r) => r.fulfill({ status: 404 }));
  await page.reload();
  await page.getByText("设置读取失败，请刷新页面重试。").waitFor();
  await page.getByText("尚未运行", { exact: true }).waitFor();
  assert.equal(await button(page, "保存并应用").isDisabled(), true);
});
