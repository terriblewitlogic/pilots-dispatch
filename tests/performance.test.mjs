import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  EMPTY_TOTALS,
  mergePerformanceHistory,
  parsePerformanceImport,
  performanceReport,
  performanceSnapshotSchema,
  performanceCsv,
} from "../lib/performance.ts";
import { companyDatabase } from "../lib/local-db.ts";
import { parseBackup } from "../lib/backup.ts";

const NOW = 1800000000000,
  DAY = 86400000;
function row(observedAt, totals = {}, extra = {}) {
  return {
    companyId: "testco",
    scope: "company",
    subjectId: "testco",
    label: "Test company",
    observedAt,
    source: "manual",
    totals: { ...EMPTY_TOTALS, earned: 0, ...totals },
    ...extra,
  };
}
function report(rows, extra = {}) {
  return performanceReport(
    rows,
    "testco",
    extra.scope ?? "company",
    extra.subjectId ?? "testco",
    NOW - 7 * DAY,
    NOW,
  );
}

test("company sync import maps earnings/jobs/treasury without inventing distance or pilot totals", () => {
  const result = parsePerformanceImport(
    {
      version: 1,
      fetchedAt: NOW,
      viewer: { pid: "pilot1", token: "discard-me" },
      company: {
        id: "testco",
        name: "Test",
        members: { pilot1: { earned: 999 } },
      },
      stats: { earned: 12000, jobs: 24, extra: "discard" },
      treasury: 2500,
      acct: "secret",
      log: ["private"],
    },
    "testco",
    NOW,
  );
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].totals, {
    earned: 12000,
    jobs: 24,
    balance: 2500,
    distanceNm: null,
    hours: null,
    flights: null,
  });
  assert.equal(result[0].scope, "company");
  assert.equal(result[0].source, "company-sync");
  assert.doesNotMatch(
    JSON.stringify(result),
    /secret|discard|members|private|pilot1/,
  );
});

test("validation distinguishes missing from zero and rejects invalid inputs", () => {
  assert.equal(performanceSnapshotSchema.parse(row(NOW)).totals.earned, 0);
  for (const totals of [
    EMPTY_TOTALS,
    { ...EMPTY_TOTALS, earned: -1 },
    { ...EMPTY_TOTALS, distanceNm: Infinity },
    { ...EMPTY_TOTALS, flights: 1.5 },
    { ...EMPTY_TOTALS, jobs: -1 },
  ]) {
    assert.equal(
      performanceSnapshotSchema.safeParse(row(NOW, {}, { totals })).success,
      false,
    );
  }
  assert.equal(
    performanceSnapshotSchema.safeParse(
      row(NOW, {}, { subjectId: "another-company" }),
    ).success,
    false,
  );
});

test("import rejects wrong companies, future/expired times and strips unknown fields", () => {
  const input = {
    format: "pilots-performance",
    version: 1,
    observations: [row(NOW, { earned: 42 }, { token: "secret" })],
    password: "secret",
  };
  assert.equal(
    parsePerformanceImport(input, "testco", NOW)[0].source,
    "import",
  );
  assert.doesNotMatch(
    JSON.stringify(parsePerformanceImport(input, "testco", NOW)),
    /secret|token|password/,
  );
  assert.throws(
    () => parsePerformanceImport(input, "another", NOW),
    /another company/,
  );
  assert.throws(
    () => mergePerformanceHistory([], [row(NOW + 1)], "testco", NOW),
    /future/,
  );
  assert.throws(
    () => mergePerformanceHistory([], [row(NOW - 91 * DAY)], "testco", NOW),
    /90 days/,
  );
});

test("history replaces duplicate timestamps per identity and never combines pilots with company", () => {
  const pilot = { scope: "pilot", subjectId: "pilot1", label: "Pilot" };
  const result = mergePerformanceHistory(
    [row(NOW, { earned: 10 }), row(NOW, { earned: 50 }, pilot)],
    [row(NOW, { earned: 20 })],
    "testco",
    NOW,
  );
  assert.equal(result.length, 2);
  assert.equal(report(result).metrics.earned.total, 20);
  assert.equal(report(result, pilot).metrics.earned.total, 50);
  assert.equal(
    report(result, { scope: "pilot", subjectId: "pilot2" }).latest,
    null,
  );
});

