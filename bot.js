import fs from "node:fs";
import { XMLParser } from "fast-xml-parser";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TOPIC_ID = process.env.TELEGRAM_TOPIC_ID;

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

const STATE_FILE = "state.json";

const RLM = "\u200F";
const LRM = "\u200E";

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

function startsWithPersian(text = "") {
  return /^[\s\u200F]*[\u0600-\u06FF]/.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFeed() {
  for (const url of FEED_URLS) {
    try {
      console.log(`Trying RSS feed: ${url}`);

      const response = await fetch(url, {
        headers: {
          "User-Agent": "OmarchyParsiBot/1.0",
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

async function requestGeminiTranslation(model, prompt) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 20000);

  try {
    return await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY,
        },
        signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

async function translateToPersian(title, description) {
  if (!GEMINI_API_KEY) {
    console.log("No Gemini API key. Using original English text.");

    return {
      success: false,
      title,
      description,
    };
  }

  const prompt = `
You are the Persian editor for a technology community focused on Omarchy.

Translate the following Omarchy news item from English into polished,
natural Persian suitable for publication in a Telegram technology community.

TRANSLATION STYLE:
- Write fluent, idiomatic Persian, not word-for-word machine translation.
- Use contemporary Persian commonly used by Iranian software developers.
- Keep the tone professional, clear, concise, and readable.
- Preserve the exact meaning and factual content.
- Do not add opinions, explanations, or information not present in the source.
- Do not omit meaningful information.
- Prefer natural Persian sentence structure over English sentence structure.

RTL REQUIREMENT:
- Every title and description MUST begin with a Persian word.
- Never begin a title or paragraph with an English proper noun.
- If the English sentence begins with a name such as "ThePrimeagen",
  restructure it naturally in Persian.
- This is important because the text will be displayed right-to-left.

TECHNICAL TERMINOLOGY:
- Keep established product names, usernames, project names, commands,
  model names, URLs, package names, and version numbers in English.
- Examples: Omarchy, Hyprland, ThePrimeagen, Omakub, Omacom,
  GitHub, Linux, Gemini, Wayland.
- Do not transliterate these names into Persian.
- Translate general technical concepts when there is a natural Persian equivalent.

PERSIAN WRITING:
- Use Persian characters, not Arabic variants.
- Use "ی" instead of "ي".
- Use "ک" instead of "ك".
- Use proper Persian نیم‌فاصله where appropriate.
- Avoid overly formal or literary vocabulary.
- Avoid awkward literal translations from English.
- Keep the title short and news-like.

Return ONLY valid JSON in exactly this shape:
{
  "title": "...",
  "description": "..."
}

Title:
${title}

Description:
${description}
`;

  const retryableStatuses = new Set([429, 500, 502, 503, 504]);

  // Two attempts per model.
  const attemptsPerModel = 2;
  const retryDelay = 2000;

  for (const model of GEMINI_MODELS) {
    console.log(`Trying Gemini model: ${model}`);

    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      try {
        console.log(`Gemini ${model} attempt ${attempt}/${attemptsPerModel}`);

        const response = await requestGeminiTranslation(model, prompt);

        if (!response.ok) {
          const errorText = await response.text();

          console.error(
            `Gemini ${model} returned ${response.status}: ${errorText}`,
          );

          if (
            retryableStatuses.has(response.status) &&
            attempt < attemptsPerModel
          ) {
            console.log(`Retrying ${model} in ${retryDelay / 1000}s...`);

            await sleep(retryDelay);
            continue;
          }

          break;
        }

        const data = await response.json();

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
          throw new Error("Gemini returned no translation text.");
        }

        const translated = JSON.parse(text);

        if (!translated.title || !translated.description) {
          throw new Error("Gemini returned incomplete translation.");
        }

        if (
          !startsWithPersian(translated.title) ||
          !startsWithPersian(translated.description)
        ) {
          throw new Error("Gemini returned non-RTL-safe Persian text.");
        }

        console.log(`Translation succeeded with ${model}.`);

        return {
          success: true,
          title: translated.title.trim(),
          description: translated.description.trim(),
        };
      } catch (error) {
        console.error(
          `Gemini ${model} attempt ${attempt} failed: ${error.message}`,
        );

        if (attempt < attemptsPerModel) {
          console.log(`Retrying ${model} in ${retryDelay / 1000}s...`);

          await sleep(retryDelay);
        }
      }
    }

    console.log(`${model} failed. Trying next Gemini model...`);
  }

  console.log("All Gemini models failed. Using original English text.");

  return {
    success: false,
    title,
    description,
  };
}

async function sendTelegramMessage(item) {
  const originalDescription = stripHtml(item.description).slice(0, 500);

  const translated = await translateToPersian(
    String(item.title),
    originalDescription,
  );

  // Persian content gets explicit RTL.
  // English fallback gets no direction forcing.
  const contentDirection = translated.success ? RLM : "";

  const sourceLine = `${RLM}<a href="${escapeHtml(
    item.link,
  )}">مطالعه خبر اصلی در Omarchy</a>`;

  // Explicitly keep community attribution LTR / left aligned.
  const communityLine = `${LRM}🆔 <a href="https://t.me/OmarchyParsi">@OmarchyParsi</a>`;

  let text = `${contentDirection}📰 <b>${escapeHtml(translated.title)}</b>`;

  if (translated.description) {
    text += `\n\n${contentDirection}${escapeHtml(translated.description)}`;
  }

  text += `\n\n${sourceLine}`;

  text += `\n\n${communityLine}`;

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
  // remember the newest article
  // without posting old history.
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
    // If the old article has fallen
    // out of the feed, avoid flooding.
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
