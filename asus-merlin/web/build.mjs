import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { build, transform } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

process.chdir(import.meta.dirname);
const script = await build({
  entryPoints: ["src/main.tsx"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "inline",
  metafile: true,
  write: false,
});

// Restrict Tailwind's scanner to the Kumo modules that actually ship.
const shippedModules = Object.values(script.metafile.outputs)[0].inputs;
const sources = Object.entries(shippedModules)
  .filter(([path, item]) => path.startsWith("node_modules/@cloudflare/kumo/") && item.bytesInOutput > 0)
  .map(([path]) => `@source "${relative("src", path)}";`);
const from = resolve("src/styles.css");
const source = [await readFile(from, "utf8"), ...sources].join("\n");
const css = await postcss([tailwind({ optimize: false })]).process(source, { from });

// Browsers ignore @property inside a shadow tree. Supply each non-inherited
// Tailwind variable's own initial value at the lowest cascade layer instead.
const defaults = postcss.rule({ selector: "*,::before,::after,::backdrop" });
css.root.walkAtRules("property", (rule) => {
  const initial = rule.nodes.find((node) => node.prop === "initial-value");
  if (rule.params.startsWith("--tw-")) {
    defaults.append({ prop: rule.params, value: initial?.value ?? "initial" });
    rule.remove();
  }
});
const layer = postcss.atRule({ name: "layer", params: "properties" });
layer.append(defaults);
css.root.prepend(layer);
const styles = await transform(css.root.toString(), { loader: "css", minify: true, legalComments: "inline" });

const assets = [
  { extension: "js", data: script.outputFiles[0].contents, limit: 600_000 },
  { extension: "css", data: Buffer.from(styles.code), limit: 120_000 },
];
for (const { extension, data, limit } of assets) {
  console.log(`po0fw-app.${extension}: ${data.length} bytes (gzip ${gzipSync(data).length})`);
  if (data.length > limit) throw new Error(`po0fw-app.${extension} exceeds ${limit} bytes`);
}
for (const { extension, data } of assets) {
  await writeFile(`../po0fw/res/po0fw-app.${extension}`, data);
}

// A CSS-only rebuild must also invalidate the URL of the script that links it.
const hash = createHash("sha256");
for (const asset of assets) hash.update(asset.data);
const revision = hash.digest("hex").slice(0, 20);
const template = await readFile("../po0fw/webs/Module_po0fw.asp", "utf8");
if (!template.includes("__PO0FW_ASSETS__")) throw new Error("Missing asset revision in ASP template");
await mkdir("dist", { recursive: true });
await writeFile("dist/Module_po0fw.asp", template.replace("__PO0FW_ASSETS__", revision));

console.log("Largest JS inputs (bytes in output):");
for (const [path, input] of Object.entries(shippedModules).sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput).slice(0, 5)) {
  console.log(`${input.bytesInOutput}  ${path}`);
}
