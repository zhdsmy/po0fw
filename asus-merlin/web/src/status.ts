// Parses the two files written by po0fw_config.sh: status() and log().
export type Tone = "success" | "warning" | "danger" | "neutral";

export type Board = {
  used: number;
  limit: number | null;
  slots: (string | null)[]; // index = slot number, value = /24 or null when free
  unpinned: string[];
  own: number | null;
};

const marks: [RegExp, Tone][] = [[/^✅/u, "success"], [/^⚠️?/u, "warning"], [/^❌/u, "danger"], [/^⏸️?/u, "neutral"]];

function stamp(line: string) {
  const m = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
  return m ? { time: m[1], text: m[2] } : { time: "", text: line };
}

export function parseStatus(raw: string) {
  const [head = "", ...rest] = raw.replace(/\s+$/, "").split("\n");
  let { time, text } = stamp(head);
  let tone: Tone = "neutral";
  for (const [re, t] of marks) {
    if (re.test(text)) { tone = t; text = text.replace(re, "").trim(); break; }
  }
  const detail = rest.join("\n").trim();
  const summary = /^白名单 (\d+)(?:\/(\d+))?：(.*)$/.exec(detail);
  let board: Board | null = null;
  if (summary) {
    const own = /槽位 (\d+)/.exec(text);
    const entries = [...summary[3].matchAll(/(\S+) #(\d*)/g)];
    const pinned = entries.filter((e) => e[2] !== "").map((e) => [Number(e[2]), e[1]] as const);
    const limit = summary[2] ? Number(summary[2]) : null;
    const size = Math.max(limit ?? 0, ...pinned.map(([n]) => n + 1));
    const slots: (string | null)[] = Array.from({ length: size }, () => null);
    for (const [n, ip] of pinned) slots[n] = ip;
    board = {
      used: Number(summary[1]), limit, slots, own: own ? Number(own[1]) : null,
      unpinned: entries.filter((e) => e[2] === "").map((e) => e[1]),
    };
  }
  return { time, tone, text, detail: board ? "" : detail, board };
}

export function parseLog(raw: string) {
  return raw.split("\n").filter((line) => line.trim()).map((line) => {
    const { time, text } = stamp(line);
    const source = /^([a-z][\w-]*): (.*)$/s.exec(text);
    const message = source ? source[2] : text;
    const tone: Tone = /HTTP 429|暂停|固定在其他槽位/.test(message) ? "warning"
      : /失败|无法连接|HTTP \d{3}|未启用|没有槽位|未配置|非法/.test(message) ? "danger" : "neutral";
    return { time, source: source ? source[1] : "", message, tone };
  });
}
