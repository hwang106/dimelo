// Game state derived from saved records: XP, streak, freezes, cheles, league, achievements.
// Everything is computed from per-day, per-device records, so two devices never overwrite each
// other's XP when they sync.

import * as store from "./store.js";
import { review } from "./srs.js";
import { UNITS, ALL_ITEMS } from "./content.js";

const DAY = 864e5;
const dateOf = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => store.today(new Date(dateOf(s).getTime() + n * DAY));

export function dayTotals() {
  const by = {};
  for (const r of store.all("day:")) {
    const d = r.id.split(":")[1];
    const t = by[d] || (by[d] = { xp: 0, secs: 0, lessons: 0, cheles: 0 });
    t.xp += r.xp || 0; t.secs += r.secs || 0; t.lessons += r.lessons || 0; t.cheles += r.cheles || 0;
  }
  return by;
}
const myDayId = (d = store.today()) => `day:${d}:${store.device()}`;
export async function addToday({ xp = 0, secs = 0, lessons = 0, cheles = 0, listen }) {
  const id = myDayId();
  const r = { xp: 0, secs: 0, lessons: 0, cheles: 0, ...(store.get(id) || {}), id };
  const before = dayTotals()[store.today()] || { xp: 0 };
  r.xp += xp; r.secs += secs; r.lessons += lessons; r.cheles += cheles;
  // daily goal bonus, once per day
  const goal = store.settings().goal;
  if (before.xp < goal && before.xp + xp >= goal && !r.goalBonus) { r.cheles += 10; r.goalBonus = true; }
  await store.put(r);
  return r;
}

export const totalXP = () => Object.values(dayTotals()).reduce((a, t) => a + t.xp, 0);
export function level(xp = totalXP()) {
  // each level needs a bit more: 60, 80, 100, ...
  let lv = 1, need = 60, left = xp;
  while (left >= need) { left -= need; lv++; need += 20; }
  return { lv, into: left, need };
}

