import { fetchFeed, parseFeed } from "./feed.js";
import { getNewItems, loadState, saveState } from "./state.js";
import { sendTelegramMessage } from "./telegram.js";

function buildCacheFields(feedResult) {
  const fields = {};
  if (feedResult.url) fields.feedUrl = feedResult.url;
  if (feedResult.etag) fields.etag = feedResult.etag;
  if (feedResult.lastModified) fields.lastModified = feedResult.lastModified;
  return fields;
}

export async function main({ env = process.env } = {}) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  const topicId = env.TELEGRAM_TOPIC_ID;

  if (!botToken || !chatId || !topicId) {
    throw new Error("Missing Telegram environment variables.");
  }

  const state = loadState();

  const feedResult = await fetchFeed({
    cache: {
      feedUrl: state.feedUrl,
      etag: state.etag,
      lastModified: state.lastModified,
    },
  });

  if (feedResult.notModified) {
    console.log("No new Omarchy news (feed not modified).");
    return;
  }

  const items = parseFeed(feedResult.xml);

  const cacheFields = buildCacheFields(feedResult);
  const diff = getNewItems(items, state.lastItemId);

  if (diff.status === "empty") {
    console.log("No RSS items found.");
    return;
  }

  if (diff.status === "baseline") {
    const newestItem = diff.items[0];
    console.log(`First run. Setting baseline to: ${newestItem.title}`);

    saveState({
      lastItemId: newestItem.id,
      updatedAt: new Date().toISOString(),
      ...cacheFields,
    });

    return;
  }

  if (diff.status === "up-to-date") {
    console.log("No new Omarchy news.");

    // Persist ETag / Last-Modified if newly learned or updated so future runs get 304.
    if (
      cacheFields.etag !== state.etag ||
      cacheFields.lastModified !== state.lastModified ||
      cacheFields.feedUrl !== state.feedUrl
    ) {
      saveState({
        ...state,
        ...cacheFields,
      });
    }

    return;
  }

  for (const item of diff.items) {
    console.log(`Posting: ${item.title}`);

    await sendTelegramMessage(item, {
      botToken,
      chatId,
      topicId,
    });

    saveState({
      lastItemId: item.id,
      updatedAt: new Date().toISOString(),
      ...cacheFields,
    });
  }
}
