import assert from "node:assert/strict";
import { test } from "node:test";
import { openPreview, ready, shot } from "./fixture.mjs";

test("Kumo controls, focus and popup stay in the dark shadow tree", async (t) => {
  const { page, url } = await openPreview(t);
  await page.goto(url);
  await ready(page);
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
  await shot(page, "select-open-1280");
  await page.keyboard.press("Enter");
  assert.equal((await trigger.innerText()).trim(), "10 分钟");

  // A quick reopen followed by Escape used to leave Base UI's modal backdrop
  // over the ASUS shell and the plugin buttons after the list disappeared.
  await trigger.click();
  await page.keyboard.press("Escape");
  await list.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "返回软件中心" }).click();
  assert.equal(new URL(page.url()).pathname, "/Module_Softcenter.asp");
});
