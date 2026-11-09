import { test } from "node:test";
import assert from "node:assert/strict";
import { assess, nm } from "../lib/dispatch.ts";
const COMPANY = "testco01";
function fixture({ mine = 10000, rival = 0, held = true, error = false } = {}) {
  return {
    companyId: COMPANY,
    air: {
      now: 1,
      held: held ? { TEST: { v: mine, co: COMPANY, lat: 30, lon: -98 } } : {},
      flights: [],
    },
    airFetchedAt: 1,
    airports: [{ code: "TEST", name: "Test", lat: 30, lon: -98 }],
    boards: {
      TEST: {
        code: "TEST",
        fetchedAt: 1,
        list: [
          { id: COMPANY, value: mine },
          { id: "rival", value: rival },
        ]
          .filter((x) => x.value)
          .sort((a, b) => b.value - a.value),
        cos: { rival: { tag: "RIV", name: "Rival" } },
        ...(error ? { error: "offline" } : {}),
      },
    },
    generatedAt: 1,
    errors: [],
  };
}
test("uncontested airport does not trigger an alert at low score", () =>
  assert.equal(assess(fixture({ mine: 2020 }))[0].status, "secure"));
test("narrow absolute lead is urgent, even at a large percentage", () =>
  assert.equal(
    assess(fixture({ mine: 4960, rival: 3150 }))[0].status,
    "urgent",
  ));
test("configurable percentage triggers watch with larger scores", () =>
  assert.equal(
    assess(fixture({ mine: 100000, rival: 85000 }), [], 20)[0].status,
    "watch",
  ));
test("lost airports remain visible after disappearing from held list", () =>
  assert.equal(
    assess(fixture({ held: false, rival: 20000 }), ["TEST"])[0].status,
    "lost",
  ));
test("new territory must clear the 2000 point floor", () =>
  assert.equal(assess(fixture({ held: false, mine: 1930 }))[0].needed, 70));
test("overtake estimate subtracts own score and breaks ties", () =>
  assert.equal(
    assess(fixture({ held: false, mine: 5000, rival: 8000 }))[0].needed,
    3001,
  ));
test("failed boards never look secure", () =>
  assert.equal(assess(fixture({ error: true }))[0].status, "unknown"));
test("nautical distance uses a great circle", () =>
  assert.ok(Math.abs(nm({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }) - 60) < 0.1));
