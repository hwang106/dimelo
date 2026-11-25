// Spaced repetition with FSRS-4.5 (Ye et al., the scheduler Anki adopted in 2023).
// A card is { s: stability in days, d: difficulty 1–10, last: ms of last review, due: ms, reps, lapses }.
// Ratings: 1 Again (wrong), 2 Hard (right but slow / after a slow replay), 3 Good, 4 Easy.

const W = [0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474, 0.1367,
  1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755];
const DECAY = -0.5, FACTOR = 19 / 81, RETENTION = 0.9, DAY = 864e5;
const clampD = d => Math.min(10, Math.max(1, d));

export function retrievability(card, now = Date.now()) {
  if (!card || !card.last) return 0;
  const t = Math.max(0, (now - card.last) / DAY);
  return Math.pow(1 + FACTOR * t / card.s, DECAY);
}
const interval = s => Math.max(1, Math.round(s / FACTOR * (Math.pow(RETENTION, 1 / DECAY) - 1)));

export function review(card, rating, now = Date.now()) {
  const c = { ...(card || {}) };
  if (!c.last) {
    c.s = W[rating - 1];
    c.d = clampD(W[4] - (rating - 3) * W[5]);
    c.reps = 0; c.lapses = 0;
  } else {
    const r = retrievability(c, now);
    const d0Easy = W[4] - (4 - 3) * W[5];
    c.d = clampD(W[7] * d0Easy + (1 - W[7]) * (c.d - W[6] * (rating - 3)));
    if (rating === 1) {
      c.s = Math.min(c.s, W[11] * Math.pow(c.d, -W[12]) * (Math.pow(c.s + 1, W[13]) - 1) * Math.exp(W[14] * (1 - r)));
      c.lapses = (c.lapses || 0) + 1;
    } else {
      const hard = rating === 2 ? W[15] : 1, easy = rating === 4 ? W[16] : 1;
      c.s = c.s * (Math.exp(W[8]) * (11 - c.d) * Math.pow(c.s, -W[9]) * (Math.exp(W[10] * (1 - r)) - 1) * hard * easy + 1);
    }
  }
  c.reps = (c.reps || 0) + 1;
  c.last = now;
  // a miss comes back in 10 minutes inside today's practice; otherwise the FSRS interval
  c.due = rating === 1 ? now + 10 * 60e3 : now + interval(c.s) * DAY;
  return c;
}

export const isDue = (card, now = Date.now()) => !!card && card.last && card.due <= now;
// 0 new, 1 learning (stability < 3 days), 2 familiar (< 21 days), 3 strong
export function strength(card) {
  if (!card || !card.last) return 0;
  return card.s < 3 ? 1 : card.s < 21 ? 2 : 3;
}
