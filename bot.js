import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TOPIC_ID = process.env.TELEGRAM_TOPIC_ID;
const PARSE_MODE =
  (process.env.TELEGRAM_PARSE_MODE || "HTML").toLowerCase() === "markdownv2"
    ? "MarkdownV2"
    : "HTML";

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

export function escapeMarkdownV2(text = "") {
  return String(text).replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export function escapeMarkdownV2Url(url = "") {
  return String(url).replace(/([)\\])/g, "\\$1");
}

export function escapeMarkdownV2Code(code = "") {
  return String(code).replace(/([`\\])/g, "\\$1");
}

/**
 * Converts standard Markdown (headings, bold, italic, strikethrough, inline/fenced code,
 * links, blockquotes, bullet lists) into valid Telegram MarkdownV2.
 */
export function markdownToTelegramMarkdownV2(markdown = "") {
  const placeholders = [];
  const stash = (value) => {
    const token = `\uE000${placeholders.length}\uE001`;
    placeholders.push(value);
    return token;
  };

  let text = String(markdown).replace(/\r\n/g, "\n");

  // 1. Fenced code blocks: ```lang\n...\n```
  text = text.replace(
    /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
    (_match, lang, code) => {
      const cleanCode = code.replace(/\n$/, "");
      return stash(
        `\`\`\`${lang}\n${escapeMarkdownV2Code(cleanCode)}\n\`\`\``,
      );
    },
  );

  // 2. Inline code: `code`
  text = text.replace(/`([^`\n]+)`/g, (_match, code) =>
    stash(`\`${escapeMarkdownV2Code(code)}\``),
  );

  // 3. Links: [label](url) (supports one level of balanced parentheses in URLs)
  text = text.replace(
    /\[([^\]]+)\]\(((?:[^()\s]+|\([^()\s]*\))+)\)/g,
    (_match, label, url) =>
      stash(`[${escapeMarkdownV2(label)}](${escapeMarkdownV2Url(url)})`),
  );

  // 4. Process line-level and inline formatting safely
  const formatInline = (segment) => {
    const inlineTokens = [];
    const stashInline = (val) => {
      const token = `\uE002${inlineTokens.length}\uE003`;
      inlineTokens.push(val);
      return token;
    };

    let s = segment;

    // Bold: **text** or __text__
    s = s.replace(/\*\*(.+?)\*\*/g, (_m, inner) =>
      stashInline(`*${escapeMarkdownV2(inner)}*`),
    );
    s = s.replace(/__(.+?)__/g, (_m, inner) =>
      stashInline(`*${escapeMarkdownV2(inner)}*`),
    );

    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, (_m, inner) =>
      stashInline(`~${escapeMarkdownV2(inner)}~`),
    );

    // Italic: *text* (not inside words)
    s = s.replace(/(^|[\s(\[«])\*([^*\n]+)\*(?=$|[\s.,!?;:)\]»])/g, (_m, pre, inner) =>
      `${pre}${stashInline(`_${escapeMarkdownV2(inner)}_`)}`,
    );

    // Escape all remaining plain text (preserving stash placeholders)
    s = s
      .split(/(\uE000\d+\uE001|\uE002\d+\uE003)/g)
      .map((part) => {
        if (/^\uE000\d+\uE001$|^\uE002\d+\uE003$/.test(part)) {
          return part;
        }
        return escapeMarkdownV2(part);
      })
      .join("");

    // Restore inline tokens
    s = s.replace(/\uE002(\d+)\uE003/g, (_m, idx) => inlineTokens[Number(idx)]);
    return s;
  };

  const formattedLines = text.split("\n").map((line) => {
    // Preserve standalone fenced code block placeholders as-is
    if (/^\uE000\d+\uE001$/.test(line.trim())) {
      return line.trim();
    }

    // Headings: # Title -> *Title*
    const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      return `*${escapeMarkdownV2(headingMatch[1].trim())}*`;
    }

    // Blockquotes: > quote
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      return `>${formatInline(quoteMatch[1])}`;
    }

    // Bullet lists: - item or * item -> • item
    const bulletMatch = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (bulletMatch) {
      return `${bulletMatch[1]}• ${formatInline(bulletMatch[2])}`;
    }

    return formatInline(line);
  });

  // Restore top-level placeholders (code blocks, inline code, links)
  return formattedLines
    .join("\n")
    .replace(/\uE000(\d+)\uE001/g, (_m, idx) => placeholders[Number(idx)]);
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

export function formatNewsMessage(item, translated, parseMode = PARSE_MODE) {
  // Persian content gets explicit RTL.
  // English fallback gets no direction forcing.
  const contentDirection = translated.success ? RLM : "";

  if (parseMode === "MarkdownV2") {
    const sourceLine = `${RLM}[${escapeMarkdownV2("مطالعه خبر اصلی در Omarchy")}](${escapeMarkdownV2Url(item.link)})`;
    const communityLine = `${LRM}🆔 [${escapeMarkdownV2("@OmarchyParsi")}](https://t.me/OmarchyParsi)`;

    let text = `${contentDirection}📰 *${escapeMarkdownV2(translated.title)}*`;

    if (translated.description) {
      text += `\n\n${contentDirection}${escapeMarkdownV2(translated.description)}`;
    }

    text += `\n\n${sourceLine}`;
    text += `\n\n${communityLine}`;

    return { text, parseMode: "MarkdownV2" };
  }

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

  return { text, parseMode: "HTML" };
}

async function sendTelegramRaw({
  text,
  parseMode = "HTML",
  disableWebPagePreview = false,
}) {
  if (!BOT_TOKEN || !CHAT_ID || !TOPIC_ID) {
    throw new Error("Missing Telegram environment variables.");
  }

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
        parse_mode: parseMode,
        disable_web_page_preview: disableWebPagePreview,
      }),
    },
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(`Telegram error: ${JSON.stringify(result)}`);
  }

  return result;
}

export async function sendTelegramMarkdown(
  markdown,
  { dryRun = false, disableWebPagePreview = false } = {},
) {
  const text = markdownToTelegramMarkdownV2(markdown);

  if (dryRun) {
    console.log(text);
    return { ok: true, dryRun: true, text };
  }

  return sendTelegramRaw({
    text,
    parseMode: "MarkdownV2",
    disableWebPagePreview,
  });
}

async function sendTelegramMessage(item) {
  const originalDescription = stripHtml(item.description).slice(0, 500);

  const translated = await translateToPersian(
    String(item.title),
    originalDescription,
  );

  const { text, parseMode } = formatNewsMessage(item, translated, PARSE_MODE);

  await sendTelegramRaw({
    text,
    parseMode,
    disableWebPagePreview: false,
  });
}

function parseCliArgs(argv) {
  const args = {
    markdown: null,
    markdownFile: null,
    dryRun: argv.includes("--dry-run") || process.env.DRY_RUN === "1",
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--markdown" && argv[i + 1]) {
      args.markdown = argv[i + 1];
      i++;
    } else if (argv[i] === "--markdown-file" && argv[i + 1]) {
      args.markdownFile = argv[i + 1];
      i++;
    }
  }

  return args;
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2));

  if (cli.markdown !== null || cli.markdownFile !== null) {
    const content = cli.markdownFile
      ? fs.readFileSync(cli.markdownFile, "utf8")
      : cli.markdown;
    await sendTelegramMarkdown(content, { dryRun: cli.dryRun });
    return;
  }

  if (!BOT_TOKEN || !CHAT_ID || !TOPIC_ID) {
    throw new Error("Missing Telegram environment variables.");
  }

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

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
