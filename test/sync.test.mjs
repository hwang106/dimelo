// Dímelo sync against InkNotes' sync engine with a pretend OneDrive that, like the real one,
// rejects file names containing ":" (400). Run from the dimelo folder: node test/sync.test.mjs
// (needs the InkNotes folder next to this one).
import assert from "node:assert/strict";
import { syncOnce } from "../../InkNotes/app/js/sync-engine.js";
import { newKeyFile } from "../../InkNotes/app/js/crypt.js";
import { localAdapter } from "../app/js/appsync.js";

function strictDrive() {
  const files = new Map(); let n = 0;
  return {
    files,
    async list(folder) { return [...files].filter(([p]) => p.startsWith(folder + "/")).map(([p, f]) => ({ name: p.slice(folder.length + 1), etag: f.etag })); },
    async read(folder, name) { const f = files.get(folder + "/" + name); return f ? f.bytes.slice() : null; },
    async write(folder, name, bytes) {
      if (/[:"*<>?|]/.test(name)) { const e = new Error("Uploading to OneDrive failed (400)"); e.status = 400; throw e; }
      const etag = `"e${++n}"`; files.set(folder + "/" + name, { bytes: bytes.slice(), etag }); return { etag };
    },
  };
}
function device(recs = []) {
  const m = new Map(recs.map(r => [r.id, structuredClone(r)]));
  return { m, allRaw: () => [...m.values()], get: id => m.get(id), put: async r => { m.set(r.id, structuredClone(r)); } };
}

const { key } = await newKeyFile("test passphrase");
const drive = strictDrive();
const phone = device([
  { id: "card:s-donde:rec", s: 3.7, d: 5, last: 1, due: 2, updated: 100 },
  { id: "day:2026-11-25:ph0ne", xp: 40, lessons: 2, updated: 110 },
  { id: "lesson:u-s:0", best: 100, updated: 120 },
  { id: "card:item:abc123:rec", s: 1, d: 5, last: 1, due: 2, updated: 130 },   // phrase from a clip (id has two colons)
  { id: "settings", goal: 30, speed: 1.1, updated: 140 },
]);
const pc = device([{ id: "day:2026-11-24:pc000", xp: 25, lessons: 1, updated: 90 }]);
const phoneState = {}, pcState = {};

await syncOnce({ drive, local: localAdapter(phone), key, state: phoneState, folder: "dimelo", images: false });
const names = [...drive.files.keys()].sort();
assert.ok(names.every(n => !n.slice(7).includes(":")), "no colons in OneDrive names: " + names);
assert.ok(names.includes("dimelo/card~item~abc123~rec.json"));
console.log("ok - phone uploads", names.length, "files with safe names");

await syncOnce({ drive, local: localAdapter(pc), key, state: pcState, folder: "dimelo", images: false });
assert.deepEqual([...pc.m.keys()].sort(), [...phone.m.keys(), "day:2026-11-24:pc000"].sort());
assert.equal(pc.m.get("card:item:abc123:rec").s, 1);
console.log("ok - PC gets every record back under its real id, and uploads its own");

await syncOnce({ drive, local: localAdapter(phone), key, state: phoneState, folder: "dimelo", images: false });
assert.equal(phone.m.get("day:2026-11-24:pc000").xp, 25);
assert.ok(![...phone.m.keys()].some(k => k.includes("~")), "no ~ ids leak into the app");
console.log("ok - phone gets the PC's XP; no encoded ids stored locally");

// a newer edit on one device wins on the other
pc.m.set("settings", { ...pc.m.get("settings"), speed: 1.25, updated: 500 });
await syncOnce({ drive, local: localAdapter(pc), key, state: pcState, folder: "dimelo", images: false });
await syncOnce({ drive, local: localAdapter(phone), key, state: phoneState, folder: "dimelo", images: false });
assert.equal(phone.m.get("settings").speed, 1.25);
console.log("ok - newer settings edit reaches the other device");

// Repair: a device that "synced" but is missing a file gets it by listing the folder in full.
{
  const { repair } = await import("../app/js/appsync.js");
  const { sealJSON, unsealJSON } = await import("../../InkNotes/app/js/crypt.js");
  const d = strictDrive();
  await d.write("dimelo", "lesson~u-s~0.json", await sealJSON(key, { id: "lesson~u-s~0", best: 100, updated: 200 }, "dimelo/lesson~u-s~0.json"));
  await d.write("dimelo", "settings.json", await sealJSON(key, { id: "settings", goal: 30, updated: 50 }, "dimelo/settings.json"));
  const otherKey = (await newKeyFile("some other passphrase")).key;
  await d.write("dimelo", "day~2026-11-25~ph0ne.json", await sealJSON(otherKey, { id: "day~2026-11-25~ph0ne", xp: 40, updated: 210 }, "dimelo/day~2026-11-25~ph0ne.json"));
  await d.write("dimelo", "card~x~rec.json", await sealJSON(key, { id: "card~y~rec", updated: 220 }, "dimelo/card~x~rec.json"));
  const surface = device([{ id: "settings", goal: 50, updated: 300 }]);
  const r = await repair({ drive: d, unsealJSON, key, st: surface });
  assert.equal(r.got, 1); assert.equal(r.same, 1); assert.equal(r.bad.length, 2);
  assert.equal(surface.m.get("lesson:u-s:0").best, 100);
  assert.equal(surface.m.get("settings").goal, 50, "newer local settings kept");
  console.log("ok - repair downloads the missing lesson, keeps newer local data, reports:", r.bad.join(" | "));
}

// The automatic check opens only files it hasn't checked before (or that changed since).
{
  const { repair } = await import("../app/js/appsync.js");
  const { sealJSON, unsealJSON } = await import("../../InkNotes/app/js/crypt.js");
  const d = strictDrive();
  let reads = 0; const read = d.read.bind(d); d.read = (...a) => { reads++; return read(...a); };
  const put = async (name, rec) => d.write("dimelo", name, await sealJSON(key, rec, "dimelo/" + name));
  await put("lesson~u-s~0.json", { id: "lesson~u-s~0", best: 100, updated: 200 });
  await put("day~2026-11-25~ph0ne.json", { id: "day~2026-11-25~ph0ne", xp: 20, updated: 210 });
  let mem = {}; const seen = { get: () => ({ ...mem }), set: v => { mem = v; } };
  const surface = device();
  const deps = { drive: d, unsealJSON, key, st: surface, seen };

  let r = await repair(deps, { onlyChanged: true });
  assert.equal(r.got, 2); assert.equal(reads, 2);
  r = await repair(deps, { onlyChanged: true });
  assert.equal(r.opened, 0); assert.equal(reads, 2, "nothing new: no files opened");
  // the phone finishes another lesson and earns more XP today
  await put("lesson~u-s~1.json", { id: "lesson~u-s~1", best: 90, updated: 300 });
  await put("day~2026-11-25~ph0ne.json", { id: "day~2026-11-25~ph0ne", xp: 45, updated: 310 });
  r = await repair(deps, { onlyChanged: true });
  assert.equal(r.opened, 2); assert.equal(r.got, 2); assert.equal(reads, 4);
  assert.equal(surface.m.get("day:2026-11-25:ph0ne").xp, 45);
  assert.ok(surface.m.get("lesson:u-s:1"));
  console.log("ok - automatic check opens only new or changed files (4 reads over 3 checks)");
}
