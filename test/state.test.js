import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getNewItems, loadState, saveState } from "../src/state.js";

describe("state", () => {
  const sampleItems = [
    { id: "3", title: "Newest" },
    { id: "2", title: "Middle" },
    { id: "1", title: "Oldest" },
  ];

  it("returns empty when feed has no items", () => {
    assert.deepEqual(getNewItems([], "1"), { status: "empty", items: [] });
  });

  it("sets baseline to newest item on first run", () => {
    assert.deepEqual(getNewItems(sampleItems, null), {
      status: "baseline",
      items: [sampleItems[0]],
    });
  });

  it("returns up-to-date when newest item matches lastItemId", () => {
    assert.deepEqual(getNewItems(sampleItems, "3"), {
      status: "up-to-date",
      items: [],
    });
  });

  it("returns unseen items in chronological (oldest-first) order", () => {
    assert.deepEqual(getNewItems(sampleItems, "1"), {
      status: "new",
      items: [sampleItems[1], sampleItems[0]],
    });
  });

  it("returns only newest item when lastItemId has fallen out of the feed", () => {
    assert.deepEqual(getNewItems(sampleItems, "0"), {
      status: "new",
      items: [sampleItems[0]],
    });
  });

  it("loads default state when file does not exist and persists updates", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omarchy-state-"));
    const stateFile = path.join(tmpDir, "state.json");

    try {
      assert.deepEqual(loadState(stateFile), { lastItemId: null });

      const nextState = {
        lastItemId: "3",
        updatedAt: "2026-11-26T00:00:00.000Z",
        etag: '"abc123"',
      };
      saveState(nextState, stateFile);
      assert.deepEqual(loadState(stateFile), nextState);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
