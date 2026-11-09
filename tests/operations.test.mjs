import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arrivalTime,
  durationLabel,
  decodeTrack,
  normalizeWorld,
  rememberPilots,
  unwrapRoute,
  rankingsSchema,
  operationsSchema,
  flightSchema,
} from "../lib/operations.ts";
import { parseBackup } from "../lib/backup.ts";
const from = { code: "TEST", name: "Test airport", lat: 30, lon: -98 };
const flight = {
  pid: "pilot123",
  cs: "TESTPILOT",
  type: "packhorse",
  reg: "N123TX",
  from,
  to: { ...from, code: "DEST", lat: 31 },
  t0: 100000,
  eta: 120,
  route: [
    [30, -98],
    [31, -98],
  ],
  tr: 100001,
};
test("ETA is duration in seconds, not an absolute arrival timestamp", () =>
  assert.equal(arrivalTime(flight), 220000));
test("missing ETA remains unknown, and minimum schedule matches game client", () => {
  assert.equal(arrivalTime({ t0: 100000 }), null);
  assert.equal(arrivalTime({ t0: 100000, eta: 0 }), 160000);
  assert.equal(arrivalTime({ t0: 100000, eta: -2 }), null);
});
test("countdown does not invent flight completion", () => {
  assert.equal(durationLabel(61000), "2m");
  assert.equal(durationLabel(-1), "Due now");
});
test("flight schema preserves route identity, registration and revision", () =>
  assert.deepEqual(flightSchema.parse(flight), flight));
test("track decoder validates flight identity and flattens four-value points", () => {
  assert.deepEqual(
    decodeTrack(
      { t0: 100000, rev: 7, trk: [0, 30, -98, 100, 2, 30.1, -98.1, 105] },
      100000,
    ),
    {
      t0: 100000,
      revision: 7,
      points: [
        [30, -98],
        [30.1, -98.1],
      ],
    },
  );
  assert.throws(
    () =>
      decodeTrack(
        { t0: 1, trk: [0, 30, -98, 100, 2, 30.1, -98.1, 105] },
        100000,
      ),
    /flight has changed/,
  );
});
test("invalid coordinates, partial tuples and reversed track times are rejected", () => {
  assert.throws(() =>
    decodeTrack({ t0: 1, trk: [0, 91, -98, 100, 2, 30, -98, 105] }, 1),
  );
  assert.throws(() =>
    decodeTrack({ t0: 1, trk: [0, 30, -98, 100, 2, 30, -98, 105, 3] }, 1),
  );
  assert.throws(() =>
    decodeTrack({ t0: 1, trk: [2, 30, -98, 100, 1, 30, -98, 105] }, 1),
  );
});
test("large paths are bounded while preserving first and last points", () => {
  const trk = Array.from({ length: 4000 }, (_, i) => [
    i,
    30 + i / 10000,
    -98,
    100,
  ]).flat();
  const result = decodeTrack({ t0: 1, trk }, 1);
  assert.ok(result.points.length <= 751);
  assert.deepEqual(result.points[0], [30, -98]);
  assert.deepEqual(result.points.at(-1), [30 + 3999 / 10000, -98]);
});
test("dateline routes take the short map crossing", () =>
  assert.deepEqual(
    unwrapRoute([
      [0, 179],
      [0, -179],
      [0, -178],
    ]),
    [
      [0, 179],
      [0, 181],
      [0, 182],
    ],
  ));
test("world briefing supports no next event and unpublished numeric goal", () => {
  const result = normalizeWorld(
    {
      now: 10,
      event: {
        id: "test",
        name: "Relief",
        goal: 0,
        units: 12,
        ends: 100,
        top: [],
      },
    },
    20,
  );
  assert.equal(result.event.goal, 0);
  assert.equal(result.next, null);
  assert.equal(result.fetchedAt, 20);
  assert.deepEqual(result.cos, {});
});
test("empty world event is distinct from a malformed response", () => {
  assert.equal(
    normalizeWorld({ now: 10, event: null, next: null }, 20).event,
    null,
  );
  assert.throws(() => normalizeWorld({ event: { id: "oops" } }, 20));
});
test("pilot memory deduplicates and refuses to replace newer identity with an older observation", () => {
  const old = [{ pid: "pilot123", cs: "NEW", type: "skylark", seenAt: 200 }];
  assert.equal(rememberPilots(old, [flight], 100)[0].cs, "NEW");
  assert.equal(rememberPilots(old, [flight], 300)[0].cs, "TESTPILOT");
  assert.equal(
    rememberPilots(old, [{ ...flight, pid: undefined }], 300).length,
    1,
  );
});
test("personal aircraft rank may exceed displayed leaders", () => {
  const data = rankingsSchema.parse({
    type: "packhorse",
    n: 673,
    hours: [],
    money: [],
    cos: {},
    me: { hours: 651, money: 652 },
  });
  assert.equal(data.me.hours, 651);
  assert.equal(data.hours.length, 0);
});
test("missing pilot ranks remain null rather than zero or first place", () => {
  const data = rankingsSchema.parse({
    type: "packhorse",
    n: 673,
    hours: [],
    money: [],
    cos: {},
    me: { hours: null, money: null },
  });
  assert.equal(data.me.hours, null);
});
test("company backups without operations remain compatible", () => {
  const backup = {
    format: "pilots-dispatch",
    version: 1,
    companyId: "testco01",
    exportedAt: 1,
    snapshot: null,
    watch: [],
    runs: [],
  };
  assert.deepEqual(parseBackup(backup), backup);
});
test("operations survive backup validation including cached fleet route and rankings", () => {
  const operations = operationsSchema.parse({
    pilots: [{ pid: "pilot123", cs: "TESTPILOT", seenAt: 1 }],
    fleet: { now: 1, fetchedAt: 2, flights: [flight] },
    events: normalizeWorld({ now: 1, event: null }, 2),
    rankings: {
      type: "packhorse",
      pid: "pilot123",
      n: 20,
      hours: [],
      money: [],
      cos: {},
      me: { hours: 15, money: null },
      fetchedAt: 2,
    },
  });
  const backup = parseBackup({
    format: "pilots-dispatch",
    version: 1,
    companyId: "testco01",
    exportedAt: 3,
    snapshot: null,
    watch: [],
    runs: [],
    operations,
  });
  assert.deepEqual(backup.operations, operations);
});
