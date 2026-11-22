import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@cloudflare/kumo/components/badge";
import { Banner } from "@cloudflare/kumo/components/banner";
import { Button } from "@cloudflare/kumo/components/button";
import { Input, Textarea } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";
import { Switch } from "@cloudflare/kumo/components/switch";
import { emptyOutput, execute, readOutput, readSettings } from "./api";
import { defaults, fieldsFor, type Action, type Settings } from "./settings";

declare global {
  interface Window { reload_Soft_Center(): void }
}

const slots = Array.from({ length: 10 }, (_, n) => ({ value: String(n), label: String(n) }));
const intervals = [1, 2, 5, 10, 15, 30].map((n) => ({ value: String(n), label: `${n} 分钟` }));
const channels = { off: "关闭", bark: "Bark", telegram: "Telegram" };
const actions = [
  [1, "保存并应用"], [2, "立即更新"], [4, "测试通知"], [3, "清空日志"],
] as const;

type SettingInputProps = {
  id: string; label: string; value: string; placeholder: string;
  secret?: boolean; onChange: (value: string) => void;
};

function SettingInput({ id, label, value, placeholder, secret, onChange }: SettingInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex min-w-0 items-end gap-2">
      <div className="min-w-0 flex-1">
        <Input id={id} label={label} value={value} placeholder={placeholder}
          type={secret && !visible ? "password" : "text"} autoComplete="off"
          autoCapitalize="none" spellCheck={false} onChange={(e) => onChange(e.target.value)} />
      </div>
      {secret && <Button variant="secondary" aria-controls={id} aria-pressed={visible}
        onClick={() => setVisible(!visible)}>{visible ? "隐藏" : "显示"}</Button>}
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState(defaults);
  const [loaded, setLoaded] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [running, setRunning] = useState<Action | null>(null);
  const [output, setOutput] = useState(emptyOutput);
  const logArea = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    Promise.all([
      readSettings().then((s) => { setSettings(s); setLoaded(true); }).catch(() => setLoadError(true)),
      readOutput(emptyOutput).then(setOutput),
    ]).finally(() => setInitializing(false));
  }, []);
  useLayoutEffect(() => {
    if (logArea.current) logArea.current.scrollTop = logArea.current.scrollHeight;
  }, [output]);

  function change(key: keyof Settings, value: string) {
    setSettings((s) => ({ ...s, [key]: value }));
    setError("");
  }

  async function run(action: Action) {
    if (running !== null || initializing) return;
    setError("");
    try {
      const fields = fieldsFor(action, settings);
      setRunning(action);
      await execute(action, fields, output, setOutput);
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败，请重试。");
    } finally {
      setRunning(null);
    }
  }

  function input(key: keyof Settings, label: string, placeholder: string, secret = false) {
    return <SettingInput key={key} id={key} label={label} placeholder={placeholder} secret={secret}
      value={settings[key]} onChange={(v) => change(key, v)} />;
  }
  function select(key: keyof Settings, label: string, items: typeof slots | typeof channels) {
    return <Select<string> modal={false} id={key} label={label} className="w-full"
      value={settings[key]} items={items} onValueChange={(v) => { if (v !== null) change(key, v); }} />;
  }

  return (
    <main className="rounded-xl border border-kumo-line bg-kumo-base text-kumo-default">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-kumo-line px-6 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <img src="/res/icon-po0fw.png" width="44" height="44" alt="" />
          <h1 className="text-xl font-semibold text-kumo-strong">po0 防火墙加白</h1>
          {settings.po0fw_version && <Badge variant="outline">当前版本：{settings.po0fw_version}</Badge>}
        </div>
        <Button variant="secondary" onClick={() => window.reload_Soft_Center()}>返回软件中心</Button>
      </header>
      <ol className="grid list-decimal border-b border-kumo-line gap-1 py-4 pr-6 pl-10 text-sm leading-relaxed text-kumo-subtle">
        <li>把路由器当前公网出口所在的 /24 写入 po0 防火墙白名单的固定槽位，换 IP 时只替换这个槽位。</li>
        <li>每次拨号成功（wan-start）立即更新，另按下面的间隔定时检查。</li>
        <li>通知（Bark 或 Telegram）：槽位网段变化时、连续失败 3 次时、失败后恢复时各发一次。代理只用于通知，加白请求始终直连。</li>
      </ol>

      <section className="grid gap-4 border-b border-kumo-line p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">加白设置</h2>
          <Switch label="启用" controlFirst={false} checked={settings.po0fw_enable === "1"} disabled={!loaded}
            onCheckedChange={(checked) => change("po0fw_enable", checked ? "1" : "0")} />
        </div>
        {loadError && <Banner variant="error" role="alert" title="设置读取失败，请刷新页面重试。" />}
        <fieldset disabled={!loaded} className="grid min-w-0 gap-4">
          {input("po0fw_token", "API token", "pgnfw_...", true)}
          <div className="grid gap-4 sm:grid-cols-3">
            {select("po0fw_slot", "固定槽位", slots)}
            {select("po0fw_interval", "检查间隔", intervals)}
            {select("po0fw_notify", "通知渠道", channels)}
          </div>
          {settings.po0fw_notify === "bark" && input("po0fw_bark_url", "Bark 地址", "https://api.day.app/你的key", true)}
          {settings.po0fw_notify === "telegram" && <>
            {input("po0fw_tg_token", "Telegram Bot Token", "123456789:ABC...", true)}
            {input("po0fw_tg_chat", "Telegram Chat ID", "数字 ID，群组以 - 开头；或 @频道名")}
            {input("po0fw_tg_api", "Telegram API 地址", "留空用 https://api.telegram.org，可填自建中转")}
          </>}
          {settings.po0fw_notify !== "off" && input("po0fw_proxy", "通知代理",
            "留空直连；如 http://192.0.2.2:7890 或 socks5h://192.0.2.2:7891")}
        </fieldset>
        {error && <Banner variant="error" role="alert" title={error} />}
        <div className="flex flex-wrap gap-2">
          {actions.map(([id, label]) => <Button key={id} variant={id === 1 ? "primary" : "secondary"}
            disabled={initializing || running !== null || (!loaded && (id === 1 || id === 4))}
            loading={running === id} onClick={() => run(id)}>{label}</Button>)}
        </div>
      </section>

      <section className="grid gap-3 border-b border-kumo-line px-6 py-4">
        <h2 className="text-lg font-semibold">运行状态</h2>
        <Banner variant="secondary" description={<span className="whitespace-pre-wrap break-all">{(output.statusAvailable && output.status) || "尚未运行"}</span>} />
        <Textarea label="日志" ref={logArea} readOnly rows={4} value={output.log}
          spellCheck={false} className="w-full font-mono text-sm" />
      </section>
    </main>
  );
}
