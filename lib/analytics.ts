import { assess, type Snapshot } from "./dispatch";
import type { LocalRun } from "./local-db";

export function territoryMetrics(snapshot: Snapshot, threshold: number) {
  // Include holdings whose standings were omitted by the bounded refresh batch.
  const airports = new Map(snapshot.airports.map((a) => [a.code, a]));
  for (const [code, holding] of Object.entries(snapshot.air.held)) {
    if (!airports.has(code))
      airports.set(code, {
        code,
        name: code,
        lat: holding.lat,
        lon: holding.lon,
      });
  }
  const holdings = assess(
    { ...snapshot, airports: [...airports.values()] },
    [],
    threshold,
  ).filter((a) => a.held);
  const verified = holdings.filter((a) => a.verified).length;
  return {
    at: snapshot.airFetchedAt,
    held: holdings.length,
    points: Object.values(snapshot.air.held).reduce((sum, h) => sum + h.v, 0),
    verified,
    unknown: holdings.length - verified,
    urgent: holdings.filter((a) => a.status === "urgent").length,
    watch: holdings.filter((a) => a.status === "watch").length,
    secure: holdings.filter((a) => a.status === "secure").length,
    coverage: holdings.length ? (verified / holdings.length) * 100 : null,
    holdings,
  };
}

export function companyAnalytics(
  snapshot: Snapshot,
  runs: LocalRun[],
  since: number,
  now: number,
  threshold = 20,
) {
  const hasCurrent = snapshot.airFetchedAt > 0 && snapshot.airFetchedAt <= now;
  const observations = new Map<number, Snapshot>();
  for (const run of runs) {
    const s = run.snapshot;
    if (
      hasCurrent &&
      s.companyId === snapshot.companyId &&
      s.airFetchedAt >= since &&
      s.airFetchedAt > 0 &&
      s.airFetchedAt <= snapshot.airFetchedAt
    ) {
      observations.set(s.airFetchedAt, s);
    }
  }
  if (hasCurrent && snapshot.airFetchedAt >= since)
    observations.set(snapshot.airFetchedAt, snapshot);
  const ordered = [...observations.values()].sort(
    (a, b) => a.airFetchedAt - b.airFetchedAt,
  );
  const comparable = ordered.length >= 2;
  let gains = 0,
    losses = 0;
  for (let i = 1; i < ordered.length; i++) {
    const before = ordered[i - 1].air.held,
      after = ordered[i].air.held;
    gains += Object.keys(after).filter(
      (code) => !Object.hasOwn(before, code),
    ).length;
    losses += Object.keys(before).filter(
      (code) => !Object.hasOwn(after, code),
    ).length;
  }
  const first = ordered[0],
    last = ordered.at(-1);
  const baselineCodes = Object.keys(first?.air.held ?? {});
  const retained = baselineCodes.filter(
    (code) => !!last?.air.held[code],
  ).length;
  return {
    current: hasCurrent ? territoryMetrics(snapshot, threshold) : null,
    trend: ordered.map((s) => territoryMetrics(s, threshold)),
    baselineAt: first?.airFetchedAt ?? null,
    endAt: last?.airFetchedAt ?? null,
    gains: comparable ? gains : null,
    losses: comparable ? losses : null,
    net: comparable ? gains - losses : null,
    retention:
      comparable && baselineCodes.length
        ? (retained / baselineCodes.length) * 100
        : null,
    retained: comparable ? retained : null,
    baselineHeld: baselineCodes.length,
  };
}

export function analyticsCsv(
  trend: ReturnType<typeof companyAnalytics>["trend"],
) {
  return [
    "observed_at_utc,airports_held,held_airport_points,verified_holdings,urgent_holdings,watch_holdings,unverified_holdings",
    ...trend.map((p) =>
      [
        new Date(p.at).toISOString(),
        p.held,
        p.points,
        p.verified,
        p.urgent,
        p.watch,
        p.unknown,
      ].join(","),
    ),
  ].join("\r\n");
}
