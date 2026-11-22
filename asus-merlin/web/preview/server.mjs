import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const plugin = new URL("../../po0fw/", import.meta.url);
const files = new Map([
  ["/", ["text/html", new URL("webs/Module_po0fw.asp", plugin)]],
  ["/Module_po0fw.asp", ["text/html", new URL("webs/Module_po0fw.asp", plugin)]],
  ["/res/po0fw-app.js", ["text/javascript", new URL("res/po0fw-app.js", plugin)]],
  ["/res/po0fw-app.css", ["text/css", new URL("res/po0fw-app.css", plugin)]],
  ["/res/icon-po0fw.png", ["image/png", new URL("res/icon-po0fw.png", plugin)]],
  ["/index_style.css", ["text/css", new URL("./shell.css", import.meta.url)]],
  ["/state.js", ["text/javascript", new URL("./shell.js", import.meta.url)]],
]);
const emptyAssets = new Map([
  ...["/js/jquery.js", "/help.js", "/general.js", "/popup.js", "/res/softcenter.js"]
    .map((path) => [path, "text/javascript"]),
  ...["/form_style.css", "/css/element.css", "/res/softcenter.css"].map((path) => [path, "text/css"]),
  ["/images/favicon.png", "image/png"],
]);
const version = (await readFile(new URL("version", plugin), "utf8")).trim();
export function createPreviewServer() {
  const settings = {
    po0fw_enable: "1", po0fw_token: "pgnfw_TESTtoken123", po0fw_interval: "5", po0fw_slot: "1",
    po0fw_notify: "off", po0fw_bark_url: "", po0fw_tg_token: "", po0fw_tg_chat: "",
    po0fw_tg_api: "", po0fw_proxy: "", po0fw_version: version,
  };
  let status = "[2026-11-22 12:00:00] 槽位 1：192.0.2.0/24（未变化）\n白名单 1：192.0.2.0/24 #1";
  let log = "[2026-11-22 12:00:00] web: 槽位 1 无 -> 192.0.2.0/24\n";
  const actions = ["", "保存并应用", "立即更新", "清空日志", "测试通知"];

  return createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const send = (type, content, code = 200) => {
      res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
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
      if (path === "/_api/po0fw") return send("application/json", JSON.stringify({ result: [settings] }));
      if (path === "/_temp/po0fw_log.txt") return send("text/plain; charset=utf-8", log);
      if (path === "/_temp/po0fw_status.txt") return send("text/plain; charset=utf-8", status);
      if (path === "/Module_Softcenter.asp") return send("text/plain; charset=utf-8", "软件中心");
      if (emptyAssets.has(path)) return send(emptyAssets.get(path), "", 204);
      if (!files.has(path)) return send("text/plain", "Not found", 404);
      const [type, file] = files.get(path);
      return send(type, await readFile(file));
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
