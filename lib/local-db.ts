import { companyIdSchema } from "./company.ts";
import type { Operations } from "./operations";
import {
  mergePerformanceHistory,
  type PerformanceSnapshot,
} from "./performance";
import {
  mergeObservation,
  type Snapshot,
  type Airport,
  type HistoryRun,
} from "./dispatch";
export type LocalRun = HistoryRun & { snapshot: Snapshot };
export type Backup = {
  format: "pilots-dispatch";
  version: 1;
  companyId: string;
  exportedAt: number;
  snapshot: Snapshot | null;
  watch: Airport[];
  runs: LocalRun[];
  operations?: Operations;
};
export function companyDatabase(companyId: string) {
  companyIdSchema.parse(companyId);
  const DB = `pilots-dispatch-${companyId}`,
    MAX_RUNS = 1000,
    RETENTION = 90 * 86400000;
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("Local database is unavailable in this browser."));
        return;
      }
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("state");
        r.result.createObjectStore("runs", { keyPath: "id" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () =>
        reject(
          new Error("Close other Pilots Dispatch tabs to open local storage."),
        );
    });
  }
  async function loadLocal(): Promise<Backup> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["state", "runs"], "readwrite"),
        state = tx.objectStore("state");
      const s = state.get("snapshot"),
        w = state.get("watch"),
        o = state.get("operations"),
        r = tx.objectStore("runs").getAll();
      let retained: LocalRun[] = [];
      r.onsuccess = () => {
        const sorted = (r.result as LocalRun[]).sort((a, b) => b.at - a.at);
        retained = sorted.filter(
          (run, i) => run.at >= Date.now() - RETENTION && i < MAX_RUNS,
        );
        const ids = new Set(retained.map((run) => run.id));
        for (const run of sorted)
          if (!ids.has(run.id)) tx.objectStore("runs").delete(run.id);
      };
      tx.oncomplete = () => {
        db.close();
        resolve({
          format: "pilots-dispatch",
          version: 1,
          companyId,
          exportedAt: Date.now(),
          snapshot: s.result ?? null,
          watch: w.result ?? [],
          runs: retained,
          operations: o.result ?? undefined,
        });
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }
  async function recordLocal(next: Snapshot): Promise<Snapshot> {
    if (next.companyId !== companyId)
      throw new Error("Snapshot belongs to another company");
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(["state", "runs"], "readwrite"),
        state = tx.objectStore("state"),
        runs = tx.objectStore("runs");
      let result: Snapshot;
      let failure: unknown;
      const prior = state.get("snapshot");
      prior.onsuccess = () => {
        try {
          result = mergeObservation(prior.result ?? null, next);
          state.put(result, "snapshot");
          const run: LocalRun = {
            id: crypto.randomUUID(),
            at: result.airFetchedAt,
            status: result.errors.length ? "partial" : "complete",
            changes: result.changes ?? [],
            held: Object.keys(result.air.held).length,
            checked: result.coverage?.checked ?? 0,
            total: result.coverage?.total ?? 0,
            snapshot: { ...result, air: { ...result.air, flights: [] } },
          };
          runs.put(run);
          const all = runs.getAll();
          all.onsuccess = () => {
            const sorted = (all.result as LocalRun[]).sort(
              (a, b) => b.at - a.at,
            );
            for (let i = 0; i < sorted.length; i++)
              if (i >= MAX_RUNS || sorted[i].at < Date.now() - RETENTION)
                runs.delete(sorted[i].id);
          };
        } catch (e) {
          failure = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(
          failure ?? tx.error ?? new Error("Local history could not be saved."),
        );
      };
    });
  }
  async function saveWatch(watch: Airport[]) {
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(watch.slice(0, 24), "watch");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }
  async function importLocal(backup: Backup) {
    if (
      backup.companyId !== companyId ||
      (backup.snapshot && backup.snapshot.companyId !== companyId) ||
      backup.runs.some((r) => r.snapshot.companyId !== companyId) ||
      backup.operations?.performance?.some((row) => row.companyId !== companyId)
    )
      throw new Error("Backup belongs to another company");
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["state", "runs"], "readwrite"),
        state = tx.objectStore("state"),
        runs = tx.objectStore("runs");
      // A restore is a deliberate replacement, so old and imported baselines never mix.
      state.clear();
      runs.clear();
      if (backup.snapshot) state.put(backup.snapshot, "snapshot");
      state.put(backup.watch, "watch");
      if (backup.operations) state.put(backup.operations, "operations");
      for (const run of backup.runs
        .filter((r) => r.at >= Date.now() - RETENTION)
        .sort((a, b) => b.at - a.at)
        .slice(0, MAX_RUNS))
        runs.put(run);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  async function patchOperations(
    patch: Partial<Operations>,
  ): Promise<Operations> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite"),
        state = tx.objectStore("state");
      let value: Operations;
      const r = state.get("operations");
      r.onsuccess = () => {
        const old: Operations = r.result ?? { pilots: [] };
        value = { ...old, ...patch };
        if (patch.pilots) {
          const merged = new Map(old.pilots.map((p) => [p.pid, p]));
          for (const p of patch.pilots)
            if (!merged.has(p.pid) || p.seenAt >= merged.get(p.pid)!.seenAt)
              merged.set(p.pid, p);
          value.pilots = [...merged.values()]
            .sort((a, b) => b.seenAt - a.seenAt)
            .slice(0, 100);
        }
        state.put(value, "operations");
      };
      tx.oncomplete = () => {
        db.close();
        resolve(value);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  async function recordPerformance(
    incoming: PerformanceSnapshot[],
    remove?: {
      scope: "company" | "pilot";
      subjectId: string;
      observedAt: number;
    },
  ): Promise<PerformanceSnapshot[]> {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("state", "readwrite"),
        state = tx.objectStore("state");
      const request = state.get("operations");
      let result: PerformanceSnapshot[] = [],
        failure: unknown;
      request.onsuccess = () => {
        try {
          const operations: Operations = request.result ?? { pilots: [] };
          const previous = (operations.performance ?? []).filter(
            (row) =>
              !remove ||
              row.scope !== remove.scope ||
              row.subjectId !== remove.subjectId ||
              row.observedAt !== remove.observedAt,
          );
          result = mergePerformanceHistory(previous, incoming, companyId);
          state.put({ ...operations, performance: result }, "operations");
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(
          failure ?? tx.error ?? Error("Could not save performance totals."),
        );
      };
    });
  }

  return {
    loadLocal,
    recordLocal,
    saveWatch,
    importLocal,
    patchOperations,
    recordPerformance,
  };
}
export { mergeObservation } from "./dispatch";
