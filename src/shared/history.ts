// Persistent translation history, stored in chrome.storage.local (newest first).

export interface HistoryEntry {
  id: string;
  sourceText: string;
  translatedText: string;
  sourceLang: string; // resolved code, never "auto"
  targetLang: string;
  timestamp: number;
}

const HISTORY_KEY = "translationHistory";
const MAX_ENTRIES = 15;

export async function getHistory(): Promise<HistoryEntry[]> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const history = result[HISTORY_KEY];
  return Array.isArray(history) ? (history as HistoryEntry[]) : [];
}

export async function addHistoryEntry(
  entry: Omit<HistoryEntry, "id" | "timestamp">
): Promise<HistoryEntry[]> {
  const translated = entry.translatedText.trim();
  if (!translated || entry.sourceText.trim() === translated) {
    return getHistory();
  }

  const full: HistoryEntry = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
  };

  const history = await getHistory();
  const updated = [full, ...history].slice(0, MAX_ENTRIES);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  return updated;
}

export async function deleteHistoryEntry(id: string): Promise<HistoryEntry[]> {
  const history = await getHistory();
  const updated = history.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  return updated;
}

export async function clearHistory(): Promise<void> {
  await chrome.storage.local.remove(HISTORY_KEY);
}
