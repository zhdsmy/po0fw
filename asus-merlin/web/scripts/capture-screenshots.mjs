import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createPreviewServer } from "../preview/server.mjs";

const outputDir = fileURLToPath(new URL("../../docs/images/", import.meta.url));
await mkdir(outputDir, { recursive: true });

const server = createPreviewServer();
server.listen(0, "127.0.0.1");
await once(server, "listening");

const browser = await chromium.launch();
const context = await browser.newContext({
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();
const url = `http://127.0.0.1:${server.address().port}/Module_po0fw.asp`;

async function ready() {
  await page.getByRole("button", { name: "保存并应用", exact: true }).waitFor();
  await page.getByText("白名单已用 3/5", { exact: true }).waitFor();
}

async function choose(label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function save(name) {
  await page.screenshot({
    path: join(outputDir, `${name}.png`),
    animations: "disabled",
    caret: "hide",
    fullPage: true,
  });
}

try {
  await page.goto(url, { waitUntil: "networkidle" });
  await ready();
  await save("desktop-overview");

  await choose("通知渠道", "Bark");
  await page.getByLabel("Bark 地址", { exact: true }).fill("https://api.day.app/TEST-bark-key");
  await page.locator('button[aria-controls="po0fw_bark_url"]').click();
  await page.getByLabel("通知代理", { exact: true }).fill("https://192.0.2.2:7890");
  await save("desktop-notification");

  await choose("通知渠道", "Telegram");
  await page.getByLabel("Telegram Bot Token", { exact: true }).fill("123456789:TEST_only");
  await page.locator('button[aria-controls="po0fw_tg_token"]').click();
  await page.getByLabel("Telegram Chat ID", { exact: true }).fill("@TEST_channel");
  await page.getByLabel("Telegram API 地址", { exact: true }).fill("https://example.test/api");
  await page.getByLabel("通知代理", { exact: true }).fill("socks5h://192.0.2.2:7891");
  await save("desktop-telegram");
} finally {
  await context.close();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
