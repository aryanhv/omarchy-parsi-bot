import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml,
  stripHtml,
  toArray,
  startsWithPersian,
} from "../src/utils.js";

describe("utils", () => {
  it("escapeHtml escapes &, <, and >", () => {
    assert.equal(
      escapeHtml("<b>Omarchy & Linux</b>"),
      "&lt;b&gt;Omarchy &amp; Linux&lt;/b&gt;",
    );
    assert.equal(escapeHtml(), "");
  });

  it("stripHtml removes tags and collapses whitespace", () => {
    assert.equal(
      stripHtml("<p>Hello   <b>Omarchy</b>\n\t world!</p>"),
      "Hello Omarchy world!",
    );
    assert.equal(stripHtml(), "");
  });

  it("toArray normalizes empty, single, and array values", () => {
    assert.deepEqual(toArray(null), []);
    assert.deepEqual(toArray(undefined), []);
    assert.deepEqual(toArray("a"), ["a"]);
    assert.deepEqual(toArray(["a", "b"]), ["a", "b"]);
  });

  it("startsWithPersian detects Persian leading characters with optional RLM/spaces", () => {
    assert.equal(startsWithPersian("انتشار نسخه جدید Omarchy"), true);
    assert.equal(startsWithPersian("  \u200Fخبر جدید"), true);
    assert.equal(startsWithPersian("Omarchy 4.5 released"), false);
    assert.equal(startsWithPersian(""), false);
  });
});
