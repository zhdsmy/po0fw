import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLog, parseStatus } from "../src/status.ts";

test("status: success summary becomes a slot board", () => {
  const s = parseStatus("[2026-11-22 12:00:00] ✅ 槽位 1：198.51.100.0/24（未变化）\n" +
    "白名单 4/5：192.0.2.0/24 #0 198.51.100.0/24 #1 198.18.0.0/24 # 203.0.113.0/24 #4  \n");
  assert.deepEqual(s, {
    time: "2026-11-22 12:00:00", tone: "success", text: "槽位 1：198.51.100.0/24（未变化）", detail: "",
    board: { used: 4, limit: 5, own: 1, unpinned: ["198.18.0.0/24"],
      slots: ["192.0.2.0/24", "198.51.100.0/24", null, null, "203.0.113.0/24"] },
  });
});

test("status: missing limit, warnings, errors and free text", () => {
  assert.deepEqual(parseStatus("[t] ⚠️ 槽位 2 已更新为 192.0.2.0/24，通知发送失败\n白名单 1：192.0.2.0/24 #2").board,
    { used: 1, limit: null, own: 2, unpinned: [], slots: [null, null, "192.0.2.0/24"] });
  assert.deepEqual(parseStatus("[t] ❌ HTTP 403\n{\"error\":\"x\"}\n"),
    { time: "t", tone: "danger", text: "HTTP 403", detail: "{\"error\":\"x\"}", board: null });
  assert.equal(parseStatus("[t] ⏸ 已停用\n").tone, "neutral");
  assert.deepEqual(parseStatus("初始状态\n详情"),
    { time: "", tone: "neutral", text: "初始状态", detail: "详情", board: null });
});

test("log: time, source and tone", () => {
  assert.deepEqual(parseLog("[a] cron: HTTP 429，定时任务暂停 15 分钟\n[b] wan-start: 槽位 1 无 -> 192.0.2.0/24\n" +
    "[c] 测试通知发送失败（bark）\n\n[d] web: HTTP 503 x\n"), [
    { time: "a", source: "cron", message: "HTTP 429，定时任务暂停 15 分钟", tone: "warning" },
    { time: "b", source: "wan-start", message: "槽位 1 无 -> 192.0.2.0/24", tone: "neutral" },
    { time: "c", source: "", message: "测试通知发送失败（bark）", tone: "danger" },
    { time: "d", source: "web", message: "HTTP 503 x", tone: "danger" },
  ]);
});
