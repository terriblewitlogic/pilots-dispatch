import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SNAPSHOT } from "../lib/dispatch.ts";
import {
  companyAnalytics,
  territoryMetrics,
  analyticsCsv,
} from "../lib/analytics.ts";

function snapshot(at, codes, companyId = "company1") {
  return {
    ...EMPTY_SNAPSHOT,
    companyId,
    airFetchedAt: at,
    air: {
      now: at,
      flights: [],
      held: Object.fromEntries(
        codes.map((code) => [
          code,
          { co: companyId, v: 10000, lat: 30, lon: -98 },
        ]),
      ),
    },
    airports: codes.map((code) => ({ code, name: code, lat: 30, lon: -98 })),
  };
}
const run = (snapshot) => ({
  id: String(snapshot.airFetchedAt),
  at: snapshot.airFetchedAt,
  snapshot,
  changes: [],
});
const history = [
  snapshot(1000, ["A", "B"]),
  snapshot(2000, ["B", "C"]),
  snapshot(3000, ["A", "C", "D"]),
];

test("analytics counts gains, repeat control changes, and endpoint retention", () => {
  const report = companyAnalytics(history[2], history.map(run), 1000, 4000);
  assert.equal(report.gains, 3);
  assert.equal(report.losses, 2);
  assert.equal(report.net, 1);
  assert.equal(report.retention, 50);
  assert.equal(report.retained, 1);
  assert.equal(report.current.held, 3);
  assert.equal(report.current.points, 30000);
});

test("period comparison starts at first in-window observation and includes boundaries", () => {
  const report = companyAnalytics(history[2], history.map(run), 2000, 3000);
  assert.equal(report.baselineAt, 2000);
  assert.equal(report.endAt, 3000);
  assert.equal(report.gains, 2);
  assert.equal(report.losses, 1);
  assert.equal(report.trend.length, 2);
});

test("baseline-only and empty dashboards do not fabricate trends or retention", () => {
  const baseline = companyAnalytics(history[0], [], 0, 4000);
  assert.equal(baseline.gains, null);
  assert.equal(baseline.net, null);
  assert.equal(baseline.retention, null);
  const empty = companyAnalytics(EMPTY_SNAPSHOT, [], 0, 4000);
  assert.equal(empty.current, null);
  assert.deepEqual(empty.trend, []);
});

test("stale current observations remain dated KPIs but do not create period history", () => {
  const report = companyAnalytics(history[2], history.map(run), 3500, 4000);
  assert.equal(report.current.at, 3000);
  assert.equal(report.net, null);
  assert.deepEqual(report.trend, []);
});

test("company isolation, deduplication, chronological ordering, and latest unsaved observation", () => {
  const stale = snapshot(3000, ["STALE"]);
  const report = companyAnalytics(
    history[2],
    [
      run(stale),
      run(history[1]),
      run(history[0]),
      run(history[1]),
      run(snapshot(1500, ["FOREIGN"], "other")),
      run(snapshot(5000, ["FUTURE"])),
    ],
    0,
    4000,
  );
  assert.deepEqual(
    report.trend.map((p) => p.at),
    [1000, 2000, 3000],
  );
  assert.equal(report.trend[2].held, 3);
  assert.equal(report.gains, 3);
  assert.equal(
    companyAnalytics(snapshot(5000, ["A"]), [], 0, 4000).current,
    null,
  );
});

test("missing and failed standings remain unknown instead of safe", () => {
  const s = snapshot(1000, ["A", "B", "C", "D"]);
  s.airports = s.airports.filter((a) => a.code !== "D");
  const board = (code, rival) => ({
    code,
    fetchedAt: 1000,
    cos: {},
    list: [
      { id: "company1", value: 10000 },
      { id: "rival", value: rival },
    ],
  });
  s.boards = {
    A: board("A", 9000),
    B: board("B", 7000),
    C: { ...board("C", 1000), error: "Failed refresh" },
  };
  const metrics = territoryMetrics(s, 40);
  assert.equal(metrics.held, 4);
  assert.equal(metrics.verified, 2);
  assert.equal(metrics.unknown, 2);
  assert.equal(metrics.urgent, 1);
  assert.equal(metrics.watch, 1);
  assert.equal(metrics.secure, 0);
  assert.equal(metrics.coverage, 50);
  assert.equal(territoryMetrics(s, 20).secure, 1);
});

test("zero holdings are valid zero metrics with undefined coverage and retention", () => {
  const empty = snapshot(1000, []),
    next = snapshot(2000, ["A"]);
  assert.equal(territoryMetrics(empty, 20).held, 0);
  assert.equal(territoryMetrics(empty, 20).coverage, null);
  assert.equal(territoryMetrics(empty, 20).points, 0);
  const report = companyAnalytics(next, [run(empty)], 0, 3000);
  assert.equal(report.retention, null);
  assert.equal(report.gains, 1);
  assert.equal(report.losses, 0);
});

test("CSV exports observed timestamps and computed metric values", () => {
  const report = companyAnalytics(history[2], history.map(run), 0, 4000);
  const rows = analyticsCsv(report.trend).split("\r\n");
  assert.equal(rows.length, 4);
  assert.equal(rows[3], "1970-01-01T00:00:03.000Z,3,30000,0,0,0,3");
  assert.match(rows[0], /^observed_at_utc,/);
});
