import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { localSyncOrigin, localSyncHost } from "../lib/sync-policy.ts";
const keys = [
  "PILOTS_LOCAL_SYNC",
  "PILOTS_SYNC_ORIGIN",
  "VERCEL",
  "NETLIFY",
  "CF_PAGES",
  "AWS_LAMBDA_FUNCTION_NAME",
  "K_SERVICE",
];
const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of keys)
    original[k] === undefined
      ? delete process.env[k]
      : (process.env[k] = original[k]);
});
function enable() {
  for (const k of keys) delete process.env[k];
  process.env.PILOTS_LOCAL_SYNC = "1";
  process.env.PILOTS_SYNC_ORIGIN = "http://127.0.0.1:3188";
}
test("private mode needs explicit enablement and a valid exact loopback origin", () => {
  enable();
  assert.equal(localSyncOrigin(), "http://127.0.0.1:3188");
  delete process.env.PILOTS_LOCAL_SYNC;
  assert.equal(localSyncOrigin(), null);
  process.env.PILOTS_LOCAL_SYNC = "1";
  for (const origin of [
    "https://app.test",
    "http://localhost:3188",
    "http://0.0.0.0:3188",
    "http://127.0.0.1:80",
    "http://127.0.0.1:99999",
    "http://127.0.0.1:3188/path",
  ]) {
    process.env.PILOTS_SYNC_ORIGIN = origin;
    assert.equal(localSyncOrigin(), null);
  }
});
test("known hosted runtimes cannot enable personal code entry", () => {
  for (const key of keys.slice(2)) {
    enable();
    process.env[key] = "1";
    assert.equal(localSyncOrigin(), null);
  }
});
test("private page and API share host and forwarded-client checks", () => {
  enable();
  const base = { host: "127.0.0.1:3188" };
  assert.equal(localSyncHost(new Headers(base)), true);
  assert.equal(
    localSyncHost(
      new Headers({
        ...base,
        "x-forwarded-for": "127.0.0.1",
        "x-forwarded-host": base.host,
        "x-forwarded-proto": "http",
      }),
    ),
    true,
  );
  for (const overrides of [
    { host: "app.test" },
    { host: "127.0.0.1:3000" },
    { forwarded: "for=127.0.0.1" },
    { "x-forwarded-for": "192.0.2.1" },
    { "x-forwarded-for": "127.0.0.1, 192.0.2.1" },
    { "x-forwarded-host": "app.test" },
    { "x-forwarded-proto": "https" },
  ])
    assert.equal(localSyncHost(new Headers({ ...base, ...overrides })), false);
});