const active = t => t && (t.lessons > 0 || t.xp > 0);
export function freezesOwned() {
  return store.all("buy:").filter(b => b.what === "freeze").length - store.all("freeze:").length;
}
export function cheles() {
  const earned = Object.values(dayTotals()).reduce((a, t) => a + t.cheles, 0);
  const spent = store.all("buy:").reduce((a, b) => a + (b.cost || 0), 0);
  return earned - spent;
}
export async function buyFreeze() {
  if (cheles() < 50 || freezesOwned() >= 2) return false;
  await store.put({ id: "buy:" + Date.now(), what: "freeze", cost: 50 });
  return true;
}
// On open: cover missed days (since the last active day) with freezes you own.
export async function applyFreezes() {
  const days = dayTotals(), t = store.today();
  const actives = Object.keys(days).filter(d => active(days[d])).sort();
  if (!actives.length) return [];
  const used = [];
  let d = addDays(actives[actives.length - 1], 1);
  const missing = [];
  while (d < t) { if (!store.get("freeze:" + d)) missing.push(d); d = addDays(d, 1); }
  if (missing.length && missing.length <= freezesOwned()) {
    for (const m of missing) { await store.put({ id: "freeze:" + m }); used.push(m); }
  }
  return used;
}
export function streak() {
  const days = dayTotals(), t = store.today();
  const ok = d => active(days[d]) || !!store.get("freeze:" + d);
  let d = active(days[t]) ? t : addDays(t, -1), n = 0;
  while (ok(d)) { n++; d = addDays(d, -1); }
  return { n, today: active(days[t]) };
}
export function longestStreak() {
  const days = dayTotals();
  const set = Object.keys(days).filter(d => active(days[d])).concat(store.all("freeze:").map(f => f.id.slice(7))).sort();
  let best = 0, run = 0, prev = null;
  for (const d of [...new Set(set)]) { run = prev && addDays(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; }
  return best;
}

// ---- cards ----
export const cardId = (item, skill) => `card:${item}:${skill}`;
export const card = (item, skill) => store.get(cardId(item, skill));
export async function grade(item, skill, rating) {
  const id = cardId(item, skill);
  const c = review(store.get(id), rating);
  await store.put({ ...c, id });
}

// Ear speed: goes up when you're getting most listening right, down when you're struggling.
const recent = [];
export async function listenResult(ok) {
  recent.push(ok); if (recent.length > 16) recent.shift();
  if (recent.length < 8) return null;
  const rate = recent.filter(Boolean).length / recent.length;
  const s = store.settings().speed;
  let next = s;
  if (rate >= 0.85) next = Math.min(1.5, +(s + 0.05).toFixed(2));
  else if (rate < 0.6) next = Math.max(0.75, +(s - 0.05).toFixed(2));
  if (next !== s) { recent.length = 0; await store.saveSettings({ speed: next }); return next > s ? "up" : "down"; }
  return null;
}

// ---- path ----
export const LESSON_SIZE = 4;
export function lessonsOf(unit) {
  const out = [];
  for (let i = 0; i < unit.items.length; i += LESSON_SIZE) out.push(unit.items.slice(i, i + LESSON_SIZE));
  return out;
}
export const lessonDone = (unitId, n) => !!store.get(`lesson:${unitId}:${n}`);
// nodes: lessons, then the role-play (if any), then a review
export function nodesOf(unit, hasDialogue) {
  const n = lessonsOf(unit).map((items, i) => ({ kind: "lesson", n: i, items }));
  if (hasDialogue) n.push({ kind: "dialogue", n: n.length });
  n.push({ kind: "review", n: n.length });
  return n;
}
export function unitProgress(unit, hasDialogue) {
  const nodes = nodesOf(unit, hasDialogue);
  const done = nodes.filter(nd => lessonDone(unit.id, nd.n)).length;
  return { done, total: nodes.length };
}
// first node that isn't done, across the whole course
export function currentNode(dialogues) {
  for (const u of UNITS) {
    const nodes = nodesOf(u, !!dialogues[u.id]);
    for (const nd of nodes) if (!lessonDone(u.id, nd.n)) return { unit: u.id, n: nd.n };
  }
  return null;
}
export function isUnlocked(unitId, n, dialogues) {
  if (store.settings().unlockAll) return true;
  const cur = currentNode(dialogues);
  if (!cur) return true;
  const ui = UNITS.findIndex(u => u.id === unitId), ci = UNITS.findIndex(u => u.id === cur.unit);
  return ui < ci || (ui === ci && n <= cur.n) || lessonDone(unitId, n);
}
export async function finishLesson(unitId, n, score) {
  const id = `lesson:${unitId}:${n}`, old = store.get(id);
  await store.put({ id, best: Math.max(score, (old && old.best) || 0), times: ((old && old.times) || 0) + 1 });
}

// ---- league (single player: you vs. four rivals paced off your own recent weeks) ----
export const LEAGUES = ["Colmado", "Guagua", "Malecón", "Zona Colonial", "Pico Duarte"];
const RIVALS = ["Yokasta", "Wilkin", "Yaritza", "Franklyn", "Daleisy", "Starlin", "Yeimy", "Rafelito", "Massiel", "Juan Gabriel"];
const weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
function weekXP(start) {
  const days = dayTotals(); let xp = 0;
  for (let i = 0; i < 7; i++) xp += (days[store.today(new Date(start.getTime() + i * DAY))] || {}).xp || 0;
  return xp;
}
function seeded(n) { let x = Math.sin(n) * 10000; return x - Math.floor(x); }
function rivalsFor(start, tier) {
  const prev = [1, 2, 3].map(k => weekXP(new Date(start.getTime() - k * 7 * DAY)));
  const base = Math.max(150, prev.reduce((a, b) => a + b, 0) / 3) * (1 + tier * 0.12);
  const seed = Math.floor(start.getTime() / DAY);
  const factors = [0.55, 0.85, 1.05, 1.35];
  return factors.map((f, i) => ({ name: RIVALS[Math.floor(seeded(seed + i * 7) * RIVALS.length)] + (i ? "" : ""), target: Math.round(base * f * (0.9 + seeded(seed + i) * 0.2)) }));
}
export function league(now = new Date()) {
  const first = Object.keys(dayTotals()).sort()[0];
  const thisWeek = weekStart(now);
  let tier = 0;
  if (first) {
    for (let w = weekStart(dateOf(first)); w < thisWeek; w = new Date(w.getTime() + 7 * DAY)) {
      const mine = weekXP(w), r = rivalsFor(w, tier).map(x => x.target);
      const place = 1 + r.filter(x => x > mine).length;
      if (place <= 2) tier = Math.min(LEAGUES.length - 1, tier + 1); else if (place === 5 && mine < r[0]) tier = Math.max(0, tier - 1);
    }
  }
  const elapsed = Math.min(1, (now - thisWeek) / (7 * DAY));
  const rivals = rivalsFor(thisWeek, tier).map((r, i) => ({ name: r.name, xp: Math.round(r.target * Math.min(1, elapsed * (0.85 + seeded(i + 3) * 0.3))) }));
  const board = [...rivals, { name: "Tú", xp: weekXP(thisWeek), me: true }].sort((a, b) => b.xp - a.xp);
  const daysLeft = Math.ceil((7 * DAY - (now - thisWeek)) / DAY);
  return { tier, name: LEAGUES[tier], board, daysLeft };
}

// ---- achievements ----
export function achievements() {
  const xp = totalXP(), st = longestStreak();
  const strong = store.all("card:").filter(c => c.s >= 21).length;
  const lessons = store.all("lesson:").length;
  const slang = store.all("card:").filter(c => c.last && /^card:(g|p|f|c)-/.test(c.id)).length;
  const calls = ["u-llamo", "u-mami"].every(u => store.all(`lesson:${u}:`).length > 0);
  return [
    { icon: "🔥", name: "En fuego", desc: "7-day streak", have: st, need: 7 },
    { icon: "🏝️", name: "Constante", desc: "30-day streak", have: st, need: 30 },
    { icon: "⭐", name: "Tíguere en training", desc: "Earn 500 XP", have: xp, need: 500 },
    { icon: "🌟", name: "Tíguere de verdad", desc: "Earn 3,000 XP", have: xp, need: 3000 },
    { icon: "📚", name: "Estudioso", desc: "Finish 25 lessons", have: lessons, need: 25 },
    { icon: "🗣️", name: "Hablando claro", desc: "Learn 40 slang words", have: slang, need: 40 },
    { icon: "📞", name: "Dígame", desc: "Finish both phone-call units", have: calls ? 1 : 0, need: 1 },
    { icon: "🧠", name: "Memoria de elefante", desc: "50 phrases strong (3+ weeks)", have: strong, need: 50 },
    { icon: "👂", name: "Oído de oro", desc: "Ear speed 1.3×", have: Math.round(store.settings().speed * 100), need: 130 },
  ];
}

export function stats() {
  const learned = new Set(store.all("card:").map(c => c.id.split(":")[1]));
  return { learned: learned.size, total: ALL_ITEMS.length };
}
