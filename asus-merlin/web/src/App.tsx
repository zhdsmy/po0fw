import { useState } from "react";
import { Button } from "@cloudflare/kumo/components/button";
import { Input } from "@cloudflare/kumo/components/input";
import { Select } from "@cloudflare/kumo/components/select";

declare global {
  interface Window {
    reload_Soft_Center(): void;
  }
}

const intervals = [1, 2, 5, 10, 15, 30].map((minutes) => ({
  value: String(minutes),
  label: `${minutes} 分钟`,
}));

export function App() {
  const [visible, setVisible] = useState(false);
  return (
    <main className="rounded-xl border border-kumo-line bg-kumo-base text-kumo-default">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-kumo-line p-6">
        <div className="flex items-center gap-3">
          <img src="/res/icon-po0fw.png" width="44" height="44" alt="" />
          <h1 className="text-xl font-semibold text-kumo-strong">po0 防火墙加白</h1>
        </div>
        <Button variant="secondary" onClick={() => window.reload_Soft_Center()}>返回软件中心</Button>
      </header>
      <div className="grid gap-5 p-6">
        <p className="text-base text-kumo-subtle">
          把路由器当前公网出口所在的 /24 写入 po0 防火墙白名单的固定槽位，换 IP 时只替换这个槽位。
        </p>
        <div className="grid items-end gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input label="API token" id="po0fw_token" type={visible ? "text" : "password"}
                placeholder="pgnfw_..." autoComplete="off" autoCapitalize="none" spellCheck={false} />
            </div>
            <Button variant="secondary" aria-controls="po0fw_token" aria-pressed={visible}
              onClick={() => setVisible(!visible)}>{visible ? "隐藏" : "显示"}</Button>
          </div>
          <Select modal={false} label="检查间隔" defaultValue="5" items={intervals} className="w-full" />
        </div>
      </div>
    </main>
  );
}
