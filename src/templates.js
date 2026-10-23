// Free Video Maker: templates. Each turns the form's fields into scenes; `line` is what the caption shows and `say`
// (when different, e.g. "yourstore dot com") is what the voice says; `dur` is the default length, replaced by the voice clip's length (+ a little air) when there is one.
// SPDX-License-Identifier: GPL-3.0-or-later

export const TEMPLATES = {
  promo: {
    name: "Product promo",
    blurb: "For shop owners: a product, its price, three reasons to buy and where to get it.",
    fields: [
      { id: "hook", label: "Opening line (the hook)", value: "Meet the *candle* that smells like summer." },
      { id: "name", label: "Product name", value: "Summer Garden Soy Candle" },
      { id: "price", label: "Price", value: "$29" },
      { id: "b1", label: "Benefit 1", value: "Hand-poured soy wax" },
      { id: "b2", label: "Benefit 2", value: "50-hour clean burn" },
      { id: "b3", label: "Benefit 3", value: "Ships free over $60" },
      { id: "cta", label: "Call to action", value: "Shop now" },
      { id: "url", label: "Where to buy (web address or @handle)", value: "yourstore.com" },
    ],
    photos: 3,
    build: (f) => [
      { type: "hook", headline: f.hook, line: plain(f.hook), dur: 2.4 },
      { type: "product", headline: f.name, price: f.price, photo: 0, line: `${plain(f.name)}. ${plain(f.price)}`,
        say: `${plain(f.name)}. ${spokenPrice(f.price)}`, dur: 3.6 },
      { type: "points", kicker: "Why you'll love it", items: [f.b1, f.b2, f.b3],
        line: [f.b1, f.b2, f.b3].filter(Boolean).map(plain).join(". ") + ".", dur: 5 },
      ...(f._photos > 1 ? [{ type: "photo", headline: f.name, photo: 1, line: "", dur: 2.2 }] : []),
      { type: "cta", headline: `*${f.cta}*`, button: f.url, line: `${plain(f.cta)} at ${plain(f.url)}.`,
        say: `${plain(f.cta)} at ${spokenUrl(f.url)}.`, dur: 3.2 },
    ],
  },
  tip: {
    name: "Tip / explainer",
    blurb: "A hook, three points and a call to action. Good for how-tos.",
    fields: [
      { id: "hook", label: "Opening line (the hook)", value: "Three ways to get more *Google reviews*." },
      { id: "p1", label: "Point 1", value: "Ask at the moment they're happiest" },
      { id: "p2", label: "Point 2", value: "Send a direct link, not instructions" },
      { id: "p3", label: "Point 3", value: "Reply to every review, good or bad" },
      { id: "cta", label: "Call to action", value: "Follow for more tips" },
      { id: "url", label: "Your web address or @handle", value: "@yourbusiness" },
    ],
    photos: 0,
    build: (f) => [
      { type: "hook", headline: f.hook, line: plain(f.hook), dur: 2.4 },
      { type: "title", kicker: "Tip 1", headline: f.p1, line: plain(f.p1) + ".", dur: 3 },
      { type: "title", kicker: "Tip 2", headline: f.p2, line: plain(f.p2) + ".", dur: 3 },
      { type: "title", kicker: "Tip 3", headline: f.p3, line: plain(f.p3) + ".", dur: 3 },
      { type: "cta", headline: `*${f.cta}*`, button: f.url, line: plain(f.cta) + ".", dur: 3 },
    ],
  },
  offer: {
    name: "Announcement / offer",
    blurb: "A sale, a launch or news: what's happening, the details and the deadline.",
    fields: [
      { id: "hook", label: "Opening line (the hook)", value: "Our *spring sale* starts today." },
      { id: "what", label: "The offer", value: "20% off everything in store" },
      { id: "d1", label: "Detail 1", value: "Online and in store" },
      { id: "d2", label: "Detail 2", value: "No code needed" },
      { id: "when", label: "Deadline", value: "Ends Sunday" },
      { id: "url", label: "Web address or @handle", value: "yourstore.com" },
    ],
    photos: 1,
    build: (f) => [
      { type: "hook", headline: f.hook, line: plain(f.hook), dur: 2.4 },
      f._photos ? { type: "photo", headline: f.what, photo: 0, line: plain(f.what) + ".", dur: 3.2 }
        : { type: "title", headline: f.what, line: plain(f.what) + ".", dur: 3.2 },
      { type: "points", kicker: "The details", items: [f.d1, f.d2], line: [f.d1, f.d2].filter(Boolean).map(plain).join(". ") + ".", dur: 3.6 },
      { type: "cta", headline: `*${f.when}*`, button: f.url, line: `${plain(f.when)}. ${plain(f.url)}`,
        say: `${plain(f.when)}. ${spokenUrl(f.url)}.`, dur: 3 },
    ],
  },
  blackfriday: { // seasonal (P-063): Black Friday / Cyber Monday
    name: "Black Friday sale",
    blurb: "The discount, what it covers, the code and the deadline. Looks best with Holiday Glow, Bold Brand or Midnight Neon.",
    fields: [
      { id: "hook", label: "Opening line (the hook)", value: "*Black Friday* is here." },
      { id: "pct", label: "The discount", value: "40% off" },
      { id: "what", label: "What it covers", value: "Every product, sitewide" },
      { id: "code", label: "Code or detail (optional)", value: "Use code BF40 at checkout" },
      { id: "until", label: "Countdown line", value: "Ends Monday at midnight" },
      { id: "cta", label: "Call to action", value: "Shop the sale" },
      { id: "url", label: "Web address or @handle", value: "yourstore.com" },
    ],
    photos: 1,
    build: (f) => [
      { type: "hook", kicker: "Black Friday", headline: f.hook, line: plain(f.hook), dur: 2.2 },
      { type: "title", kicker: plain(f.what), headline: `*${plain(f.pct)}*`, size: 2.1, line: `${plain(f.pct)}. ${plain(f.what)}.`,
        say: `${spokenPercent(f.pct)}. ${plain(f.what)}.`, dur: 3 },
      ...(f._photos ? [{ type: "photo", headline: `*${plain(f.pct)}*`, photo: 0, line: "", dur: 2.2 }] : []),
      ...(plain(f.code) ? [{ type: "title", kicker: "How", headline: f.code, line: plain(f.code) + ".", dur: 2.8 }] : []),
      { type: "title", kicker: "Hurry", headline: `*${plain(f.until)}*`, size: 1.15, line: plain(f.until) + ".", dur: 2.6 },
      { type: "cta", headline: `*${f.cta}*`, button: f.url, line: `${plain(f.cta)} at ${plain(f.url)}.`,
        say: `${plain(f.cta)} at ${spokenUrl(f.url)}.`, dur: 3 },
    ],
  },
  giftguide: { // seasonal (P-063): a Christmas gift guide with three products
    name: "Christmas gift guide",
    blurb: "Three gift picks with prices, and the last order date for Christmas delivery.",
    fields: [
      { id: "hook", label: "Opening line (the hook)", value: "Our Christmas *gift guide*: 3 picks they'll love." },
      { id: "g1", label: "Gift 1", value: "Summer Garden Soy Candle" }, { id: "p1", label: "Gift 1 price", value: "$29" },
      { id: "g2", label: "Gift 2", value: "Linen Tea Towel Set" }, { id: "p2", label: "Gift 2 price", value: "$34" },
      { id: "g3", label: "Gift 3", value: "Ceramic Pour-Over Mug" }, { id: "p3", label: "Gift 3 price", value: "$42" },
      { id: "cta", label: "Deadline / call to action", value: "Order by Dec 18 for Christmas delivery" },
      { id: "url", label: "Web address or @handle", value: "yourstore.com" },
    ],
    photos: 3,
    build: (f) => [
      { type: "hook", kicker: "Gift guide", headline: f.hook, line: plain(f.hook), dur: 2.4 },
      ...[1, 2, 3].map((n) => ({ type: "product", headline: f[`g${n}`], price: f[`p${n}`], photo: n - 1,
        line: `${plain(f[`g${n}`])}. ${plain(f[`p${n}`])}`, say: `${plain(f[`g${n}`])}. ${spokenPrice(f[`p${n}`])}`, dur: 3 })),
      { type: "cta", headline: `*${f.cta}*`, button: f.url, line: `${plain(f.cta)}. ${plain(f.url)}`,
        say: `${plain(f.cta)}. ${spokenUrl(f.url)}.`, dur: 3.4 },
    ],
  },
};

