import { sleep, startsWithPersian } from "./utils.js";

export const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite"];

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function buildTranslationPrompt(title, description) {
  return `
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
}

export async function requestGeminiTranslation(
  model,
  prompt,
  { apiKey = process.env.GEMINI_API_KEY, timeoutMs = 20000, fetchImpl = fetch } = {},
) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
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

export async function translateToPersian(
  title,
  description,
  {
    apiKey = process.env.GEMINI_API_KEY,
    models = GEMINI_MODELS,
    attemptsPerModel = 2,
    retryDelay = 2000,
    fetchImpl = fetch,
    sleepImpl = sleep,
  } = {},
) {
  if (!apiKey) {
    console.log("No Gemini API key. Using original English text.");

    return {
      success: false,
      title,
      description,
    };
  }

  const prompt = buildTranslationPrompt(title, description);

  for (const model of models) {
    console.log(`Trying Gemini model: ${model}`);

    for (let attempt = 1; attempt <= attemptsPerModel; attempt++) {
      try {
        console.log(`Gemini ${model} attempt ${attempt}/${attemptsPerModel}`);

        const response = await requestGeminiTranslation(model, prompt, {
          apiKey,
          fetchImpl,
        });

        if (!response.ok) {
          const errorText = await response.text();

          console.error(
            `Gemini ${model} returned ${response.status}: ${errorText}`,
          );

          if (
            RETRYABLE_STATUSES.has(response.status) &&
            attempt < attemptsPerModel
          ) {
            console.log(`Retrying ${model} in ${retryDelay / 1000}s...`);

            await sleepImpl(retryDelay);
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

          await sleepImpl(retryDelay);
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
