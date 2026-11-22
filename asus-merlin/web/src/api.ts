import { defaults, type Action, type Settings } from "./settings";

async function request(path: string, body?: object) {
  const response = await fetch(path, {
    cache: "no-store",
    method: body ? "POST" : "GET",
    headers: {
      "X-Requested-With": "XMLHttpRequest",
      ...(body && { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" }),
    },
    body: body && JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
  return response;
}

export async function readSettings(): Promise<Settings> {
  const response = await request("/_api/po0fw");
  const data = (await response.json()).result[0] || {};
  const settings = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    settings[key] = String(data[key] || defaults[key]);
  }
  settings.po0fw_enable = settings.po0fw_enable === "1" ? "1" : "0";
  return settings;
}

export const emptyOutput = { status: "", log: "", statusAvailable: false };
type Output = typeof emptyOutput;
export async function readOutput(previous: Output): Promise<Output> {
  const [status, log] = await Promise.all([
    request("/_temp/po0fw_status.txt").then((r) => r.text()).catch(() => null),
    request("/_temp/po0fw_log.txt").then((r) => r.text()).catch(() => previous.log),
  ]);
  return { status: status ?? previous.status, statusAvailable: status !== null, log };
}

export async function execute(action: Action, fields: Record<string, string>,
  before: Output, display: (next: Output) => void) {
  const response = await request("/_api/", {
    id: Math.floor(Math.random() * 100000000), method: "po0fw_config.sh", params: [action], fields,
  });
  // The firmware decides the JSON shape; a successful AJAX response is sufficient.
  if (response.status !== 204) {
    try { await response.json(); } catch { throw new Error("软件中心返回的 JSON 无效。"); }
  }
  let previous = before;
  for (let attempt = 0; attempt <= 30; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000));
    previous = await readOutput(previous);
    display(previous);
    if (action === 3 || before.status !== previous.status || before.log !== previous.log) return;
  }
}