/** "40% off" -> "40 percent off" for the voice. */
export function spokenPercent(p) { return plain(p).replace(/(\d+)\s*%/g, "$1 percent"); }

export const ENDCARD = { type: "endcard", headline: "Made free at *leymish.com*", small: "No sign-up. Made on your device.", line: "", dur: 2.2 };

export function plain(s) { return String(s || "").replace(/\*/g, "").trim(); }

/** "$29" -> "Twenty-nine dollars" is overkill; "$29" -> "29 dollars" reads naturally for every TTS voice. */
export function spokenPrice(p) {
  const m = String(p || "").match(/^\s*([$£€])\s*([\d.,]+)\s*$/);
  if (!m) return plain(p);
  const unit = { $: "dollars", "£": "pounds", "€": "euros" }[m[1]];
  return `${m[2]} ${unit}`;
}

/** "yourstore.com" -> "yourstore dot com"; "@handle" -> "at handle". */
export function spokenUrl(u) {
  const s = plain(u).replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (s.startsWith("@")) return "at " + s.slice(1);
  return s.replace(/\./g, " dot ");
}

/** Scenes for a template and form values; the end card is appended when wanted. */
export function buildScenes(key, values, { endcard = true, photos = 0 } = {}) {
  const t = TEMPLATES[key];
  const f = { ...Object.fromEntries(t.fields.map((x) => [x.id, x.value])), ...values, _photos: photos };
  const scenes = t.build(f).filter(Boolean);
  return endcard ? [...scenes, { ...ENDCARD }] : scenes;
}
