// Free Video Maker: "make a video from my link". The site's server reads the public page's product data (structured
// data, Open Graph, the shop's own product feed: no AI) and this turns it into template fields and photos. Images come
// through the server's image proxy so the canvas can use them. Without a server (a copy of this repo) the box hides.
// SPDX-License-Identifier: GPL-3.0-or-later

const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };

/** Ask the server to read a page: {ok, kind, source, title, price, images, benefits, logo, siteName, description, url}. */
export async function readPage(api, url) {
  const r = await fetch(api + "/v1/vm/from-url", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** Load an image through the proxy (CORS-clean, so the canvas can draw and export it). */
export function proxied(api, src) {
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = `${api}/v1/vm/img?u=${encodeURIComponent(src)}`;
  });
}

/** Template and field values for what the page said. */
export function fieldsFor(page) {
  const host = (() => { try { return new URL(page.url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })();
  if (page.kind === "product" && page.title) {
    const name = clip(page.title, 60);
    const short = clip(page.title.split(/[|–—:-]/)[0], 32);
    const b = (page.benefits || []).map((x) => clip(x, 48)).filter(Boolean);
    return { template: "promo", values: {
      hook: short.split(" ").length <= 5 ? `Meet *${short}*.` : `New in store: *${clip(short, 28)}*`,
      name, price: page.price || "", b1: b[0] || "Made to last", b2: b[1] || "Ships fast", b3: b[2] || "Easy returns",
      cta: "Shop now", url: host } };
  }
  const site = clip(page.siteName || page.title || host, 40);
  const lines = [...(page.benefits || [])].map((x) => clip(x, 48));
  return { template: "offer", values: {
    hook: `Say hello to *${site}*.`, what: clip(page.description || page.title || site, 60),
    d1: lines[0] || "", d2: lines[1] || "", when: "Visit us today", url: host } };
}
