import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const plugin = new URL("../../po0fw/", import.meta.url);
const files = new Map([
  ["/js/jquery.js", ["text/javascript", new URL("../node_modules/jquery/dist/jquery.min.js", import.meta.url)]],
  ["/res/icon-po0fw.png", ["image/png", new URL("res/icon-po0fw.png", plugin)]],
  ["/index_style.css", ["text/css", new URL("./shell.css", import.meta.url)]],
  ["/state.js", ["text/javascript", new URL("./shell.js", import.meta.url)]],
]);
const emptyAssets = new Map([
  ...["/help.js", "/general.js", "/popup.js", "/res/softcenter.js"]
    .map((path) => [path, "text/javascript"]),
  ...["/form_style.css", "/css/element.css", "/res/softcenter.css"].map((path) => [path, "text/css"]),
  ["/images/favicon.png", "image/png"],
]);
// Tests can swap a package on disk without changing the browser origin.
export function createPreviewServer({
  pageFile = new URL("../dist/Module_po0fw.asp", import.meta.url),
  resources = new URL("res/", plugin),
  versionFile = new URL("version", plugin),
} = {}) {
  const assets = new Map(files);
  for (const path of ["/", "/Module_po0fw.asp"]) assets.set(path, ["text/html", pageFile]);
  assets.set("/res/po0fw-app.js", ["text/javascript", new URL("po0fw-app.js", resources)]);
  assets.set("/res/po0fw-app.css", ["text/css", new URL("po0fw-app.css", resources)]);
  const settings = {
    po0fw_enable: "1", po0fw_token: "pgnfw_TESTtoken123", po0fw_interval: "5", po0fw_slot: "1",
    po0fw_notify: "off", po0fw_bark_url: "", po0fw_tg_token: "", po0fw_tg_chat: "",
    po0fw_tg_api: "", po0fw_proxy: "",
  };
  let status = "[2026-11-22 12:00:00] 槽位 1：192.0.2.0/24（未变化）\n白名单 1：192.0.2.0/24 #1";
  let log = "[2026-11-22 12:00:00] web: 槽位 1 无 -> 192.0.2.0/24\n";
  const actions = ["", "保存并应用", "立即更新", "清空日志", "测试通知"];

  return createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const send = (type, content, code = 200, cache = "no-store") => {
      res.writeHead(code, { "Content-Type": type, "Cache-Control": cache });
      res.end(content);
    };
    try {
      if (req.method === "POST" && path === "/_api/") {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const { id, method, params, fields } = JSON.parse(Buffer.concat(chunks).toString());
        const action = params?.[0];
        if (method !== "po0fw_config.sh" || !Number.isInteger(action) || !actions[action]) {
          return send("text/plain", "Invalid action", 400);
        }
        for (const [key, value] of Object.entries(fields)) {
          if (Object.hasOwn(settings, key) && typeof value === "string") settings[key] = value;
        }
        if (action === 3) {
          log = "";
        } else {
          const line = `[${new Date().toISOString()}] ${actions[action]}`;
          log += line + "\n";
          if (action !== 4) status = line + "\n192.0.2.0/24";
        }
        return send("application/json", JSON.stringify({ result: id }));
      }
      if (req.method !== "GET") return send("text/plain", "Method not allowed", 405);
      if (path === "/_api/po0fw") {
        const version = (await readFile(versionFile, "utf8")).trim();
        return send("application/json", JSON.stringify({ result: [{ ...settings, po0fw_version: version }] }));
      }
      if (path === "/_temp/po0fw_log.txt") return send("text/plain; charset=utf-8", log);
      if (path === "/_temp/po0fw_status.txt") return send("text/plain; charset=utf-8", status);
      if (path === "/Module_Softcenter.asp") return send("text/plain; charset=utf-8", "软件中心");
      if (emptyAssets.has(path)) return send(emptyAssets.get(path), "", 204);
      if (path === "/images/backprev.png" || path === "/images/backprevclick.png") {
        return send("image/svg+xml", '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" style="color-scheme:dark"><path d="M15 5l-7 7 7 7" fill="none" stroke="CanvasText" stroke-width="2"/></svg>');
      }
      if (!assets.has(path)) return send("text/plain", "Not found", 404);
      const [type, file] = assets.get(path);
      const cache = path.startsWith("/res/po0fw-app.") ? "public, max-age=31536000, immutable" : "no-store";
      return send(type, await readFile(file), 200, cache);
    } catch (error) {
      return send("text/plain", error.code === "ENOENT" ? "Run npm run build first" : "Invalid request",
        error.code === "ENOENT" ? 404 : 400);
    }
  });
}

if (import.meta.main) {
  const server = createPreviewServer();
  server.listen(Number(process.env.PORT ?? 4173), "127.0.0.1", () => {
    console.log(`http://127.0.0.1:${server.address().port}/Module_po0fw.asp`);
  });
}
