import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatTelegramMessage } from "../src/telegram.js";
import { LRM, RLM } from "../src/utils.js";

describe("telegram", () => {
  const item = {
    title: "Omarchy & Linux",
    link: "https://omarchy.org/news/test",
    description: "Details",
  };

  it("formats Persian translations with RLM and escaped HTML", () => {
    const message = formatTelegramMessage(item, {
      success: true,
      title: "خبر جدید Omarchy & Linux",
      description: "توضیحات <مهم>",
    });

    assert.ok(message.startsWith(`${RLM}📰 <b>خبر جدید Omarchy &amp; Linux</b>`));
    assert.ok(message.includes(`${RLM}توضیحات &lt;مهم&gt;`));
    assert.ok(
      message.includes(
        `${RLM}<a href="https://omarchy.org/news/test">مطالعه خبر اصلی در Omarchy</a>`,
      ),
    );
    assert.ok(
      message.includes(
        `${LRM}🆔 <a href="https://t.me/OmarchyParsi">@OmarchyParsi</a>`,
      ),
    );
  });

  it("formats English fallback without forcing RLM on title/description", () => {
    const message = formatTelegramMessage(item, {
      success: false,
      title: "Omarchy & Linux",
      description: "English fallback",
    });

    assert.ok(message.startsWith("📰 <b>Omarchy &amp; Linux</b>"));
    assert.ok(message.includes("\n\nEnglish fallback\n\n"));
  });
});
