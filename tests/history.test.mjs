import { test } from "node:test";
import assert from "node:assert/strict";
import { compareSnapshots, mergeObservation, assess } from "../lib/dispatch.ts";
import { parseBackup } from "../lib/backup.ts";
const COMPANY = "testco01";
function snapshot({
  time = 1000,
  held = true,
  mine = 10000,
  rival = 2000,
  error = false,
} = {}) {
  return {
    companyId: COMPANY,
    air: {
      now: time,
      held: held ? { TEST: { co: COMPANY, v: mine, lat: 30, lon: -98 } } : {},
      flights: [],
    },
    airFetchedAt: time,
    generatedAt: time,
    airports: [{ code: "TEST", name: "Test airport", lat: 30, lon: -98 }],
    boards: {
      TEST: {
        code: "TEST",
        list: [
          { id: COMPANY, value: mine },
          { id: "RIVAL", value: rival },
        ].sort((a, b) => b.value - a.value),
        cos: { RIVAL: { tag: "RIV", name: "Rival" } },
        fetchedAt: time,
        ...(error ? { error: "unavailable" } : {}),
      },
    },
    errors: error ? ["failed"] : [],
  };
}
test("first observation establishes baseline without gains", () =>
  assert.deepEqual(compareSnapshots(null, snapshot()), []));
test("unchanged refresh updates checked time without creating events", () => {
  const merged = mergeObservation(snapshot(), snapshot({ time: 2000 }));
  assert.equal(merged.airFetchedAt, 2000);
  assert.deepEqual(merged.changes, []);
});
test("lead change records both observation times and exact delta", () => {
  const changes = compareSnapshots(
    snapshot(),
    snapshot({ time: 2000, rival: 3500 }),
  );
  assert.deepEqual(
    changes.map((c) => [c.kind, c.delta, c.from, c.to]),
    [["lead", -1500, 1000, 2000]],
  );
});
test("failed standings retain old values and original timestamp without fake trend", () => {
  const before = snapshot(),
    after = snapshot({ time: 2000, mine: 0, rival: 0, error: true });
  const merged = mergeObservation(before, after);
  assert.equal(merged.boards.TEST.fetchedAt, 1000);
  assert.equal(merged.boards.TEST.list[0].value, 10000);
  assert.ok(merged.boards.TEST.error);
  assert.deepEqual(merged.changes, []);
  assert.equal(assess(merged)[0].verified, false);
});
test("recovered standings compare against last valid values across a failed check", () => {
  const failed = mergeObservation(
    snapshot(),
    snapshot({ time: 2000, error: true }),
  );
  const recovered = mergeObservation(
    failed,
    snapshot({ time: 3000, rival: 4000 }),
  );
  assert.equal(recovered.changes[0].delta, -2000);
  assert.equal(recovered.changes[0].from, 1000);
});
test("confirmed ownership loss survives failed airport standings", () => {
  const merged = mergeObservation(
    snapshot(),
    snapshot({ time: 2000, held: false, error: true }),
  );
  assert.equal(merged.changes[0].kind, "lost");
  assert.equal(assess(merged)[0].status, "lost");
  assert.equal(assess(merged)[0].verified, false);
});
test("regained airport creates one gain after previous loss", () => {
  const lost = mergeObservation(
    snapshot(),
    snapshot({ time: 2000, held: false }),
  );
  const gained = mergeObservation(lost, snapshot({ time: 3000 }));
  assert.equal(gained.changes.filter((c) => c.kind === "gained").length, 1);
  assert.equal(assess(gained)[0].lost, false);
});
test("older responses cannot roll back stored ownership", () =>
  assert.throws(
    () =>
      mergeObservation(
        snapshot({ time: 3000 }),
        snapshot({ time: 2000, held: false }),
      ),
    /older airspace/,
  ));
test("equal server revision with earlier fetch timestamp cannot replace a later observation", () => {
  const next = snapshot({ time: 2000 });
  next.air.now = 3000;
  assert.throws(
    () => mergeObservation(snapshot({ time: 3000 }), next),
    /older airspace/,
  );
});
test("known former holdings remain visible when a bounded batch omitted them", () => {
  const next = snapshot({ time: 2000, held: false });
  next.airports = [];
  next.boards = {};
  const merged = mergeObservation(snapshot(), next);
  assert.equal(assess(merged)[0].code, "TEST");
  assert.equal(assess(merged)[0].status, "lost");
});
test("backup preserves exact scores, watchlist and observation times", () => {
  const backup = {
    format: "pilots-dispatch",
    version: 1,
    companyId: COMPANY,
    exportedAt: 3000,
    snapshot: snapshot(),
    watch: [{ code: "TEST", name: "Test airport", lat: 30, lon: -98 }],
    runs: [],
  };
  assert.deepEqual(parseBackup(JSON.parse(JSON.stringify(backup))), backup);
});
test("invalid backup formats or impossible coordinates are rejected", () => {
  assert.throws(() => parseBackup({ format: "other", version: 1 }));
  assert.throws(() =>
    parseBackup({
      format: "pilots-dispatch",
      version: 1,
      companyId: COMPANY,
      exportedAt: 3000,
      snapshot: null,
      watch: [{ code: "TEST", name: "Test", lat: 200, lon: 0 }],
      runs: [],
    }),
  );
});
test("unknown data is never a verified expansion recommendation", () => {
  const a = assess(snapshot({ held: false, error: true }))[0];
  assert.equal(a.verified, false);
  assert.equal(a.status, "unknown");
});
