import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GlobeSimpleIcon } from "@phosphor-icons/react/dist/csr/GlobeSimple";
import { HouseLineIcon } from "@phosphor-icons/react/dist/csr/HouseLine";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { emptyOutput, execute, readOutput, readSettings } from "./api";
import { defaults, fieldsFor, type Action, type Settings } from "./settings";
import { parseLog, parseStatus, type Board, type Tone } from "./status";

declare global {
  interface Window { reload_Soft_Center(): void }
}

const slots = Array.from({ length: 10 }, (_, n) => ({ value: String(n), label: String(n) }));
const intervals = [1, 2, 5, 10, 15, 30].map((n) => ({ value: String(n), label: `${n} 分钟` }));
const channels = { off: "关闭", bark: "Bark", telegram: "Telegram" };
const dots: Record<Tone, string> = {
  success: "bg-kumo-success", warning: "bg-kumo-warning", danger: "bg-kumo-danger", neutral: "bg-kumo-interact",
};
const texts: Record<Tone, string> = {
  success: "", warning: "text-kumo-warning", danger: "text-kumo-danger", neutral: "",
};

type SettingInputProps = {
  id: string; label: string; value: string; placeholder: string; description?: string;
  secret?: boolean; onChange: (value: string) => void;
};

function SettingInput({ id, label, value, placeholder, description, secret, onChange }: SettingInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex min-w-0 items-end gap-2">
      <div className="min-w-0 flex-1">
        <Input id={id} label={label} value={value} placeholder={placeholder} description={description}
          type={secret && !visible ? "password" : "text"} autoComplete="off"
          autoCapitalize="none" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      </div>
      {secret && <Button variant="secondary" aria-controls={id} aria-pressed={visible}
        onClick={() => setVisible(!visible)}>{visible ? "隐藏" : "显示"}</Button>}
    </div>
  );
}

function SectionHead({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <h2 id={id} className="text-base font-semibold text-kumo-strong">{title}</h2>
      {children}
    </div>
  );
}

// A bay is always there; a cartridge sits in it when the slot holds a /24.
// House marks this router's home egress; a globe marks a /24 pinned by something else.
function Slot({ n, ip, own }: { n: number; ip: string | null; own: boolean }) {
  const Icon = own ? HouseLineIcon : GlobeSimpleIcon;
  return (
    <li className="flex rounded-xl border border-kumo-hairline bg-kumo-canvas p-0.5 shadow-[inset_0_2px_6px_var(--color-kumo-shadow-drop)]">
      {ip ? (
        <div key={ip} style={{ animationDelay: `${n * 60}ms` } as CSSProperties}
          className={`@container flex min-h-20 w-full flex-col justify-between gap-2 rounded-lg border bg-kumo-fill px-2 py-2 text-kumo-strong shadow-[0_1px_0_var(--color-kumo-shadow-edge)_inset] motion-safe:animate-[slot-in_360ms_cubic-bezier(.2,.8,.2,1)_both] ${own
            ? "border-kumo-brand ring-1 ring-kumo-brand" : "border-kumo-interact"}`}>
          <span className="flex flex-wrap items-center justify-between gap-1 text-xs text-kumo-subtle">
            <span className="tabular-nums">#{n}</span>
            <span className={`inline-flex items-center gap-1 whitespace-nowrap ${own ? "font-medium text-kumo-link" : ""}`}>
              <Icon size={16} weight={own ? "fill" : "regular"} aria-hidden />{own && "本路由器"}
            </span>
          </span>
          {/* One line always: the size follows the card width so 255.255.255.0/24 still fits. */}
          <span className="whitespace-nowrap text-[length:min(1rem,11cqi)] leading-tight font-semibold tabular-nums">{ip}</span>
        </div>
      ) : (
        <div className="flex min-h-20 w-full flex-col justify-between rounded-lg border border-dashed border-kumo-line px-2 py-2 text-xs text-kumo-inactive">
          <span className="tabular-nums">#{n}</span>
          <span>空闲</span>
        </div>
      )}
    </li>
  );
}

