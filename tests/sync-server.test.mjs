import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { exampleSnapshot } from "../lib/sync-example.ts";
import { handleSync } from "../lib/sync-server.ts";
const origin = "http://127.0.0.1:3000",
  code = "2222333344445555";
const originalFetch = globalThis.fetch;
let calls = [];
function raw() {
  const s = exampleSnapshot();
  return {
    career: s.viewer,
    company: {
      ...s.company,
      treasury: s.treasury,
      stats: s.stats,
      bases: s.bases,
      fleet: s.fleet,
      reqs: s.requests,
      book: s.book,
      log: s.log,
      trophies: s.trophies,
      bj: s.jumps,
    },
  };
}
function req(
  method = "POST",
  body = { action: "connect", code, acknowledgeCodeExposure: true },
  headers = {},
  url = origin + "/api/sync",
) {
  return new Request(url, {
    method,
    headers: {
      host: "127.0.0.1:3000",
      origin,
      "x-dispatch-sync": "1",
      "content-type": "application/json",
      ...headers,
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}
function allowRefresh() {
  globalThis.__pilotsSync.next = 0;
}
beforeEach(() => {
  process.env.PILOTS_LOCAL_SYNC = "1";
  process.env.PILOTS_SYNC_ORIGIN = origin;
  globalThis.__pilotsSync.sessions.clear();
  globalThis.__pilotsSync.next = 0;
  globalThis.__pilotsSync.busy = false;
  calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return Response.json(raw());
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.PILOTS_LOCAL_SYNC;
  delete process.env.PILOTS_SYNC_ORIGIN;
  globalThis.__pilotsSync.sessions.clear();
});
test("disabled, remote, cross-origin, missing-header and URL credential requests never reach upstream", async () => {
  delete process.env.PILOTS_LOCAL_SYNC;
  assert.equal((await handleSync(req())).status, 403);
  process.env.PILOTS_LOCAL_SYNC = "1";
  for (const r of [
    req("POST", undefined, { origin: "https://evil.test" }),
    req("POST", undefined, { host: "evil.test" }),
    req("POST", undefined, { "x-dispatch-sync": "" }),
    req("POST", undefined, {}, origin + "/api/sync?code=" + code),
    req("POST", undefined, {}, "http://evil.test/api/sync"),
    req("POST", undefined, { "sec-fetch-site": "cross-site" }),
    req("POST", undefined, { "x-forwarded-host": "evil.test" }),
    req("POST", undefined, { "x-forwarded-for": "192.0.2.1" }),
    req("POST", undefined, { "x-forwarded-proto": "https" }),
  ])
    assert.equal((await handleSync(r)).status, 403);
  assert.equal(calls.length, 0);
});
test("invalid codes, operations and extra parameters cannot become gameplay requests", async () => {
  for (const body of [
    { action: "connect", code: "JOIN12", acknowledgeCodeExposure: true },
    { action: "buy", code },
    { action: "connect", code, acknowledgeCodeExposure: true, op: "co.pay" },
    { action: "connect", code },
    { action: "connect", code, acknowledgeCodeExposure: false },
    { action: "refresh", acct: code },
  ])
    assert.equal((await handleSync(req("POST", body))).status, 400);
  assert.equal(calls.length, 0);
});
test("connect uses fixed read operation, returns no credential, and refresh uses an HttpOnly session", async () => {
  const response = await handleSync(req()),
    body = await response.json(),
    cookie = response.headers.get("set-cookie");
  assert.equal(response.status, 200);
  assert.match(cookie, /HttpOnly; SameSite=Strict; Path=\/api\/sync/);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(JSON.stringify(body).includes(code), false);
  assert.equal(calls[0].url, "https://pilots.nimblebit.com/api/career");
  assert.deepEqual(JSON.parse(calls[0].opts.body), { op: "get", acct: code });
  assert.equal(calls[0].opts.redirect, "error");
  allowRefresh();
  const refreshed = await handleSync(
    req("POST", { action: "refresh" }, { cookie: cookie.split(";")[0] }),
  );
  assert.equal(refreshed.status, 200);
  assert.equal(calls.length, 2);
  const status = await handleSync(req("GET", undefined, { cookie }));
  assert.equal((await status.json()).connected, true);
  assert.equal(calls.length, 2);
});
test("disconnect and expiration invalidate the credential", async () => {
  let r = await handleSync(req()),
    cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal(
    (await handleSync(req("DELETE", undefined, { cookie }))).status,
    200,
  );
  assert.equal(globalThis.__pilotsSync.sessions.size, 0);
  assert.equal(
    (await handleSync(req("POST", { action: "refresh" }, { cookie }))).status,
    401,
  );
  allowRefresh();
  r = await handleSync(req());
  cookie = r.headers.get("set-cookie").split(";")[0];
  for (const s of globalThis.__pilotsSync.sessions.values())
    s.expires = Date.now() - 1;
  assert.equal(
    (await handleSync(req("POST", { action: "refresh" }, { cookie }))).status,
    401,
  );
  assert.equal(globalThis.__pilotsSync.sessions.size, 0);
});
test("rate limiting honors upstream Retry-After without leaking error bodies", async () => {
  globalThis.fetch = async () =>
    new Response("secret upstream body " + code, {
      status: 429,
      headers: { "retry-after": "120" },
    });
  let r = await handleSync(req());
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "120");
  assert.equal((await r.text()).includes(code), false);
  globalThis.fetch = async () => {
    throw Error("should not fetch");
  };
  r = await handleSync(req());
  assert.equal(r.status, 429);
});
test("malformed, oversized and rejected upstream responses never return raw private contents", async () => {
  for (const upstream of [
    () => Response.json({ error: code }),
    () => new Response(code, { status: 403 }),
    () => new Response("x".repeat(3 * 1024 * 1024 + 1)),
    () => Response.json({ career: { secret: code } }),
  ]) {
    allowRefresh();
    globalThis.fetch = async () => upstream();
    const r = await handleSync(req());
    assert.notEqual(r.status, 200);
    assert.equal((await r.text()).includes(code), false);
  }
});
test("disconnect during an in-flight refresh cannot revive the session", async () => {
  const connection = await handleSync(req()),
    cookie = connection.headers.get("set-cookie").split(";")[0];
  allowRefresh();
  let finish;
  globalThis.fetch = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const pending = handleSync(req("POST", { action: "refresh" }, { cookie }));
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  await handleSync(req("DELETE", undefined, { cookie }));
  finish(Response.json(raw()));
  assert.equal((await pending).status, 401);
  assert.equal(globalThis.__pilotsSync.sessions.size, 0);
});
test("company switch rejects refresh and requires a new explicit connection", async () => {
  const connection = await handleSync(req()),
    cookie = connection.headers.get("set-cookie").split(";")[0];
  allowRefresh();
  const changed = raw();
  changed.company.id = "new-company";
  globalThis.fetch = async () => Response.json(changed);
  const r = await handleSync(req("POST", { action: "refresh" }, { cookie }));
  assert.equal(r.status, 409);
  assert.equal(globalThis.__pilotsSync.sessions.size, 0);
});
test("scrubs an accidentally reflected credential even in allowlisted text", async () => {
  const data = raw();
  data.company.log = [{ t: Date.now(), text: "A reflected " + code }];
  globalThis.fetch = async () => Response.json(data);
  const r = await handleSync(req());
  assert.equal(r.status, 200);
  const body = await r.text();
  assert.equal(body.includes(code), false);
  assert.match(body, /redacted/);
});
