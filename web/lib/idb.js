// One way into the browser's database (IndexedDB) for the three things kept on this device
// apart from the library: the marks, the study pages and the decks. Each used to carry its
// own copy of these two functions.
//
//   const db = database({ name: "gospel-marks", label: "marks", upgrade(db, tx) { ... } });
//   await db.tx("marks", "readonly", (store) => store.get(id));   // resolves with the request's result
//
// upgrade(db, transaction) makes the stores the first time (and on a version change).
// keep: false opens for each piece of work and closes after it (the marks and the studies,
// touched now and then); keep: true holds one connection for the life of the page (the deck,
// written a moment after every change) and lets go of it when another tab needs to upgrade.
// label is the word used in the error a failure rejects with ("the marks database failed").

export function database({ name, version = 1, upgrade, label = name, keep = false, idb = null }) {
  let held = null;
  function open() {
    if (keep && held) return held;
    const opening = new Promise((resolve, reject) => {
      const r = (idb || indexedDB).open(name, version);
      r.onupgradeneeded = () => { if (upgrade) upgrade(r.result, r.transaction); };
      r.onsuccess = () => {
        const db = r.result;
        if (keep) db.onversionchange = () => { db.close(); held = null; };
        resolve(db);
      };
      r.onerror = () => { if (keep) held = null; reject(r.error || new Error(`the ${label} database did not open`)); };
    });
    if (keep) held = opening;
    return opening;
  }
  // work(store) starts the request; the promise settles when the transaction does, so a write
  // that resolved is on disk.
  async function tx(store, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = work(t.objectStore(store));
      const done = () => { if (!keep) db.close(); };
      t.oncomplete = () => { done(); resolve(req ? req.result : undefined); };
      t.onerror = () => { done(); reject(t.error || new Error(`the ${label} database failed`)); };
      t.onabort = () => { done(); reject(t.error || new Error(`the ${label} database failed`)); };
    });
  }
  return { open, tx };
}
