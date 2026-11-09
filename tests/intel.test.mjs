import test from "node:test";
import assert from "node:assert/strict";
import {
  cellsAround,
  distance,
  mergeRadar,
  mergeStations,
  windLabel,
  ceiling,
  radarCellSchema,
  weatherCellSchema,
  regionalSavedSchema,
} from "../lib/intel.ts";
import { operationsSchema } from "../lib/operations.ts";
const center = { code: "TEST", name: "Test", lat: 30, lon: -100 };
test("tile coverage includes both sides of a boundary and dateline", () => {
  assert.ok(cellsAround(center, 25, 10).includes("20_-100"));
  assert.ok(cellsAround(center, 25, 10).includes("30_-110"));
  const keys = cellsAround({ ...center, lon: 179.9 }, 50, 10);
  assert.ok(keys.some((k) => k.endsWith("_170")));
  assert.ok(keys.some((k) => k.endsWith("_-180")));
  assert.ok(keys.every((k) => Number(k.split("_")[1]) < 180));
});
test("distance takes shortest dateline crossing", () =>
  assert.ok(distance({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 }) < 13));
test("radar deduplicates cells and filters by endpoints, not interpolated positions", () => {
  const f = {
    pid: "a",
    cs: "AAA",
    co: "rival",
    from: center,
    to: { ...center, lat: 40 },
    t0: 1,
  };
  const part = {
    now: 2,
    flights: [f, { ...f, pid: "b", from: { ...center, lat: 40 } }],
    landed: [],
    held: {
      TEST: { co: "rival", v: 1, lat: 30, lon: -100 },
      FAR: { co: "rival", v: 1, lat: 40, lon: -100 },
    },
  };
  const r = mergeRadar([part, part], center, 50);
  assert.equal(r.flights.length, 1);
  assert.deepEqual(Object.keys(r.held), ["TEST"]);
});
test("radar keeps newest landing and newest holder observation", () => {
  const a = {
    now: 1,
    flights: [],
    landed: [{ pid: "a", cs: "A", at: center, t: 1 }],
    held: { TEST: { co: "old", v: 1, ...center } },
  };
  const b = {
    ...a,
    now: 2,
    landed: [{ ...a.landed[0], t: 2 }],
    held: { TEST: { ...a.held.TEST, co: "new" } },
  };
  const r = mergeRadar([b, a], center, 50);
  assert.equal(r.landed[0].t, 2);
  assert.equal(r.held.TEST.co, "new");
});
test("weather keeps freshest report and orders stations by distance", () => {
  const s = { id: "TEST", lat: 30, lon: -100, o: 20 };
  const r = mergeStations(
    [
      { t: 1, st: [s, { ...s, id: "NEAR", lat: 30.1 }] },
      {
        t: 2,
        st: [
          { ...s, o: 10 },
          { ...s, id: "FAR", lat: 50 },
        ],
      },
    ],
    center,
    50,
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].o, 20);
  assert.equal(r[0].id, "TEST");
});
test("wind uses knots, calm and variable without inventing values", () => {
  assert.equal(windLabel({}), "Not reported");
  assert.equal(windLabel({ w: [-1, 8, 12] }), "Variable · 8 kt · gust 12 kt");
  assert.equal(windLabel({ w: [0, 0, 0] }), "Calm");
});
test("ceiling ignores scattered layers and reports unknown without cloud data", () => {
  assert.equal(
    ceiling({
      c: [
        [3, 400, ""],
        [6, 1200, ""],
        [8, 3000, ""],
      ],
    }),
    "1,200 ft",
  );
  assert.equal(ceiling({ c: [] }), "Not reported");
});
test("response schemas reject invalid weather coordinates and regional scores", () => {
  assert.equal(
    weatherCellSchema.safeParse({ t: 1, st: [{ id: "BAD", lat: 100, lon: 0 }] })
      .success,
    false,
  );
  assert.equal(
    regionalSavedSchema.safeParse({
      region: "US",
      list: [{ id: "bad", value: -1 }],
      cos: {},
      fetchedAt: 1,
    }).success,
    false,
  );
});
test("public radar schema retains company identity", () => {
  const r = radarCellSchema.parse({
    now: 1,
    flights: [{ pid: "a", cs: "A", co: "rival", from: center, t0: 1 }],
    held: {},
  });
  assert.equal(r.flights[0].co, "rival");
});
test("new local fields are additive and preserve older operation backups", () => {
  assert.deepEqual(operationsSchema.parse({ pilots: [] }), { pilots: [] });
  const r = {
    region: "US",
    list: [{ id: "tex", value: 1 }],
    cos: {},
    fetchedAt: 1,
  };
  assert.deepEqual(
    operationsSchema.parse({ pilots: [], regional: r }).regional,
    r,
  );
});
test("polar tile enumeration remains finite with valid canonical keys", () => {
  const keys = cellsAround({ ...center, lat: 89.9, lon: 179.9 }, 100, 3);
  assert.ok(keys.length > 4 && keys.length <= 240);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(
    keys.every((k) => {
      const [lat, lon] = k.split("_").map(Number);
      return lat >= -90 && lat < 90 && lon >= -180 && lon < 180;
    }),
  );
});
test("new intelligence results survive operation backup parsing", () => {
  const data = {
    pilots: [],
    radar: {
      center,
      radius: 50,
      fetchedAt: 1,
      cells: ["30_-100"],
      warnings: ["Partial cell failure"],
      flights: [],
      landed: [],
      held: {},
    },
    weather: {
      center,
      radius: 50,
      fetchedAt: 1,
      cells: ["30_-102"],
      warnings: [],
      stations: [
        { id: "TEST", lat: 30, lon: -100, w: [90, 12, 20], v: 1000, o: 1 },
      ],
    },
  };
  assert.deepEqual(operationsSchema.parse(data), data);
});
