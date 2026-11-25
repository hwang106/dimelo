// Everything Dímelo saves is a record { id, updated, ... } in one IndexedDB store, so the
// OneDrive sync can treat them all alike. Kinds (by id prefix):
//   card:<item>:<rec|pro>   spaced-repetition state for one skill of one item
//   day:<date>:<device>     XP, minutes and lessons done on that day on that device
//   lesson:<unit>:<n>       a finished lesson (best score)
//   buy:<ts>  freeze:<date> streak-freeze purchases and the days they covered
//   clip:<id>  item:<id>    your YouTube clips and the phrases you added from them
//   settings                daily goal, ear speed, filters

const DB = "dimelo", VER = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { r.result.createObjectStore("rec", { keyPath: "id" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction("rec", mode), s = t.objectStore("rec");
    let out; Promise.resolve(fn(s)).then(v => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
  });
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const cache = new Map();
let loaded = false;
const listeners = new Set();
export const onChange = fn => listeners.add(fn);

export async function load() {
  if (loaded) return;
  const all = await tx("readonly", s => req(s.getAll()));
  for (const r of all) cache.set(r.id, r);
  loaded = true;
}
export const get = id => cache.get(id);
export const all = (prefix = "") => [...cache.values()].filter(r => r.id.startsWith(prefix) && !r.deleted);
export const allRaw = () => [...cache.values()];

let syncHook = () => {};
export const setSyncHook = fn => { syncHook = fn; };

export async function put(rec, { fromSync = false } = {}) {
  if (!fromSync) rec.updated = Date.now();
  cache.set(rec.id, rec);
  await tx("readwrite", s => s.put(rec));
  if (!fromSync) syncHook();
  listeners.forEach(fn => fn(rec, fromSync));
  return rec;
}
export async function putMany(recs) {
  const now = Date.now();
  for (const r of recs) { r.updated = now; cache.set(r.id, r); }
  await tx("readwrite", s => recs.forEach(r => s.put(r)));
  syncHook();
}
export async function wipe() {
  cache.clear();
  await tx("readwrite", s => s.clear());
}

// ---- small helpers on top ----
export const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export function device() {
  let id = null;
  try { id = localStorage.getItem("dimelo-dev"); } catch (_) {}
  if (!id) { id = Math.random().toString(36).slice(2, 8); try { localStorage.setItem("dimelo-dev", id); } catch (_) {} }
  return id;
}
export const DEFAULT_SETTINGS = { goal: 30, speed: 1.0, showVulgar: true, unlockAll: false, sounds: true, voiceMode: "both", micOn: true };
export function settings() { return { ...DEFAULT_SETTINGS, ...(get("settings") || {}) }; }
export async function saveSettings(patch) { await put({ ...settings(), ...patch, id: "settings" }); }
