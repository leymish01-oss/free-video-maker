// Free Video Maker: the loader for the optional "Designer themes" pack. The pack itself (the theme data) is NOT part of
// this GPL program: it's a separate, paid content pack that leymish.com serves for preview, and exporting with one of
// its themes needs an unlock token that the server checks. Without a server (e.g. a copy of this repo), the tool runs
// with its free themes only.
// SPDX-License-Identifier: GPL-3.0-or-later

const KEY = "vm-unlock"; // the unlock tokens bought on this browser
const verified = new Set();

export function apiBase() {
  const m = document.querySelector('meta[name="vm-api"]');
  const v = m && m.content;
  return v && /^https:\/\//.test(v) ? v.replace(/\/$/, "") : null;
}
function tokens() {
  try { const t = JSON.parse(localStorage.getItem(KEY) || "[]"); return Array.isArray(t) ? t.filter((x) => typeof x === "string") : []; }
  catch (e) { return []; }
}
export function saveToken(t) {
  try { localStorage.setItem(KEY, JSON.stringify([...new Set([...tokens(), t])].slice(-20))); } catch (e) { /* private mode */ }
}
/** Theme ids the saved tokens claim (for badges only; the server decides at export time). */
export function claimedIds() {
  const ids = new Set();
  tokens().forEach((t) => {
    try { JSON.parse(atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).ids.forEach((i) => ids.add(i)); }
    catch (e) { /* not a token */ }
  });
  return ids;
}
async function post(api, path, body) {
  const r = await fetch(api + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

/** {enabled, prices, links, themes} or null when there's no server / it can't be reached. */
export async function loadPack(api) {
  if (!api) return null;
  try {
    const [cfg, data] = await Promise.all([fetch(api + "/v1/vm/config").then((r) => r.json()), fetch(api + "/v1/vm/themes").then((r) => r.json())]);
    if (!Array.isArray(data.themes)) return null;
    return { ...cfg, themes: data.themes.map((t) => ({ ...t, premium: true })) };
  } catch (e) { return null; }
}

/** May this theme be exported? Asks the server with each saved token (cached for the visit). */
export async function canExport(api, id) {
  if (verified.has(id)) return true;
  for (const t of tokens()) {
    try { if ((await post(api, "/v1/vm/verify", { token: t, theme: id })).ok) { verified.add(id); return true; } }
    catch (e) { /* try the next token */ }
  }
  return false;
}
export async function redeem(api, sessionId) {
  const j = await post(api, "/v1/vm/unlock", { session_id: sessionId });
  saveToken(j.token); verified.clear();
  return j.ids || [];
}
export async function restore(api, email) { return post(api, "/v1/vm/restore", { email }); }
