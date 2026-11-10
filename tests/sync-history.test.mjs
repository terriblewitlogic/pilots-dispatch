import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { exampleSnapshot } from "../lib/sync-example.ts";
import {
  saveSyncSnapshot,
  readSyncHistory,
  clearSyncHistory,
} from "../lib/sync-history.ts";
test("history is company-isolated, strips secrets and clears only the selected company", async () => {
  const a = exampleSnapshot(),
    b = exampleSnapshot();
  b.company.id = "another-company";
  a.acct = "secret-credential";
  a.company.code = "invite";
  await Promise.all([saveSyncSnapshot(a), saveSyncSnapshot(b)]);
  const rows = await readSyncHistory(a.company.id);
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows).includes("secret-credential"), false);
  assert.equal("code" in rows[0].company, false);
  await clearSyncHistory(a.company.id);
  assert.equal((await readSyncHistory(a.company.id)).length, 0);
  assert.equal((await readSyncHistory(b.company.id)).length, 1);
});
test("concurrent snapshots survive and only the most recent 200 are retained", async () => {
  const now = Date.now();
  await Promise.all(
    Array.from({ length: 205 }, (_, i) => {
      const s = exampleSnapshot(now - i * 1000);
      s.company.id = "retention";
      return saveSyncSnapshot(s);
    }),
  );
  const rows = await readSyncHistory("retention");
  assert.equal(rows.length, 200);
  assert.equal(rows[0].fetchedAt, now);
  assert.equal(rows.at(-1).fetchedAt, now - 199000);
});

test("observations older than 90 days are not retained", async () => {
  const old = exampleSnapshot(Date.now() - 91 * 86400000);
  old.company.id = "expired-history";
  await saveSyncSnapshot(old);
  assert.equal((await readSyncHistory(old.company.id)).length, 0);
});
