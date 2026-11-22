import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFile, copyFile, cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { button, choose, openPreview, ready, shot } from "./fixture.mjs";

const web = fileURLToPath(new URL("../", import.meta.url));
const plugin = new URL("../../po0fw/", import.meta.url);
const assetNames = ["po0fw-app.js", "po0fw-app.css"];
// Immutable main at the start of the migration, also the 1.1.2 ASP.
const baseline = "da300bd9c307044092652a4cb4dcebce8368e4e4";
const oldPage = execFileSync("git", ["show", `${baseline}:asus-merlin/po0fw/webs/Module_po0fw.asp`], { cwd: web });
const oldVersion = execFileSync("git", ["show", `${baseline}:asus-merlin/po0fw/version`], { cwd: web });

// The actual browser cache stays enabled: no Playwright request routing in this test.
test("upgrade from the old ASP, then deploy CSS-only and JS-only changes at one version", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "po0fw-cache-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pageFile = join(dir, "Module_po0fw.asp"), versionFile = join(dir, "version");
  const resources = pathToFileURL(dir + "/");
  await writeFile(pageFile, oldPage);
  await writeFile(versionFile, oldVersion);
  const { page, server, url } = await openPreview(t, { pageFile, versionFile, resources });
  const requests = [];
  server.on("request", (req) => {
    if (req.url.startsWith("/res/po0fw-app.")) requests.push(req.url);
  });
  const navigate = async () => {
    await page.goto(new URL("/Module_Softcenter.asp", url).href);
    await page.goto(url);
  };
  await navigate();
  await page.getByText("当前版本：" + oldVersion.toString().trim(), { exact: true }).waitFor();
  await page.waitForFunction(() => window.jQuery.active === 0);
  await shot(page, "before-1280");
  const chrome = ["#TopBanner", "#mainMenu", "#subMenu", "#tabMenu"];
  // Footer follows the variable-height form. Compare geometry and complete
  // computed styles without treating vertical flow or subpixel rasterization as changes.
  const footer = () => page.locator("#footer").evaluate((el) => {
    const { x, width, height } = el.getBoundingClientRect();
    const css = getComputedStyle(el);
    return { html: el.outerHTML, x, width, height, styles: Array.from(css, (key) => [key, css.getPropertyValue(key)]) };
  });
  const oldFooter = await footer();
  const before = [];
  for (const selector of chrome) before.push(await page.locator(selector).screenshot());
  assert.deepEqual(requests, []);

  // Build two real prior test packages from this source in an isolated directory.
  const scratchWeb = join(dir, "build/web"), scratchRes = join(dir, "build/po0fw/res");
  await mkdir(scratchWeb, { recursive: true });
  await mkdir(scratchRes, { recursive: true });
  await cp(new URL("webs/", plugin), join(dir, "build/po0fw/webs"), { recursive: true });
  await cp(join(web, "src"), join(scratchWeb, "src"), { recursive: true });
  for (const path of ["build.mjs", "tsconfig.json", "package.json"]) {
    await copyFile(join(web, path), join(scratchWeb, path));
  }
  await symlink(join(web, "node_modules"), join(scratchWeb, "node_modules"), "dir");
  const script = join(scratchWeb, "src/main.tsx"), css = join(scratchWeb, "src/styles.css");
  await appendFile(script, '\ndocument.documentElement.dataset.priorPackage = "yes";\n');
  await appendFile(css, '\n:host { --prior-style: yes; }\n');
  await copyFile(new URL("version", plugin), versionFile);

  async function install(source, res) {
    for (const name of assetNames) await copyFile(join(res, name), join(dir, name));
    await copyFile(join(source, "dist/Module_po0fw.asp"), pageFile);
  }

  const revisions = [];
  for (const step of ["old-test", "css-change", "js-change"]) {
    if (step === "css-change") await copyFile(join(web, "src/styles.css"), css);
    if (step === "js-change") {
      await install(web, fileURLToPath(new URL("res/", plugin)));
    } else {
      execFileSync(process.execPath, ["build.mjs"], { cwd: scratchWeb, stdio: "pipe" });
      await install(scratchWeb, scratchRes);
    }
    const count = requests.length;
    await navigate();
    await ready(page);
    const observed = await page.evaluate(() => {
      const host = document.getElementById("po0fw-app");
      const script = document.querySelector('script[src*="po0fw-app.js"]');
      const css = host.shadowRoot.querySelector('link[rel="stylesheet"]');
      return {
        revisions: [new URL(script.src).search, new URL(css.href).search],
        priorScript: document.documentElement.dataset.priorPackage,
        priorStyle: getComputedStyle(host).getPropertyValue("--prior-style").trim(),
      };
    });
    const [revision, cssRevision] = observed.revisions;
    assert.match(revision, /^\?v=[a-f0-9]{20}$/);
    assert.equal(revision, cssRevision);
    assert.ok(!revisions.includes(revision));
    revisions.push(revision);
    assert.deepEqual(requests.slice(count), assetNames.map((name) => "/res/" + name + revision));
    assert.equal(observed.priorScript, step === "js-change" ? undefined : "yes");
    assert.equal(observed.priorStyle, step === "old-test" ? "yes" : "");
    assert.equal(await page.getByText("当前版本：1.2.0-test.1", { exact: true }).count(), 1);

    // A fresh navigation within the same package uses the browser's cached copies.
    await navigate();
    await ready(page);
    assert.equal(requests.length, count + 2);
  }
  await shot(page, "after-1280");
  assert.deepEqual(await footer(), oldFooter);
  for (const [index, selector] of chrome.entries()) {
    const after = await page.locator(selector).screenshot();
    assert.ok(before[index].equals(after), "ASUS mock chrome differs at " + selector);
  }
});

test("the old and new pages issue the same four API requests on one mock", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "po0fw-parity-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const pageFile = join(dir, "Module_po0fw.asp");
  await writeFile(pageFile, oldPage);
  const { page, url } = await openPreview(t, { pageFile });
  const old = [], current = [];
  for (const legacy of [true, false]) {
    if (!legacy) await copyFile(join(web, "dist/Module_po0fw.asp"), pageFile);
    await page.goto(url);
    if (legacy) {
      await page.waitForFunction(() => window.jQuery?.active === 0 && document.getElementById("po0fw_token")?.value);
      await page.locator("#po0fw_notify").selectOption("telegram");
    } else {
      await ready(page);
      await choose(page, "通知渠道", "Telegram");
    }
    for (const [key, value] of Object.entries({
      token: "  pgnfw_TESTparity  ", tg_token: " 123:TEST-abc ", tg_api: " https://example.test/tg/// ",
      tg_chat: " -100123 ", proxy: " socks4a://198.51.100.1:7890 ",
    })) await page.locator("#po0fw_" + key).fill(value);
    for (const [key, name] of [["apply", "保存并应用"], ["run", "立即更新"], ["test", "测试通知"], ["clear", "清空日志"]]) {
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/_api/")),
        legacy ? page.locator("#po0fw_" + key).click() : button(page, name).click(),
      ]);
      const { id, ...body } = JSON.parse(req.postData());
      assert.ok(Number.isInteger(id));
      (legacy ? old : current).push([req.method(), req.headers()["content-type"], body]);
      if (legacy) await page.waitForFunction(() => !document.getElementById("po0fw_apply").disabled);
      else await ready(page);
    }
  }
  assert.deepEqual(current, old);
});
