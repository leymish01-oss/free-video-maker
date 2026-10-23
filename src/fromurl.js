// Free Video Maker: "make a video from my link". The site's server reads the public page's product data (structured
// data, Open Graph, the shop's own product feed: no AI); this turns it into shared data (name, price, points, photos…)
// that every video type can use. Images come through the server's image proxy so the canvas can use them. Without a
// server (a copy of this repo) the link step says so and you type your details.
// SPDX-License-Identifier: GPL-3.0-or-later

export const clip = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : s; };
const SESSION = Math.random().toString(36).slice(2, 12) + Date.now().toString(36); // one per page visit (the server allows 10 a visit)

/** Ask the server to read a page: {ok, kind, source, title, price, images, benefits, logo, siteName, description, url}. */
export async function readPage(api, url) {
  const r = await fetch(api + "/v1/vm/from-url", { method: "POST", headers: { "Content-Type": "application/json", "X-VM-Session": SESSION },
    body: JSON.stringify({ url }) });
  const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (!r.ok || !j.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.code = j.code || String(r.status); throw e; }
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

/** What a page gives every video type, keyed like the page's shared fields. */
export function dataFrom(page) {
  const host = (() => { try { return new URL(page.url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } })();
  const d = { url: host };
  if (page.kind === "product" && page.title) {
    d.name = clip(page.title, 60);
    if (page.price) d.price = page.price;
  } else {
    d.site = clip(page.siteName || page.title || host, 40);
    if (page.description) d.what = clip(page.description, 60);
  }
  (page.benefits || []).slice(0, 3).forEach((b, i) => { d[`point.${i}`] = clip(b, 48); });
  return d;
}
