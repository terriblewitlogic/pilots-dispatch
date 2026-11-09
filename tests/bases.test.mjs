import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBases,
  projectProgress,
  nearestHolding,
  baseBriefingSchema,
} from "../lib/bases.ts";
import { parseBackup } from "../lib/backup.ts";
const base = { code: "EGLL", lat: 51.47, lon: -0.45, co: "alpha" };
const project = {
  ...base,
  name: "Heathrow",
  kind: "hangar",
  need: 6000,
  have: 4000,
};
const world = {
  now: 100,
  bases: [base],
  projects: [project],
  cos: { alpha: { name: "Alpha", tag: "ALP" } },
};
test("base listings preserve different companies at one airport and deduplicate identical pairs", () => {
  const data = normalizeBases(
    { ...world, bases: [base, base, { ...base, co: "bravo" }] },
    200,
  );
  assert.equal(data.bases.length, 2);
  assert.deepEqual(
    data.bases.map((b) => b.co),
    ["alpha", "bravo"],
  );
  assert.equal(data.fetchedAt, 200);
});
test("missing public base data fails rather than becoming a false empty network", () => {
  assert.throws(() => normalizeBases({ now: 1, cos: {} }, 2));
  assert.deepEqual(
    normalizeBases({ ...world, bases: [], projects: [] }, 2).bases,
    [],
  );
});
test("malformed coordinates and zero construction goals are rejected", () => {
  assert.throws(() =>
    normalizeBases({ ...world, bases: [{ ...base, lat: 95 }] }, 2),
  );
  assert.throws(() =>
    normalizeBases({ ...world, projects: [{ ...project, need: 0 }] }, 2),
  );
});
test("project progress preserves counts and clamps a completed goal", () => {
  assert.equal(Math.round(projectProgress(project).percent), 67);
  assert.equal(projectProgress(project).remaining, 2000);
  assert.deepEqual(projectProgress({ need: 100, have: 120 }), {
    percent: 100,
    remaining: 0,
  });
});
test("nearest holding is based on geographical distance, with no invented distance for zero holdings", () => {
  assert.equal(nearestHolding(base, []), null);
  assert.equal(
    nearestHolding(base, [
      { code: "FAR", lat: 0, lon: 0 },
      { ...base, code: "NEAR" },
    ]).code,
    "NEAR",
  );
});
test("base briefings survive company backups and remain optional for existing backups", () => {
  const backup = {
    format: "pilots-dispatch",
    version: 1,
    companyId: "alpha",
    exportedAt: 200,
    snapshot: null,
    watch: [],
    runs: [],
    operations: { pilots: [], bases: normalizeBases(world, 200) },
  };
  assert.deepEqual(
    parseBackup(backup).operations.bases,
    backup.operations.bases,
  );
  assert.equal(
    parseBackup({ ...backup, operations: { pilots: [] } }).operations.bases,
    undefined,
  );
});
test("bases route normalizes the public world and omits private or unverified base details", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://pilots.nimblebit.com/api/world?v=2");
    return Response.json({
      ...world,
      bases: [{ ...base, supplies: 123, gates: 5 }],
    });
  };
  try {
    const { GET } = await import("../app/api/bases/route.ts");
    const r = await GET(new Request("http://bases.test/api/bases?fresh=1"));
    assert.equal(r.status, 200);
    const parsed = baseBriefingSchema.parse(await r.json());
    assert.deepEqual(parsed.bases, [base]);
  } finally {
    globalThis.fetch = original;
  }
});
