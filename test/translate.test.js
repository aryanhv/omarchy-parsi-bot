import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { translateToPersian } from "../src/translate.js";

describe("translate", () => {
  it("falls back to English when GEMINI_API_KEY is missing", async () => {
    const result = await translateToPersian("Title", "Description", {
      apiKey: "",
    });

    assert.deepEqual(result, {
      success: false,
      title: "Title",
      description: "Description",
    });
  });

  it("returns parsed Persian translation on valid Gemini response", async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    title: "انتشار نسخه جدید Omarchy",
                    description: "جزئیات نسخه جدید منتشر شد.",
                  }),
                },
              ],
            },
          },
        ],
      }),
    });

    const result = await translateToPersian("Omarchy release", "Details", {
      apiKey: "test-key",
      models: ["model-a"],
      fetchImpl: mockFetch,
      sleepImpl: async () => {},
    });

    assert.deepEqual(result, {
      success: true,
      title: "انتشار نسخه جدید Omarchy",
      description: "جزئیات نسخه جدید منتشر شد.",
    });
  });

  it("retries on 429 and falls back to next model when first model fails", async () => {
    const attemptedModels = [];
    const mockFetch = async (url) => {
      const model = url.match(/models\/([^:]+):/)?.[1];
      attemptedModels.push(model);

      if (model === "model-a") {
        return {
          ok: false,
          status: 429,
          text: async () => "rate limited",
        };
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: "خبر جدید Omarchy",
                      description: "توضیحات کوتاه خبر.",
                    }),
                  },
                ],
              },
            },
          ],
        }),
      };
    };

    const result = await translateToPersian("News", "Short desc", {
      apiKey: "test-key",
      models: ["model-a", "model-b"],
      attemptsPerModel: 2,
      fetchImpl: mockFetch,
      sleepImpl: async () => {},
    });

    assert.deepEqual(attemptedModels, ["model-a", "model-a", "model-b"]);
    assert.equal(result.success, true);
    assert.equal(result.title, "خبر جدید Omarchy");
  });
});
