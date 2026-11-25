// OneDrive sync, borrowed from InkNotes on the same website (hwang106.github.io/inknotes/js/).
// Same Microsoft sign-in and passphrase as InkNotes/InkTasks/InkBoard; Dímelo's records go in the
// encrypted app folder under dimelo/. Where InkNotes isn't served (local testing), the sync
// button stays hidden and everything stays on the device.
import * as store from "./store.js";
import { $, el } from "./ui.js";

let sync = null;   // the running sync, once started

export const toDriveId = id => id.replace(/:/g, "~");
export const fromDriveId = id => id.replace(/~/g, ":");
const toDrive = r => ({ ...r, id: toDriveId(r.id) });

// st: anything with allRaw(), get(id) and put(record, { fromSync }) (the real store, or a test double)
export function localAdapter(st) {
  return {
    // OneDrive file names can't contain ":", and each record syncs as <id>.json,
    // so ids travel with "~" in place of ":" (no Dímelo id uses "~").
    all: async () => st.allRaw().map(toDrive),
    get: async id => { const r = st.get(fromDriveId(id)); return r && toDrive(r); },
    // per record, the most recent edit wins (XP is per device per day, so it never clashes)
    put: async r => { r = { ...r, id: fromDriveId(r.id) }; const l = st.get(r.id); if (!l || (r.updated || 0) >= (l.updated || 0)) await st.put(r, { fromSync: true }); },
  };
}

export async function startSync() {
  let mod, ui;
  try { [mod, ui] = await Promise.all([import("/inknotes/js/sync.js"), import("/inknotes/js/sync-ui.js")]); }
  catch (_) { return; }
  sync = mod.createSync({
    folder: "dimelo", stateKey: "syncState:dimelo",
    local: localAdapter(store),
  });
  const btn = $("#syncBtn");
  const syncUI = ui.mountSyncUI({ sync, button: btn, appName: "your Spanish progress", toast: (await import("./ui.js")).toast, isMain: () => true });
  store.setSyncHook(() => sync.soon());
  await sync.start({ allowRedirect: true, onStatus: st => syncUI.render(st) });
}

// Repair: list the OneDrive folder in full (not through the saved change feed), open every file,
// and keep anything newer than this device's copy. Returns { got, same, bad: [reasons] }.
// deps lets the test pass a pretend drive; normally it uses InkNotes' OneDrive code and key.
export async function repair(deps = null) {
  if (!deps) {
    const [{ graphDrive }, { unsealJSON }, ink] = await Promise.all([import("/inknotes/js/graph.js"), import("/inknotes/js/crypt.js"), import("/inknotes/js/store.js")]);
    const key = await ink.store.getMeta("key");
    if (!key) throw new Error("This device doesn't have the sync passphrase yet. Tap ☁️ to enter it.");
    deps = { drive: graphDrive, unsealJSON, key, st: store };
  }
  const { drive, unsealJSON, key, st } = deps;
  const files = (await drive.list("dimelo")).filter(f => f.name.endsWith(".json"));
  let got = 0, same = 0, next = 0;
  const bad = [];
  const one = async f => {
    const id = fromDriveId(f.name.slice(0, -5));
    try {
      const r = await unsealJSON(key, await drive.read("dimelo", f.name, f), "dimelo/" + f.name);
      if (!r || fromDriveId(r.id || "") !== id) { bad.push(`${f.name}: the record inside is named “${r && r.id}”`); return; }
      const l = st.get(id);
      if (!l || (r.updated || 0) > (l.updated || 0)) { await st.put({ ...r, id }, { fromSync: true }); got++; } else same++;
    } catch (e) { bad.push(`${f.name}: ${e.name === "OperationError" ? "couldn't decrypt (different passphrase?)" : e.message}`); }
  };
  await Promise.all(Array.from({ length: 6 }, async () => { while (next < files.length) await one(files[next++]); }));
  return { got, same, bad };
}

// Me → Sync details: what this device has, what OneDrive has, and buttons to sync or re-download.
// Run it on two devices to see which one is out of step.
const when = t => (t ? new Date(t).toLocaleString() : "never");
export async function renderSyncDetails(box, version) {
  const line = (k, v) => el("div", { class: "kv" }, el("span", {}, k), el("b", {}, v));
  const lessons = store.all("lesson:").length, days = store.all("day:").length, cards = store.all("card:").length;
  const rows = [line("App version", version), line("On this device", `${lessons} lessons · ${cards} cards · ${days} day logs`)];
  if (!sync) { box.replaceChildren(...rows, el("p", { class: "muted small" }, "Sync isn't available here (it needs the InkNotes site alongside).")); return; }
  const st = sync.status, acct = sync.account();
  rows.push(line("Microsoft account", acct ? acct.user || acct.name || "signed in" : "not signed in"));
  rows.push(line("Sync status", st.state + (st.message ? ": " + st.message : "")));
  rows.push(line("Last synced", when(st.last)));
  const remote = el("b", {}, acct ? "checking…" : "—");
  rows.push(el("div", { class: "kv" }, el("span", {}, "In OneDrive"), remote));
  const now = el("button", { class: "btn small", onclick: () => { sync.now(); setTimeout(() => renderSyncDetails(box, version), 4000); } }, "Sync now");
  const again = el("button", { class: "btn small ghost", onclick: async () => {
    // forget what this device thinks it already has, so the next pass compares every file again
    const ink = await import("/inknotes/js/store.js");
    await ink.store.deleteMeta("syncState:dimelo");
    sync.now(); setTimeout(() => renderSyncDetails(box, version), 6000);
  } }, "Re-check everything");
  const out = el("div", { class: "small" });
  const fix = el("button", { class: "btn small go", onclick: async () => {
    fix.disabled = true; out.textContent = "Checking every file in OneDrive…";
    try {
      const r = await repair();
      out.replaceChildren(el("p", {}, `Downloaded ${r.got} · already up to date ${r.same}` + (r.bad.length ? ` · couldn't use ${r.bad.length}:` : "")),
        ...r.bad.slice(0, 8).map(b => el("div", { class: "muted" }, "• " + b)));
      if (r.got) out.append(el("p", {}, "Your progress is updated. Check the Learn tab."));
    } catch (e) { out.textContent = "Couldn't check: " + e.message; }
    fix.disabled = false;
  } }, "Download what's missing");
  box.replaceChildren(...rows, el("div", { class: "row" }, fix, now, again), out);
  if (!acct) return;
  try {
    const { graphDrive } = await import("/inknotes/js/graph.js");
    const files = await graphDrive.list("dimelo");
    const n = p => files.filter(f => f.name.startsWith(p)).length;
    remote.textContent = `${n("lesson~")} lessons · ${n("card~")} cards · ${n("day~")} day logs`;
  } catch (e) { remote.textContent = "couldn't check (" + e.message + ")"; }
}
