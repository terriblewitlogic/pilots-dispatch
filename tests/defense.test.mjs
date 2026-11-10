import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_SNAPSHOT, mergeObservation } from "../lib/dispatch.ts";
import { recentlyLostAirports } from "../lib/defense.ts";

const airport = { code: "TEST", name: "Test airport", lat: 30, lon: -98 };
function snapshot(time, held = false, companyId = "company1") {
  return {
    ...EMPTY_SNAPSHOT,
    companyId,
    airFetchedAt: time,
    generatedAt: time,
    airports: [airport],
    air: {
      now: time,
      flights: [],
      held: held ? { TEST: { co: companyId, v: 2500, lat: 30, lon: -98 } } : {},
    },
  };
}
function run(snapshot) {
  return {
    id: String(snapshot.airFetchedAt),
    at: snapshot.airFetchedAt,
    changes: snapshot.changes ?? [],
    snapshot,
  };
}
const lost = mergeObservation(snapshot(1000, true), snapshot(2000));

test("loss report preserves observed interval and works without verified standings", () => {
  assert.deepEqual(recentlyLostAirports(lost, [run(lost)], 0, 3000), [
    {
      code: "TEST",
      name: "Test airport",
      from: 1000,
      to: 2000,
      regained: false,
    },
  ]);
});

test("loss report uses one latest loss per airport and marks regained airports", () => {
  const regained = mergeObservation(lost, snapshot(3000, true));
  assert.equal(
    recentlyLostAirports(regained, [run(lost), run(regained)], 0, 6000)[0]
      .regained,
    true,
  );
  const lostAgain = mergeObservation(regained, snapshot(4000));
  const rows = recentlyLostAirports(
    lostAgain,
    [run(lostAgain), run(lost), run(regained)],
    0,
    6000,
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].to, 4000);
  assert.equal(rows[0].from, 3000);
  assert.equal(rows[0].regained, false);
});

test("loss window is inclusive and excludes future observations", () => {
  assert.equal(recentlyLostAirports(lost, [run(lost)], 2000, 2000).length, 1);
  assert.deepEqual(recentlyLostAirports(lost, [run(lost)], 2001, 3000), []);
  assert.deepEqual(recentlyLostAirports(lost, [run(lost)], 0, 1999), []);
  assert.deepEqual(
    recentlyLostAirports(snapshot(1500), [run(lost)], 0, 3000),
    [],
  );
});

test("baseline and historical previous holdings do not invent a recent loss", () => {
  assert.deepEqual(
    recentlyLostAirports(
      { ...snapshot(5000), previous: ["TEST"] },
      [],
      0,
      6000,
    ),
    [],
  );
  assert.deepEqual(
    recentlyLostAirports(mergeObservation(null, snapshot(5000)), [], 0, 6000),
    [],
  );
});

test("report isolates company history and includes an unsaved latest observation", () => {
  const other = { ...lost, companyId: "company2" };
  assert.deepEqual(
    recentlyLostAirports(snapshot(3000), [run(other)], 0, 4000),
    [],
  );
  assert.equal(
    recentlyLostAirports({ ...lost, historySaved: false }, [], 0, 3000).length,
    1,
  );
});

test("report sorts newest first and retains airport names from historical records", () => {
  const second = {
    ...snapshot(4000),
    airports: [{ ...airport, code: "NEXT", name: "Next airport" }],
    changes: [
      { kind: "lost", code: "NEXT", from: 3000, to: 4000, text: "Lost" },
    ],
  };
  const rows = recentlyLostAirports(
    { ...snapshot(5000), airports: [] },
    [run(lost), run(second)],
    0,
    6000,
  );
  assert.deepEqual(
    rows.map((row) => [row.code, row.name]),
    [
      ["NEXT", "Next airport"],
      ["TEST", "Test airport"],
    ],
  );
});