function SlotBoard({ board }: { board: Board }) {
  // Balanced rows of at most five bays: 8 slots -> 4 + 4, 12 -> 4 + 4 + 4.
  const n = board.slots.length;
  return (
    <div className="grid gap-2">
      <ol aria-label="白名单槽位" style={{ "--cols": Math.ceil(n / Math.ceil(n / 5)) } as CSSProperties}
        className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2 @2xl:grid-cols-[repeat(var(--cols),minmax(0,1fr))]">
        {board.slots.map((ip, n) => <Slot key={n} n={n} ip={ip} own={n === board.own} />)}
      </ol>
      <p className="text-sm text-kumo-subtle">
        白名单已用 {board.used}{board.limit ? `/${board.limit}` : ""}
        {board.unpinned.length > 0 && `，未固定槽位：${board.unpinned.join("、")}`}
      </p>
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState(defaults);
  const [loaded, setLoaded] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState<{ action: Action; text: string } | null>(null);
  const [running, setRunning] = useState<Action | null>(null);
  const [output, setOutput] = useState(emptyOutput);
  const logBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      readSettings().then((s) => { setSettings(s); setLoaded(true); }).catch(() => setLoadError(true)),
      readOutput(emptyOutput).then(setOutput),
    ]).finally(() => setInitializing(false));
  }, []);
  useLayoutEffect(() => {
    if (logBox.current) logBox.current.scrollTop = logBox.current.scrollHeight;
  }, [output]);

  function change(key: keyof Settings, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
    setError(null);
  }

  async function run(action: Action) {
    if (running !== null || initializing) return;
    setError(null);
    try {
      const fields = fieldsFor(action, settings);
      setRunning(action);
      await execute(action, fields, output, setOutput);
    } catch (e) {
      setError({ action, text: e instanceof Error ? e.message : "请求失败，请重试。" });
    } finally {
      setRunning(null);
    }
  }

  function input(key: keyof Settings, label: string, placeholder: string, secret = false, description?: string) {
    return <SettingInput key={key} id={key} label={label} placeholder={placeholder} secret={secret}
      description={description} value={settings[key]} onChange={(v) => change(key, v)} />;
  }
  function select(key: keyof Settings, label: string, items: typeof slots | typeof channels, description: string) {
    return <Select<string> modal={false} id={key} label={label} description={description} className="w-full"
      value={settings[key]} items={items} onValueChange={(v) => { if (v !== null) change(key, v); }} />;
  }
  function action(id: Action, label: string, variant: "primary" | "secondary" | "ghost" = "secondary", size?: "sm") {
    return <Button variant={variant} size={size} disabled={initializing || running !== null || (!loaded && (id === 1 || id === 4))}
      loading={running === id} aria-busy={running === id} aria-label={label} onClick={() => run(id)}>{label}</Button>;
  }
  function errorFor(id: Action) {
    return error?.action === id && <Banner variant="error" role="alert" title={error.text} />;
  }

  const status = output.statusAvailable && output.status ? parseStatus(output.status) : null;
  const log = parseLog(output.log);

  return (
    <main className="@container rounded-xl border border-kumo-line bg-kumo-base text-kumo-default">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-6 py-5">
        <div className="flex min-w-0 items-start gap-3">
          <img src="/res/icon-po0fw.png" width="44" height="44" alt="" className="shrink-0" />
          <div className="grid gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-kumo-strong">po0 防火墙加白</h1>
              {settings.po0fw_version && <Badge variant="outline">{settings.po0fw_version}</Badge>}
            </div>
            <p className="text-sm text-kumo-subtle">把路由器公网出口所在的 /24 写进 po0 防火墙白名单的固定槽位。</p>
          </div>
        </div>
        <Button variant="secondary" onClick={() => window.reload_Soft_Center()}>返回软件中心</Button>
      </header>

      <section aria-label="运行状态" className="grid gap-4 border-b border-kumo-line px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid min-w-0 gap-0.5">
            <p className="flex items-start gap-2 text-base font-semibold text-kumo-strong">
              <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${dots[status?.tone ?? "neutral"]}`} />
              <span className="min-w-0 [overflow-wrap:anywhere]">{status?.text || "尚未运行"}</span>
            </p>
            <p className="pl-4 text-sm text-kumo-subtle">
              {status ? status.time && <>检查于 <time className="tabular-nums">{status.time}</time></>
                : "启用并保存设置后，路由器会把出口网段写进固定槽位。"}
            </p>
          </div>
          {action(2, "立即更新")}
        </div>
        {errorFor(2)}
        {status?.board && <SlotBoard board={status.board} />}
        {status?.detail && <p className="whitespace-pre-wrap break-all rounded-lg bg-kumo-recessed px-3 py-2 text-sm text-kumo-subtle">{status.detail}</p>}
      </section>

      <section aria-labelledby="po0fw-whitelist" className="grid gap-4 border-b border-kumo-line px-6 py-5">
        <SectionHead id="po0fw-whitelist" title="加白">
          <Switch label="启用" controlFirst={false} checked={settings.po0fw_enable === "1"} disabled={!loaded}
            onCheckedChange={(checked) => change("po0fw_enable", checked ? "1" : "0")} />
        </SectionHead>
        {loadError && <Banner variant="error" role="alert" title="设置读取失败，请刷新页面重试。" />}
        <fieldset disabled={!loaded} className="grid min-w-0 gap-4">
          {input("po0fw_token", "API token", "pgnfw_...", true)}
          <div className="grid gap-4 @lg:grid-cols-2">
            {select("po0fw_slot", "固定槽位", slots, "换 IP 时只替换这个槽位")}
            {select("po0fw_interval", "检查间隔", intervals, "每次拨号成功也会立即更新")}
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="po0fw-notify" className="grid gap-4 border-b border-kumo-line px-6 py-5">
        <SectionHead id="po0fw-notify" title="通知">{action(4, "测试通知")}</SectionHead>
        <fieldset disabled={!loaded} className="grid min-w-0 gap-4">
          {select("po0fw_notify", "通知渠道", channels, "网段变化、连续失败 3 次、失败后恢复时各通知一次")}
          {settings.po0fw_notify === "bark" && input("po0fw_bark_url", "Bark 地址", "https://api.day.app/你的key", true)}
          {settings.po0fw_notify === "telegram" && <>
            {input("po0fw_tg_token", "Telegram Bot Token", "123456789:ABC...", true)}
            {input("po0fw_tg_chat", "Telegram Chat ID", "数字 ID，群组以 - 开头；或 @频道名")}
            {input("po0fw_tg_api", "Telegram API 地址", "留空用 https://api.telegram.org，可填自建中转")}
          </>}
          {settings.po0fw_notify !== "off" && input("po0fw_proxy", "通知代理",
            "留空直连；如 http://192.0.2.2:7890 或 socks5h://192.0.2.2:7891", false, "只用于发通知，加白请求始终直连")}
        </fieldset>
        {errorFor(4)}
      </section>

      <div className="grid gap-3 border-b border-kumo-line px-6 py-4">
        {errorFor(1)}
        <div>{action(1, "保存并应用", "primary")}</div>
      </div>

      <section aria-labelledby="po0fw-log" className="grid gap-3 px-6 py-5">
        <SectionHead id="po0fw-log" title="日志">{action(3, "清空日志", "ghost", "sm")}</SectionHead>
        {errorFor(3)}
        <div ref={logBox} role="log" aria-labelledby="po0fw-log" tabIndex={0}
          className="max-h-60 overflow-y-auto rounded-lg border border-kumo-line bg-kumo-recessed py-2 text-sm">
          {log.length ? <ol>{log.map((line, i) => (
            <li key={i} className="grid gap-x-3 px-3 py-0.5 @md:grid-cols-[auto_minmax(0,1fr)]">
              <time title={line.time} className="text-kumo-subtle tabular-nums">{line.time.replace(/^\d{4}-/, "")}</time>
              <span className={`[overflow-wrap:anywhere] ${texts[line.tone]}`}>
                {line.source && <span className="text-kumo-subtle">{line.source} </span>}{line.message}
              </span>
            </li>
          ))}</ol> : <p className="px-3 py-1 text-kumo-subtle">暂无日志</p>}
        </div>
      </section>
    </main>
  );
}
