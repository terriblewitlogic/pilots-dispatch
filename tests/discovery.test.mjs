import { test } from "node:test";
import assert from "node:assert/strict";
import { discoveryReferences, discoveryCenter } from "../lib/discovery.ts";
import { EMPTY_SNAPSHOT } from "../lib/dispatch.ts";

const airport = (code, lat = 30) => ({ code, name: code, lat, lon: -98 });
const departure = airport("FROM"),
  destination = airport("DEST", 31),
  parked = airport("PARK", 32);
const snapshot = {
  ...EMPTY_SNAPSHOT,
  airFetchedAt: 100,
  air: {
    now: 100,
    held: {},
    flights: [
      { cs: "FLYING", from: departure, to: destination },
      { cs: "LANDED", from: parked },
      { cs: "ALSO-FLYING", from: departure, to: destination },
    ],
  },
};

test("discovery offers destinations and parked locations without duplicate airports", () => {
  const groups = discoveryReferences(
    snapshot,
    undefined,
    [destination],
    [parked, airport("WATCH")],
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.airports.map((a) => a.code)]),
    [
      ["Current flight destinations", ["DEST"]],
      ["Parked plane locations", ["PARK"]],
      ["Watched airports", ["WATCH"]],
      ["Flight departure airports", ["FROM"]],
    ],
  );
  const airports = groups.flatMap((g) => g.airports);
  assert.deepEqual(discoveryCenter(airports, "PARK"), parked);
  assert.deepEqual(discoveryCenter(airports, "DEST"), destination);
});

test("newer fleet refresh replaces old flight locations, including an empty fleet", () => {
  const fleet = {
    fetchedAt: 101,
    now: 101,
    flights: [{ cs: "LANDED", from: destination }],
  };
  assert.deepEqual(discoveryReferences(snapshot, fleet, [], []), [
    { label: "Parked plane locations", airports: [destination] },
  ]);
  assert.deepEqual(
    discoveryReferences(snapshot, { ...fleet, flights: [] }, [], []),
    [],
  );
  assert.equal(
    discoveryReferences(snapshot, { ...fleet, fetchedAt: 99 }, [], [])[0].label,
    "Current flight destinations",
  );
});

test("removed selections fall back to a valid center and no airports disables discovery", () => {
  assert.equal(discoveryCenter([parked], "DEST"), parked);
  assert.equal(discoveryCenter([], "DEST"), undefined);
  assert.deepEqual(discoveryReferences(EMPTY_SNAPSHOT, undefined, [], []), []);
});
