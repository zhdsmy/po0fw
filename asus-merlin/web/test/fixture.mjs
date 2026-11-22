import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { createPreviewServer } from "../preview/server.mjs";

export async function openPreview(t, options) {
  const server = createPreviewServer(options);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 }, colorScheme: "light", reducedMotion: "reduce",
  });
  page.setDefaultTimeout(6000);
  const errors = [];
  const external = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (new URL(r.url()).origin !== origin) external.push(r.url()); });
  t.after(() => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  return { page, server, url: `${origin}/Module_po0fw.asp` };
}

export async function choose(page, label, option) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

export function button(page, name) {
  return page.getByRole("button", { name, exact: true });
}

export async function ready(page) {
  await page.locator("button:enabled").getByText("保存并应用", { exact: true }).waitFor();
}

export async function shot(page, name) {
  if (!process.env.PO0FW_SHOTS) return;
  await mkdir(process.env.PO0FW_SHOTS, { recursive: true });
  await page.screenshot({ path: join(process.env.PO0FW_SHOTS, name + ".png"), animations: "disabled" });
}
