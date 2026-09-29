import fs from "node:fs";
import { XMLParser } from "fast-xml-parser";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TOPIC_ID = process.env.TELEGRAM_TOPIC_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = "gemini-3.5-flash-lite";

const STATE_FILE = "state.json";

const FEED_URLS = [
  process.env.RSS_URL,
  "https://omarchy.org/news/rss.xml",
  "https://omarchy.org/news/feed.xml",
  "https://omarchy.org/rss.xml",
  "https://omarchy.org/feed.xml",
].filter(Boolean);

if (!BOT_TOKEN || !CHAT_ID || !TOPIC_ID) {
  throw new Error("Missing Telegram environment variables.");
}

function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return { lastItemId: null };
  }

  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
}

function escapeHtml(text = "") {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function stripHtml(text = "") {
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchFeed() {
  for (const url of FEED_URLS) {
    try {
      console.log(`Trying RSS feed: ${url}`);

      const response = await fetch(url, {
        headers: {
          "User-Agent": "OmarchyParsiNewsBot/1.0",
        },
      });

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
      return xml;
    } catch (error) {
      console.log(`Failed ${url}: ${error.message}`);
    }
  }

  throw new Error("Could not load an Omarchy RSS feed.");
}

function parseFeed(xml) {
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
        links.find((link) => link?.["@_rel"] === "alternate")?.["@_href"] ??
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

async function translateToPersian(title, description) {
  if (!GEMINI_API_KEY) {
    console.log("No Gemini API key. Using original English text.");
    return { title, description };
  }

  const prompt = `
Translate the following Omarchy news item into natural, fluent Persian.

Rules:
- Preserve technical names and proper nouns such as Omarchy, Hyprland, ThePrimeagen, Omakub, Omacom, Linux, GitHub, model names, commands, URLs, and version numbers in English.
- Do not add information that is not present in the source.
- Do not summarize beyond the supplied text.
- Keep the tone clear and suitable for a Persian-speaking technology community.
- Return ONLY valid JSON in exactly this shape:
{"title":"...","description":"..."}

Title:
${title}

Description:
${description}
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Gemini API returned ${response.status}: ${await response.text()}`,
      );
    }

    const data = await response.json();

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      throw new Error("Gemini returned no text.");
    }

    const translated = JSON.parse(text);

    if (!translated.title || !translated.description) {
      throw new Error("Gemini returned incomplete translation.");
    }

    return translated;
  } catch (error) {
    console.error(`Gemini translation failed: ${error.message}`);
    console.log("Falling back to original English text.");

    return { title, description };
  }
}

async function sendTelegramMessage(item) {
  const originalDescription = stripHtml(item.description).slice(0, 500);

  const translated = await translateToPersian(
    String(item.title),
    originalDescription,
  );

  let text = `📰 <b>${escapeHtml(translated.title)}</b>`;

  if (translated.description) {
    text += `\n\n${escapeHtml(translated.description)}`;
  }

  text += `\n\n<a href="${escapeHtml(item.link)}">مطالعه خبر اصلی در Omarchy</a>`;

  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        message_thread_id: Number(TOPIC_ID),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      }),
    },
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(`Telegram error: ${JSON.stringify(result)}`);
  }
}

async function main() {
  const state = loadState();

  const xml = await fetchFeed();
  const items = parseFeed(xml);

  if (items.length === 0) {
    console.log("No RSS items found.");
    return;
  }

  const newestItem = items[0];

  // First run:
  // remember the current newest article without posting old history.
  if (!state.lastItemId) {
    console.log(`First run. Setting baseline to: ${newestItem.title}`);

    saveState({
      lastItemId: newestItem.id,
      updatedAt: new Date().toISOString(),
    });

    return;
  }

  const previousIndex = items.findIndex((item) => item.id === state.lastItemId);

  if (previousIndex === 0) {
    console.log("No new Omarchy news.");
    return;
  }

  let newItems;

  if (previousIndex === -1) {
    // If the old item has fallen out of the feed,
    // avoid flooding Telegram.
    newItems = [newestItem];
  } else {
    newItems = items.slice(0, previousIndex).reverse();
  }

  for (const item of newItems) {
    console.log(`Posting: ${item.title}`);

    await sendTelegramMessage(item);

    saveState({
      lastItemId: item.id,
      updatedAt: new Date().toISOString(),
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
