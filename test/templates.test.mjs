// The Black Friday "was → now" price (P-067): only from the user's own price and discount, never invented.
// node --test test/
// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from "node:test";
import assert from "node:assert/strict";
import { wasNow, buildScenes } from "../src/templates.js";

test("was → now from a real price and a real discount", () => {
  assert.deepEqual(wasNow("$38", "30% off"), { was: "$38", price: "$26.60" });
  assert.deepEqual(wasNow("$40", "25%"), { was: "$40", price: "$30" });
  assert.deepEqual(wasNow("$98.00", "30% off"), { was: "$98.00", price: "$68.60" });
  assert.deepEqual(wasNow("45 €", "20 % off"), { was: "45 €", price: "36 €" });
});

test("no price, no discount, or nonsense: nothing at all", () => {
  for (const [p, d] of [["", "30% off"], ["$38", ""], ["$38", "Free shipping"], ["From $38", "30%"], ["$38", "100% off"], ["$0", "30%"]]) {
    assert.deepEqual(wasNow(p, d), {}, `${p} / ${d}`);
  }
});

test("the Black Friday photo scene carries was/now only with a real price", () => {
  const withPrice = buildScenes("blackfriday", { pct: "30% off", _price: "$38" }, { photos: 1 }).find((s) => s.type === "photo");
  assert.equal(withPrice.was, "$38"); assert.equal(withPrice.price, "$26.60");
  const without = buildScenes("blackfriday", { pct: "30% off" }, { photos: 1 }).find((s) => s.type === "photo");
  assert.equal(without.was, undefined); assert.equal(without.price, undefined);
});

test("the voice reads shop shorthand right (P-068)", async () => {
  const { forVoice } = await import("../src/templates.js");
  assert.equal(forVoice("Peptide Ageless AM/PM Cream"), "Peptide Ageless A.M. P.M. Cream");
  assert.equal(forVoice("Bloom & Co, 50 ml, SPF 30"), "Bloom and Co, 50 millilitres, S P F 30");
  assert.equal(forVoice("Shipping FAQ"), "Shipping F A Q");
  assert.equal(forVoice("No change here."), "No change here.");
});
