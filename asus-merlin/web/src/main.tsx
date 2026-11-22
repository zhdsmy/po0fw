import { createRoot } from "react-dom/client";
import { KumoPortalProvider } from "@cloudflare/kumo/utils";
import { App } from "./App";

const host = document.getElementById("po0fw-app")!;
const shadow = host.attachShadow({ mode: "open" });
const stylesheet = document.createElement("link");
stylesheet.rel = "stylesheet";
stylesheet.href = "/res/po0fw-app.css";

const theme = document.createElement("div");
theme.dataset.theme = "kumo";
theme.dataset.mode = "dark";
const root = document.createElement("div");
const overlays = document.createElement("div");
theme.append(root, overlays);

// Render only after the local stylesheet is ready to avoid flashing unstyled controls.
stylesheet.addEventListener("load", () => {
  createRoot(root).render(
    <KumoPortalProvider container={overlays}>
      <App />
    </KumoPortalProvider>,
  );
});
stylesheet.addEventListener("error", () => {
  root.textContent = "po0fw 页面样式加载失败，请刷新重试。";
});
shadow.append(stylesheet, theme);
