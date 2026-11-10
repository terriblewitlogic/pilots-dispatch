import type { Change, Snapshot } from "./dispatch";
import type { LocalRun } from "./local-db";

export type RecentLoss = {
  code: string;
  name: string;
  from: number;
  to: number;
  regained: boolean;
};

export function recentlyLostAirports(
  snapshot: Snapshot,
  runs: LocalRun[],
  since: number,
  now: number,
): RecentLoss[] {
  const losses = new Map<string, Change>();
  const names = new Map<string, string>();
  const observations = runs
    .filter((run) => run.snapshot.companyId === snapshot.companyId)
    .sort((a, b) => a.at - b.at);
  function collect(changes: Change[]) {
    for (const change of changes) {
      if (
        change.kind !== "lost" ||
        change.to < since ||
        change.to > now ||
        change.to > snapshot.airFetchedAt
      )
        continue;
      const previous = losses.get(change.code);
      if (!previous || change.to > previous.to) losses.set(change.code, change);
    }
  }
  for (const run of observations) {
    for (const airport of run.snapshot.airports)
      names.set(airport.code, airport.name);
    collect(run.changes);
  }
  // Include the latest observation even when its local history save failed.
  for (const airport of snapshot.airports)
    names.set(airport.code, airport.name);
  collect(snapshot.changes ?? []);
  return [...losses.values()]
    .sort((a, b) => b.to - a.to || a.code.localeCompare(b.code))
    .map((loss) => ({
      code: loss.code,
      name: names.get(loss.code) ?? loss.code,
      from: loss.from,
      to: loss.to,
      regained: !!snapshot.air.held[loss.code],
    }));
}
