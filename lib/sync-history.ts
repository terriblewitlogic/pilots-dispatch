import { syncSnapshotSchema, type SyncSnapshot } from "./sync-data";
const NAME = "pilots-dispatch-sync-history-v1";
const STORE = "snapshots";
const LIMIT = 200,
  RETENTION = 90 * 86400000;
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, {
        keyPath: ["company.id", "fetchedAt"],
      });
      store.createIndex("company", "company.id");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("Local history could not be opened."));
  });
}
export async function readSyncHistory(
  companyId?: string,
): Promise<SyncSnapshot[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"),
      store = tx.objectStore(STORE);
    const request = companyId
      ? store.index("company").getAll(companyId)
      : store.getAll();
    request.onsuccess = () => {
      for (const row of request.result)
        if (row.fetchedAt < Date.now() - RETENTION)
          store.delete([row.company.id, row.fetchedAt]);
    };
    tx.oncomplete = () => {
      db.close();
      resolve(
        request.result
          .filter(
            (row: SyncSnapshot) => row.fetchedAt >= Date.now() - RETENTION,
          )
          .flatMap((raw: unknown) => {
            const parsed = syncSnapshotSchema.safeParse(raw);
            return parsed.success ? [parsed.data] : [];
          })
          .sort(
            (a: SyncSnapshot, b: SyncSnapshot) => b.fetchedAt - a.fetchedAt,
          ),
      );
    };
    tx.onerror = () => {
      db.close();
      reject(Error("Local history could not be read."));
    };
  });
}
export async function saveSyncSnapshot(input: SyncSnapshot): Promise<void> {
  // Parse again to strip unrecognized fields before anything reaches IndexedDB.
  const snapshot = syncSnapshotSchema.parse(input),
    db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"),
      store = tx.objectStore(STORE);
    const request = store.index("company").getAll(snapshot.company.id);
    request.onsuccess = () => {
      const rows = (request.result as SyncSnapshot[])
        .filter((s) => s.fetchedAt !== snapshot.fetchedAt)
        .concat(snapshot)
        .sort((a, b) => b.fetchedAt - a.fetchedAt);
      store.put(snapshot);
      rows.forEach((row, i) => {
        if (i >= LIMIT || row.fetchedAt < Date.now() - RETENTION)
          store.delete([snapshot.company.id, row.fetchedAt]);
      });
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(Error("Fresh data could not be saved."));
    };
  });
}
export async function clearSyncHistory(companyId: string): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite"),
      store = tx.objectStore(STORE),
      cursor = store.index("company").openKeyCursor(companyId);
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (c) {
        store.delete(c.primaryKey);
        c.continue();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(Error("History could not be cleared."));
    };
  });
}
