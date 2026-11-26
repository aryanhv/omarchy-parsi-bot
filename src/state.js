import fs from "node:fs";

export const DEFAULT_STATE_FILE = "state.json";

export function loadState(stateFile = DEFAULT_STATE_FILE) {
  if (!fs.existsSync(stateFile)) {
    return { lastItemId: null };
  }

  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

export function saveState(state, stateFile = DEFAULT_STATE_FILE) {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
}

export function getNewItems(items, lastItemId) {
  if (!items || items.length === 0) {
    return { status: "empty", items: [] };
  }

  if (!lastItemId) {
    return { status: "baseline", items: [items[0]] };
  }

  const previousIndex = items.findIndex((item) => item.id === lastItemId);

  if (previousIndex === 0) {
    return { status: "up-to-date", items: [] };
  }

  if (previousIndex === -1) {
    // If the old article has fallen out of the feed, avoid flooding.
    return { status: "new", items: [items[0]] };
  }

  return {
    status: "new",
    items: items.slice(0, previousIndex).reverse(),
  };
}
