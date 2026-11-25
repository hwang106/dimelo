// OneDrive sync, borrowed from InkNotes on the same website (hwang106.github.io/inknotes/js/).
// Same Microsoft sign-in and passphrase as InkNotes/InkTasks/InkBoard; Dímelo's records go in the
// encrypted app folder under dimelo/. Where InkNotes isn't served (local testing), the sync
// button stays hidden and everything stays on the device.
import * as store from "./store.js";
import { $ } from "./ui.js";

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
  const sync = mod.createSync({
    folder: "dimelo", stateKey: "syncState:dimelo",
    local: localAdapter(store),
  });
  const btn = $("#syncBtn");
  const syncUI = ui.mountSyncUI({ sync, button: btn, appName: "your Spanish progress", toast: (await import("./ui.js")).toast, isMain: () => true });
  store.setSyncHook(() => sync.soon());
  await sync.start({ allowRedirect: true, onStatus: st => syncUI.render(st) });
}
