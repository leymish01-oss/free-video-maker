// Build: bundle the page script and the voice worker with esbuild, and copy the page into the website.
//   node build.mjs              -> ../../site/tools/video-maker/{index.html, app.js, voice-worker.js}
// SPDX-License-Identifier: GPL-3.0-or-later
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.VM_OUT || join(here, "..", "..", "site", "tools", "video-maker");
mkdirSync(out, { recursive: true });
const common = { bundle: true, format: "esm", minify: true, target: ["chrome113", "safari17", "firefox130"], legalComments: "eof", logLevel: "info" };
await build({ ...common, entryPoints: [join(here, "src", "app.js")], outfile: join(out, "app.js") });
await build({ ...common, entryPoints: [join(here, "src", "voice-worker.js")], outfile: join(out, "voice-worker.js") });
copyFileSync(join(here, "index.html"), join(out, "index.html"));
// the theme fonts: self-hosted Latin woff2 files from @fontsource (OFL), with their licences
const { FONT_FILES } = await import("./src/themes.js");
mkdirSync(join(out, "fonts"), { recursive: true });
for (const [, file] of FONT_FILES) {
  const pkg = file.replace(/-latin-\d+-normal\.woff2$/, "");
  copyFileSync(join(here, "node_modules", "@fontsource", pkg, "files", file), join(out, "fonts", file));
  copyFileSync(join(here, "node_modules", "@fontsource", pkg, "LICENSE"), join(out, "fonts", `${pkg}-OFL.txt`));
}
console.log(`built -> ${out}`);
