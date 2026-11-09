import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { companyDatabase } from "../lib/local-db.ts";
import { assess, mergeObservation } from "../lib/dispatch.ts";
import { companyIdSchema, parseDirectory } from "../lib/company.ts";
import { parseBackup } from "../lib/backup.ts";
const airport = { code: "EGLL", name: "Heathrow", lat: 51.47, lon: -0.45 };
function observation(companyId, time = Date.now()) {
  return {
    companyId,
    air: {
      now: time,
      held: { EGLL: { co: companyId, v: 10000, lat: 51.47, lon: -0.45 } },
      flights: [],
    },
    airFetchedAt: time,
    boards: {
      EGLL: {
        code: "EGLL",
        fetchedAt: time,
        cos: {
          alpha: { name: "Alpha", tag: "A" },
          bravo: { name: "Bravo", tag: "B" },
        },
        list: [
          { id: "alpha", value: 10000 },
          { id: "bravo", value: 9000 },
        ],
      },
    },
    airports: [airport],
    generatedAt: time,
    errors: [],
  };
}
test("assessments use selected company even when it is not the leader", () => {
  assert.equal(assess(observation("alpha"))[0].score, 10000);
  assert.equal(assess(observation("bravo"))[0].score, 9000);
  assert.equal(assess(observation("bravo"))[0].rank, 2);
});
test("history cannot merge across companies", () =>
  assert.throws(
    () => mergeObservation(observation("alpha"), observation("bravo")),
    /different companies/,
  ));
test("directory is searchable public metadata, with no inferred complete roster", () =>
  assert.deepEqual(
    parseDirectory({
      cos: {
        alpha: { id: "ignored", name: "Alpha Air", tag: "ALP", paint: {} },
      },
    }),
    [{ id: "alpha", name: "Alpha Air", tag: "ALP" }],
  ));
test("company identifiers cannot inject paths or query parameters", () => {
  for (const value of ["", "../admin", "co?x=y", "a/b", "a".repeat(41)])
    assert.equal(companyIdSchema.safeParse(value).success, false);
});
test("separate company databases isolate snapshots, watchlists, history and operations, including late writes", async () => {
  const a = companyDatabase("alpha"),
    b = companyDatabase("bravo");
  await a.recordLocal(observation("alpha"));
  await a.saveWatch([airport]);
  await a.patchOperations({
    pilots: [{ pid: "pilotA", cs: "ALPHA", seenAt: Date.now() }],
  });
  const before = await b.loadLocal();
  assert.equal(before.snapshot, null);
  assert.deepEqual(before.watch, []);
  assert.deepEqual(before.runs, []);
  assert.equal(before.operations, undefined);
  await b.recordLocal(observation("bravo"));
  await a.patchOperations({
    pilots: [{ pid: "lateA", cs: "LATE", seenAt: Date.now() }],
  });
  const [left, right] = await Promise.all([a.loadLocal(), b.loadLocal()]);
  assert.equal(left.snapshot.companyId, "alpha");
  assert.equal(right.snapshot.companyId, "bravo");
  assert.equal(right.operations, undefined);
  assert.equal(left.operations.pilots.length, 2);
  assert.equal(right.runs.length, 1);
  await assert.rejects(b.recordLocal(observation("alpha")), /another company/);
  await assert.rejects(b.importLocal(left), /another company/);
  assert.equal((await b.loadLocal()).snapshot.companyId, "bravo");
});
test("backup rejects mixed identities and unscoped legacy backups", () => {
  const b = {
    format: "pilots-dispatch",
    version: 1,
    companyId: "alpha",
    exportedAt: Date.now(),
    snapshot: observation("bravo"),
    watch: [],
    runs: [],
  };
  assert.throws(() => parseBackup(b), /mixed companies/);
  assert.throws(() => parseBackup({ ...b, format: "tex-dispatch" }));
});
test("company API handlers require an ID and forward it without a hardcoded fallback", async () => {
  const { GET: fleet } = await import("../app/api/fleet/route.ts");
  const { POST: dispatch } = await import("../app/api/dispatch/route.ts");
  const { GET: pilot } = await import("../app/api/pilot-search/route.ts");
  assert.equal(
    (await fleet(new Request("http://localhost/api/fleet"))).status,
    400,
  );
  assert.equal(
    (
      await dispatch(
        new Request("http://localhost/api/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
      )
    ).status,
    400,
  );
  const original = globalThis.fetch,
    paths = [];
  globalThis.fetch = async (url) => {
    paths.push(String(url));
    return Response.json(
      String(url).includes("/find/")
        ? {
            flights: [
              { pid: "1", cs: "ONE", co: "alpha" },
              { pid: "2", cs: "TWO", co: "bravo" },
            ],
            landed: [],
          }
        : { now: Date.now(), held: {}, flights: [] },
    );
  };
  try {
    const r = await fleet(
      new Request("http://localhost/api/fleet?companyId=bravo&fresh=1"),
    );
    assert.equal(r.status, 200);
    assert.equal(paths[0], "https://pilots.nimblebit.com/api/air/cobravo");
    const found = await pilot(
      new Request(
        "http://localhost/api/pilot-search?companyId=bravo&query=TEST",
      ),
    );
    assert.deepEqual(
      (await found.json()).pilots.map((p) => p.pid),
      ["2"],
    );
    const d = await dispatch(
      new Request("http://localhost/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: "alpha", fresh: true }),
      }),
    );
    assert.equal((await d.json()).companyId, "alpha");
  } finally {
    globalThis.fetch = original;
  }
});
test("same-origin accepts the incoming host used by Node adapters and rejects other origins", async () => {
  const { sameOrigin } = await import("../lib/game-data.ts");
  assert.equal(
    sameOrigin(
      new Request("http://localhost:3000/api/dispatch", {
        headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" },
      }),
    ),
    true,
  );
  assert.equal(
    sameOrigin(
      new Request("http://localhost:3000/api/dispatch", {
        headers: {
          host: "localhost:3000",
          origin: "https://unrelated.example",
        },
      }),
    ),
    false,
  );
});
