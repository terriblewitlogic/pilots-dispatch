import { test } from "node:test";
import assert from "node:assert/strict";
import { readUpstream } from "../lib/upstream.ts";
const origin = "https://dispatch.example";
const path = "/api/air/corwbm4emc";
function cache(stored, failWrite = false) {
  let value = stored;
  return {
    async match() {
      return value ? Response.json(value) : undefined;
    },
    async put(_key, response) {
      if (failWrite) throw Error("cache unavailable");
      value = await response.json();
    },
  };
}
test("automatic checks reuse successful shared cache", async () => {
  const result = await readUpstream(path, origin, false, {
    cache: cache({ data: { held: { OLD: {} } }, fetchedAt: 10 }),
    fetcher: () => {
      throw Error("Unexpected upstream request");
    },
  });
  assert.equal(result.fetchedAt, 10);
});
test("manual refresh bypasses cached success and returns new timestamp and data", async () => {
  let requests = 0;
  const result = await readUpstream(path, origin, true, {
    cache: cache({ data: { held: { OLD: {} } }, fetchedAt: 10 }),
    now: () => 99,
    fetcher: async (_url, init) => {
      requests++;
      assert.equal(init.cache, "no-store");
      return Response.json({ held: { NEW: {} } });
    },
  });
  assert.equal(requests, 1);
  assert.equal(result.fetchedAt, 99);
  assert.deepEqual(result.data, { held: { NEW: {} } });
});
test("manual refresh respects cached upstream rate limits", async () => {
  await assert.rejects(
    () =>
      readUpstream(path, origin, true, {
        cache: cache({ error: "Rate limit", status: 429, fetchedAt: 10 }),
        fetcher: () => {
          throw Error("must not contact upstream");
        },
      }),
    (e) => e.status === 429,
  );
});
test("cache failure cannot hide successful live data", async () => {
  const result = await readUpstream(path, origin, true, {
    cache: cache(null, true),
    fetcher: async () => Response.json({ held: { NEW: {} } }),
  });
  assert.ok(result.data.held.NEW);
});
test("transient API failure is immediately retryable", async () => {
  const store = cache(null);
  await assert.rejects(() =>
    readUpstream(path, origin, true, {
      cache: store,
      fetcher: async () => new Response("", { status: 503 }),
    }),
  );
  const result = await readUpstream(path, origin, true, {
    cache: store,
    fetcher: async () => Response.json({ held: { NEW: {} } }),
  });
  assert.ok(result.data.held.NEW);
});
test("non-JSON success cannot be presented as live data", async () => {
  await assert.rejects(() =>
    readUpstream(path, origin, true, {
      cache: cache(null),
      fetcher: async () => new Response("<html>error</html>"),
    }),
  );
});
