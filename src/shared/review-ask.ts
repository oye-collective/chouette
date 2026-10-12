// The popup's one-time ask to rate Chouette on the Chrome Web Store.
//
// It waits for real value: a few successful translations, earned on at least
// two different days. Everything lives in chrome.storage on this device: two
// counters, the first two days they were earned on, and the reader's answer.
// No page, text or URL is recorded, and nothing is sent anywhere.
//
// Store policy: no gating and no incentives. The ask goes to every reader who
// reaches the threshold, and asks for a rating, not for a particular one.

export const STORE_REVIEWS_URL =
  "https://chromewebstore.google.com/detail/gpfaikggjpffgcfnnhdgpgeodaamdejl/reviews";

const STATE_KEY = "review_ask";
// Page runs already counted, so the later batches of one translation (content
// a page adds afterwards, a service worker restart) don't count it again.
const RUNS_KEY = "review_ask_runs";
const MAX_RUNS = 50;

const PAGE_THRESHOLD = 3;
const TEXT_THRESHOLD = 10;
const MIN_DAYS = 2;
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;

export type ReviewAnswer = "rate" | "later" | "never";

interface ReviewAskState {
  pages: number;
  texts: number;
  // The first MIN_DAYS distinct local dates with a translation, YYYY-MM-DD.
  days: string[];
  // "Not now" asks once more, after SNOOZE_MS.
  snoozedUntil: number;
  snoozed: boolean;
  // Rated or "Don't ask again": never shown again.
  done: boolean;
}

const EMPTY: ReviewAskState = {
  pages: 0,
  texts: 0,
  days: [],
  snoozedUntil: 0,
  snoozed: false,
  done: false,
};

async function load(): Promise<ReviewAskState> {
  const stored = await chrome.storage.local.get<{ [STATE_KEY]?: ReviewAskState }>(STATE_KEY);
  return { ...EMPTY, ...stored[STATE_KEY] };
}

// Translations finish concurrently; serialize the read-modify-write so no
// count is lost between them.
let updating: Promise<unknown> = Promise.resolve();

function update(change: (state: ReviewAskState) => void): Promise<void> {
  const next = updating.then(async () => {
    const state = await load();
    change(state);
    await chrome.storage.local.set({ [STATE_KEY]: state });
  });
  updating = next.catch(() => {});
  return next;
}

function localDay(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function recordTranslation(kind: "page" | "text", now: number): Promise<void> {
  return update((state) => {
    if (state.done) return;
    if (kind === "page") state.pages++;
    else state.texts++;
    const day = localDay(now);
    if (state.days.length < MIN_DAYS && !state.days.includes(day)) state.days.push(day);
  });
}

export function recordTextTranslation(now = Date.now()): Promise<void> {
  return recordTranslation("text", now);
}

// `runKey` identifies one translation of one page (the content script's
// clientId and epoch); only its first successful batch counts.
export async function recordPageTranslation(runKey: string, now = Date.now()): Promise<void> {
  const stored = await chrome.storage.session.get<{ [RUNS_KEY]?: string[] }>(RUNS_KEY);
  const runs = stored[RUNS_KEY] ?? [];
  if (runs.includes(runKey)) return;
  await chrome.storage.session.set({ [RUNS_KEY]: [...runs, runKey].slice(-MAX_RUNS) });
  await recordTranslation("page", now);
}

export async function shouldAskForReview(now = Date.now()): Promise<boolean> {
  const state = await load();
  return (
    !state.done &&
    now >= state.snoozedUntil &&
    state.days.length >= MIN_DAYS &&
    (state.pages >= PAGE_THRESHOLD || state.texts >= TEXT_THRESHOLD)
  );
}

export function answerReviewAsk(answer: ReviewAnswer, now = Date.now()): Promise<void> {
  return update((state) => {
    if (answer === "later" && !state.snoozed) {
      state.snoozed = true;
      state.snoozedUntil = now + SNOOZE_MS;
    } else {
      state.done = true;
    }
  });
}
