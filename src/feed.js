import { XMLParser } from "fast-xml-parser";
import { toArray } from "./utils.js";

export const DEFAULT_FEED_URLS = [
  "https://omarchy.org/news/rss.xml",
  "https://omarchy.org/news/feed.xml",
  "https://omarchy.org/rss.xml",
  "https://omarchy.org/feed.xml",
];

export function getFeedUrls(rssUrl = process.env.RSS_URL) {
  return [rssUrl, ...DEFAULT_FEED_URLS].filter(Boolean);
}

export async function fetchFeed({
  feedUrls = getFeedUrls(),
  cache = {},
  fetchImpl = fetch,
} = {}) {
  for (const url of feedUrls) {
    try {
      console.log(`Trying RSS feed: ${url}`);

      const headers = {
        "User-Agent": "OmarchyParsiBot/1.0",
      };

      const canUseCache = !cache.feedUrl || cache.feedUrl === url;
      if (canUseCache && cache.etag) {
        headers["If-None-Match"] = cache.etag;
      }
      if (canUseCache && cache.lastModified) {
        headers["If-Modified-Since"] = cache.lastModified;
      }

      const response = await fetchImpl(url, { headers });

      if (response.status === 304) {
        console.log(`Feed not modified (304): ${url}`);
        return {
          notModified: true,
          xml: null,
          url,
          etag: response.headers?.get("etag") ?? cache.etag ?? null,
          lastModified:
            response.headers?.get("last-modified") ??
            cache.lastModified ??
            null,
        };
      }

      if (!response.ok) {
        console.log(`Feed returned ${response.status}`);
        continue;
      }

      const xml = await response.text();

      if (!xml.includes("<rss") && !xml.includes("<feed")) {
        console.log("Response does not look like RSS/Atom.");
        continue;
      }

      console.log(`Using feed: ${url}`);

      return {
        notModified: false,
        xml,
        url,
        etag: response.headers?.get("etag") ?? null,
        lastModified: response.headers?.get("last-modified") ?? null,
      };
    } catch (error) {
      console.log(`Failed ${url}: ${error.message}`);
    }
  }

  throw new Error("Could not load an Omarchy RSS feed.");
}

export function parseFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });

  const data = parser.parse(xml);

  // RSS
  if (data.rss?.channel?.item) {
    return toArray(data.rss.channel.item).map((item) => ({
      id: String(item.guid?.["#text"] ?? item.guid ?? item.link),
      title: item.title ?? "Omarchy News",
      link: item.link,
      description: item.description ?? item["content:encoded"] ?? "",
      date: item.pubDate ?? "",
    }));
  }

  // Atom
  if (data.feed?.entry) {
    return toArray(data.feed.entry).map((item) => {
      const links = toArray(item.link);

      const link =
        links.find((l) => l?.["@_rel"] === "alternate")?.["@_href"] ??
        links[0]?.["@_href"] ??
        item.link;

      return {
        id: String(item.id ?? link),
        title: item.title?.["#text"] ?? item.title ?? "Omarchy News",
        link,
        description:
          item.summary?.["#text"] ??
          item.summary ??
          item.content?.["#text"] ??
          item.content ??
          "",
        date: item.updated ?? item.published ?? "",
      };
    });
  }

  throw new Error("Unsupported RSS/Atom format.");
}
