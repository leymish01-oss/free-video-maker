// Build: bundle the page script and the voice worker with esbuild, and copy the page into the website.
//   node build.mjs              -> ../../site/tools/video-maker/{index.html, app.js, voice-worker.js}
// SPDX-License-Identifier: GPL-3.0-or-later
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.env.VM_OUT || join(here, "..", "..", "site", "tools", "video-maker");
mkdirSync(out, { recursive: true });
const common = { bundle: true, format: "esm", minify: true, target: ["chrome113", "safari17", "firefox130"], legalComments: "eof", logLevel: "info" };
await build({ ...common, entryPoints: [join(here, "src", "app.js")], outfile: join(out, "app.js") });
await build({ ...common, entryPoints: [join(here, "src", "voice-worker.js")], outfile: join(out, "voice-worker.js") });
// versioned URLs (?v=content hash): browsers cache scripts for a while, so a new build must change the URL
const hash = (f) => createHash("sha256").update(readFileSync(f)).digest("hex").slice(0, 10);
const appFile = join(out, "app.js");
writeFileSync(appFile, readFileSync(appFile, "utf8").replaceAll('"./voice-worker.js"', `"./voice-worker.js?v=${hash(join(out, "voice-worker.js"))}"`));
const page = readFileSync(join(here, "index.html"), "utf8").replace('src="./app.js"', `src="./app.js?v=${hash(appFile)}"`);
// landing pages (landing.json): the same tool, preset, with their own title, H1, intro and FAQ, under /tools/video-maker/<slug>/
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const landing = existsSync(join(here, "landing.json")) ? JSON.parse(readFileSync(join(here, "landing.json"), "utf8")).pages : [];
const links = (self) => landing.map((p) => (p.slug === self ? "" : `<a href="/tools/video-maker/${p.slug}/">${esc(p.h1)}</a>`)).filter(Boolean)
  .concat(self ? ['<a href="/tools/video-maker/">All templates</a>'] : []).join(" · ");
writeFileSync(join(out, "index.html"), page.replace("{{VM_LANDINGS}}", links(null)));
for (const p of landing) {
  const preset = new URLSearchParams(p.preset || {}).toString();
  const faq = `<section id="faq">\n    <h2>Questions</h2>\n${p.faq.map(([q, a]) => `    <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("\n")}\n  </section>`;
  const html = page
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(p.description)}">`)
    .replace('<meta name="vm-preset" content="">', `<meta name="vm-preset" content="${esc(preset)}">\n<base href="/tools/video-maker/">`)
    .replace("{{SITE_URL}}/tools/video-maker/\">", `{{SITE_URL}}/tools/video-maker/${p.slug}/">`)
    .replace(/<h1 id="vmh">[\s\S]*?<\/h1>/, `<h1 id="vmh">${esc(p.h1)}</h1>`)
    .replace(/<p class="lede">[\s\S]*?<\/p>/, `<p class="lede">${esc(p.intro)} <strong>Your photos and your video never leave your device.</strong></p>`)
    .replace(/<section id="faq">[\s\S]*?<\/section>/, faq)
    .replace("{{VM_LANDINGS}}", links(p.slug));
  mkdirSync(join(out, p.slug), { recursive: true });
  writeFileSync(join(out, p.slug, "index.html"), html);
}
// the theme fonts: self-hosted Latin woff2 files from @fontsource (OFL), with their licences
const { FONT_FILES } = await import("./src/themes.js");
mkdirSync(join(out, "fonts"), { recursive: true });
for (const [, file] of FONT_FILES) {
  const pkg = file.replace(/-latin-\d+-normal\.woff2$/, "");
  copyFileSync(join(here, "node_modules", "@fontsource", pkg, "files", file), join(out, "fonts", file));
  copyFileSync(join(here, "node_modules", "@fontsource", pkg, "LICENSE"), join(out, "fonts", `${pkg}-OFL.txt`));
}
console.log(`built -> ${out}`);