test("period deltas and rates use cumulative counters, allowing balance to decrease", () => {
  const r = report([
    row(NOW - DAY, {
      earned: 1000,
      distanceNm: 100,
      hours: 10,
      flights: 5,
      jobs: 2,
      balance: 500,
    }),
    row(NOW, {
      earned: 1600,
      distanceNm: 250,
      hours: 12,
      flights: 7,
      jobs: 4,
      balance: 300,
    }),
  ]);
  assert.equal(r.metrics.earned.change, 600);
  assert.equal(r.metrics.distanceNm.change, 150);
  assert.equal(r.metrics.balance.change, -200);
  assert.equal(r.periodPerHour, 300);
  assert.equal(r.periodPerFlight, 300);
  assert.equal(r.perHour, 1600 / 12);
});

test("insufficient history, missing fields, zero denominators and resets stay unavailable", () => {
  const single = report([row(NOW, { hours: 0, flights: 0 })]);
  assert.equal(single.metrics.earned.change, null);
  assert.equal(single.metrics.distanceNm.total, null);
  assert.equal(single.perFlight, null);
  const reset = report([
    row(NOW - 3 * DAY, { earned: 500, hours: 5 }),
    row(NOW - 2 * DAY, { earned: 100, hours: 6 }),
    row(NOW, { earned: 800, hours: 7 }),
  ]);
  assert.equal(reset.metrics.earned.reset, true);
  assert.equal(reset.metrics.earned.change, null);
  assert.equal(reset.periodPerHour, null);
  const missingLatest = report([row(NOW - DAY, { distanceNm: 100 }), row(NOW)]);
  assert.equal(missingLatest.metrics.distanceNm.total, null);
});

test("ratios use matching observations rather than unrelated time windows", () => {
  const r = report([
    row(NOW - 3 * DAY, { earned: 100, hours: 1 }),
    row(NOW - 2 * DAY, { earned: 200, hours: null }),
    row(NOW - DAY, { earned: 300, hours: 2 }),
    row(NOW, { earned: null, hours: 10 }),
  ]);
  assert.equal(r.periodPerHour, 200);
  assert.equal(r.perHour, null);
  const disjoint = report([
    row(NOW - DAY, { earned: 100 }),
    row(NOW, { earned: null, hours: 4 }),
  ]);
  assert.equal(disjoint.periodPerHour, null);
});

test("period filtering excludes expired/future entries without changing dated latest totals", () => {
  const r = report([
    row(NOW - 8 * DAY, { earned: 100 }),
    row(NOW - DAY, { earned: 200 }),
    row(NOW + 1, { earned: 900 }),
  ]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.metrics.earned.total, 200);
  assert.equal(r.metrics.earned.change, null);
});

test("CSV uses numeric cells and blank unknowns, without arbitrary labels", () => {
  const csv = performanceCsv([row(NOW, { earned: 0 }, { label: "=EVIL()" })]);
  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /company,manual,0,,,,,/);
  assert.doesNotMatch(csv, /EVIL/);
});

test("local persistence merges concurrent imports, preserves other operations, and isolates backups", async () => {
  const now = Date.now(),
    db = companyDatabase("testco"),
    other = companyDatabase("otherco");
  await db.patchOperations({
    pilots: [{ pid: "pilot1", cs: "PILOT", seenAt: now }],
  });
  await Promise.all([
    db.recordPerformance([row(now - 1000, { earned: 100 })]),
    db.recordPerformance([
      row(now, { earned: 200 }, { scope: "pilot", subjectId: "pilot1" }),
    ]),
  ]);
  const local = await db.loadLocal();
  assert.equal(local.operations.performance.length, 2);
  assert.equal(local.operations.pilots.length, 1);
  assert.equal((await other.loadLocal()).operations, undefined);
  assert.equal(parseBackup(local).operations.performance.length, 2);
  await assert.rejects(other.recordPerformance([row(now)]), /another company/);
  const bad = { ...local, companyId: "otherco" };
  assert.throws(() => parseBackup(bad), /mixed companies/);
  await assert.rejects(other.importLocal(bad), /another company/);
  await db.recordPerformance([], {
    scope: "pilot",
    subjectId: "pilot1",
    observedAt: now,
  });
  assert.equal((await db.loadLocal()).operations.performance.length, 1);
});

test("history prunes expired observations and bounds storage", () => {
  const existing = Array.from({ length: 1005 }, (_, i) => row(NOW - i));
  const result = mergePerformanceHistory(
    [...existing, row(NOW - 91 * DAY)],
    [],
    "testco",
    NOW,
  );
  assert.equal(result.length, 1000);
  assert.equal(result[0].observedAt, NOW);
  assert.equal(result.at(-1).observedAt, NOW - 999);
});
