import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { chromium } from "playwright-core";
import { createPreviewServer } from "../preview/server.mjs";

test("Kumo controls, focus and popup stay in the dark shadow tree", async (t) => {
  const server = createPreviewServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "light" });
  page.setDefaultTimeout(5000);
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (new URL(req.url()).origin !== origin) external.push(req.url());
  });

  await page.goto(`${origin}/Module_po0fw.asp`);
  const input = page.getByLabel("API token", { exact: true });
  await input.fill("pgnfw_TESTtoken123");
  assert.equal(await input.getAttribute("type"), "password");
  await page.getByRole("button", { name: "显示", exact: true }).click();
  assert.equal(await input.getAttribute("type"), "text");
  await page.getByRole("button", { name: "隐藏", exact: true }).click();
  assert.equal(await input.getAttribute("type"), "password");

  const trigger = page.getByRole("combobox", { name: "检查间隔" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const list = page.getByRole("listbox");
  const options = list.getByRole("option");
  await options.first().waitFor();
  assert.deepEqual(await options.allTextContents(), ["1 分钟", "2 分钟", "5 分钟", "10 分钟", "15 分钟", "30 分钟"]);
  const popupStyle = () => list.evaluate((el) => {
    const style = getComputedStyle(el.parentElement);
    return {
      inShadow: el.getRootNode() === document.getElementById("po0fw-app").shadowRoot,
      mode: style.colorScheme, surface: style.backgroundColor, shadow: style.boxShadow,
    };
  });
  const lightSystem = await popupStyle();
  assert.equal(lightSystem.inShadow, true);
  assert.equal(lightSystem.mode, "dark");
  assert.notEqual(lightSystem.shadow, "none");
  await page.emulateMedia({ colorScheme: "dark" });
  assert.deepEqual(await popupStyle(), lightSystem);
  await page.keyboard.press("ArrowDown");
  const highlighted = list.getByRole("option", { name: "10 分钟" });
  assert.equal(await highlighted.evaluate((el) => el.matches(":focus-visible")), true);
  if (process.env.PO0FW_MOUNT_SHOT) {
    await page.screenshot({ path: process.env.PO0FW_MOUNT_SHOT, animations: "disabled" });
  }
  await page.keyboard.press("Enter");
  assert.equal((await trigger.innerText()).trim(), "10 分钟");

  // A quick reopen followed by Escape used to leave Base UI's modal backdrop
  // over the ASUS shell and the plugin buttons after the list disappeared.
  await trigger.click();
  await page.keyboard.press("Escape");
  await list.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "返回软件中心" }).click();
  assert.equal(new URL(page.url()).pathname, "/Module_Softcenter.asp");
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
});
