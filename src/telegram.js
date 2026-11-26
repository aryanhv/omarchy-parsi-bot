import { LRM, RLM, escapeHtml, stripHtml } from "./utils.js";
import { translateToPersian } from "./translate.js";

export function formatTelegramMessage(item, translated) {
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

  return text;
}

export async function sendTelegramMessage(
  item,
  {
    botToken = process.env.TELEGRAM_BOT_TOKEN,
    chatId = process.env.TELEGRAM_CHAT_ID,
    topicId = process.env.TELEGRAM_TOPIC_ID,
    translateImpl = translateToPersian,
    fetchImpl = fetch,
  } = {},
) {
  const originalDescription = stripHtml(item.description).slice(0, 500);

  const translated = await translateImpl(
    String(item.title),
    originalDescription,
  );

  const text = formatTelegramMessage(item, translated);

  const response = await fetchImpl(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        message_thread_id: Number(topicId),
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
