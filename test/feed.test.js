import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fetchFeed, parseFeed } from "../src/feed.js";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Omarchy News</title>
    <item>
      <title>Omarchy 4.5</title>
      <link>https://omarchy.org/news/omarchy-4-5</link>
      <guid isPermaLink="true">https://omarchy.org/news/omarchy-4-5</guid>
      <pubDate>Fri, 20 Nov 2026 15:00:00 GMT</pubDate>
      <description><![CDATA[New release notes.]]></description>
    </item>
  </channel>
</rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Omarchy News</title>
  <entry>
    <id>tag:omarchy.org,2026:1</id>
    <title>Atom Post</title>
    <link rel="alternate" href="https://omarchy.org/news/atom-post" />
    <summary>Atom summary</summary>
    <updated>2026-11-20T15:00:00Z</updated>
  </entry>
</feed>`;

describe("feed", () => {
  it("parses RSS 2.0 feeds", () => {
    const items = parseFeed(SAMPLE_RSS);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      id: "https://omarchy.org/news/omarchy-4-5",
      title: "Omarchy 4.5",
      link: "https://omarchy.org/news/omarchy-4-5",
      description: "New release notes.",
      date: "Fri, 20 Nov 2026 15:00:00 GMT",
    });
  });

  it("parses Atom feeds", () => {
    const items = parseFeed(SAMPLE_ATOM);
    assert.equal(items.length, 1);
    assert.deepEqual(items[0], {
      id: "tag:omarchy.org,2026:1",
      title: "Atom Post",
      link: "https://omarchy.org/news/atom-post",
      description: "Atom summary",
      date: "2026-11-20T15:00:00Z",
    });
  });

  it("throws on unsupported XML format", () => {
    assert.throws(() => parseFeed("<root><hello>world</hello></root>"), {
      message: "Unsupported RSS/Atom format.",
    });
  });

  it("sends If-None-Match and short-circuits on HTTP 304", async () => {
    let seenHeaders;
    const mockFetch = async (_url, options) => {
      seenHeaders = options.headers;
      return {
        status: 304,
        ok: false,
        headers: new Headers({ etag: '"v1"' }),
      };
    };

    const result = await fetchFeed({
      feedUrls: ["https://omarchy.org/news/rss.xml"],
      cache: {
        feedUrl: "https://omarchy.org/news/rss.xml",
        etag: '"v1"',
      },
      fetchImpl: mockFetch,
    });

    assert.equal(seenHeaders["If-None-Match"], '"v1"');
    assert.equal(result.notModified, true);
    assert.equal(result.etag, '"v1"');
  });

  it("returns XML and ETag on HTTP 200 and falls back across URLs", async () => {
    let calls = 0;
    const mockFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return { status: 404, ok: false, headers: new Headers() };
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers({
          etag: '"v2"',
          "last-modified": "Fri, 20 Nov 2026 15:00:00 GMT",
        }),
        text: async () => SAMPLE_RSS,
      };
    };

    const result = await fetchFeed({
      feedUrls: [
        "https://omarchy.org/missing.xml",
        "https://omarchy.org/news/rss.xml",
      ],
      fetchImpl: mockFetch,
    });

    assert.equal(calls, 2);
    assert.equal(result.notModified, false);
    assert.equal(result.url, "https://omarchy.org/news/rss.xml");
    assert.equal(result.etag, '"v2"');
    assert.equal(result.lastModified, "Fri, 20 Nov 2026 15:00:00 GMT");
    assert.ok(result.xml.includes("<rss"));
  });
});
