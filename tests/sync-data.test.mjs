import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCareer,
  baseSupply,
  jumpBalance,
  incomeSummary,
  snapshotChanges,
  roleLabel,
  DAY,
  WEEK,
  WEEK_EPOCH,
  weekAt,
  syncSnapshotSchema,
} from "../lib/sync-data.ts";
import { exampleSnapshot } from "../lib/sync-example.ts";
const now = Date.UTC(2026, 10, 9, 12);
export function rawCareer() {
  const s = exampleSnapshot(now);
  return {
    code: "not-a-real-code",
    career: { ...s.viewer, money: 999, licenses: ["private"], acct: "secret" },
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
      code: "invite-secret",
    },
    trip: { private: true },
  };
}
test("only allowlisted company fields leave the normalizer", () => {
  const s = normalizeCareer(rawCareer(), now);
  assert.equal(s.company.members["demo-chief"].cs, "SKY01");
  const str = JSON.stringify(s);
  for (const field of [
    "invite-secret",
    "secret",
    "licenses",
    "money",
    "trip",
    "acct",
  ])
    assert.equal(str.includes(field), false);
  assert.equal(s.warnings.length, 0);
});
test("absent or malformed sections are unavailable, not empty or zero", () => {
  const raw = rawCareer();
  delete raw.company.bases;
  raw.company.book = [{ k: "new-kind" }];
  delete raw.company.treasury;
  const s = normalizeCareer(raw, now);
  assert.equal(s.bases, null);
  assert.equal(s.book, null);
  assert.equal(s.treasury, null);
  assert.equal(s.warnings.length, 3);
});
test("missing member data rejects the entire roster instead of implying departures", () => {
  const raw = rawCareer();
  delete raw.company.members["demo-pilot"].jobs;
  assert.throws(() => normalizeCareer(raw));
});
test("omitted requests and flying contributions use the game defaults", () => {
  const raw = rawCareer();
  delete raw.company.reqs;
  delete raw.company.members["demo-chief"].brought;
  const snapshot = normalizeCareer(raw, now);
  assert.deepEqual(snapshot.requests, []);
  assert.equal(snapshot.company.members["demo-chief"].brought, 0);
  assert.deepEqual(snapshot.warnings, []);
  assert.equal(snapshot.company.members["demo-captain"].brought, 38000);
});
test("present malformed requests still produce an unavailable warning", () => {
  for (const value of [null, {}, "", 0, false, [{}]]) {
    const raw = rawCareer();
    raw.company.reqs = value;
    const snapshot = normalizeCareer(raw, now);
    assert.equal(snapshot.requests, null);
    assert.deepEqual(snapshot.warnings, [
      "reqs: unavailable or changed format",
    ]);
  }
});
test("present malformed flying contributions are rejected rather than replaced with zero", () => {
  for (const value of [null, "0", -1, NaN, Infinity, false, {}, []]) {
    const raw = rawCareer();
    raw.company.members["demo-chief"].brought = value;
    assert.throws(() => normalizeCareer(raw, now));
  }
});
test("old snapshots default omitted contributions but preserve unknown request failures", () => {
  const old = exampleSnapshot(now);
  delete old.company.members["demo-chief"].brought;
  old.requests = null;
  old.warnings = ["reqs: unavailable or changed format"];
  const parsed = syncSnapshotSchema.parse(old);
  assert.equal(parsed.company.members["demo-chief"].brought, 0);
  assert.equal(parsed.requests, null);
  assert.deepEqual(parsed.warnings, old.warnings);
  const current = exampleSnapshot(now + DAY);
  current.company.members["demo-chief"].brought = 250;
  assert.equal(
    snapshotChanges(parsed, current).pilots.find((p) => p.id === "demo-chief")
      .brought,
    250,
  );
});
test("no company and wrong viewer are rejected", () => {
  const raw = rawCareer();
  raw.company = null;
  assert.throws(() => normalizeCareer(raw), /does not belong/);
  const wrong = rawCareer();
  wrong.career.pid = "not-a-member";
  assert.throws(() => normalizeCareer(wrong), /does not include/);
});
test("base consumption, closure, costs and extra gates match the game rules", () => {
  const b = exampleSnapshot(now).bases[0];
  const s = baseSupply(b, now + DAY);
  assert.equal(s.remaining, 60);
  assert.equal(s.days, 0.5);
  assert.equal(s.fillCost, 88200);
  assert.equal(s.nextGateCost, 600000);
  assert.equal(s.nextGateDays, 0.375);
  assert.equal(baseSupply(b, now + 2 * DAY).remaining, 0);
  assert.equal(baseSupply({ ...b, t: now + DAY }, now).remaining, 180);
});
test("network card resets on Monday and jump accrual preserves above-cap rewards", () => {
  const monday = WEEK_EPOCH + weekAt(now) * WEEK;
  const s = exampleSnapshot(monday);
  s.jumps = { n: 1, w: weekAt(monday) - 1 };
  assert.equal(jumpBalance(s), 3);
  s.jumps.n = 20;
  assert.equal(jumpBalance(s), 20);
  const base = { ...s.bases[0], card: { w: weekAt(monday) - 1, n: 4 } };
  assert.equal(baseSupply(base, monday).stamps, 0);
  delete s.bases[0].since;
  assert.equal(jumpBalance(s), null);
});
test("income excludes expired/future buckets and calculates net separately from balance", () => {
  const s = exampleSnapshot(now);
  const h = Math.floor(now / 3600000);
  s.book.push(
    { h: h - 24, k: "fee", of: "old", n: 1, amt: 999999 },
    { h: h + 1, k: "fee", of: "future", n: 1, amt: 999999 },
  );
  const v = incomeSummary(s);
  assert.equal(v.net, 30900);
  assert.equal(v.rows.length, 3);
  assert.notEqual(v.net, s.treasury);
});
test("contribution comparison isolates companies, identifies membership and preserves unknown counters", () => {
  const a = exampleSnapshot(now - DAY),
    b = exampleSnapshot(now);
  b.company.members["demo-captain"].jobs += 12;
  delete b.company.members["demo-pilot"];
  b.company.members["new-pilot"] = {
    cs: "NEW",
    rank: "fo",
    jobs: 0,
    earned: 0,
  };
  delete a.company.members["demo-chief"].gave;
  const c = snapshotChanges(a, b);
  assert.deepEqual(c.joined, ["new-pilot"]);
  assert.deepEqual(c.left, ["demo-pilot"]);
  assert.equal(c.pilots.find((p) => p.id === "demo-captain").jobs, 12);
  assert.equal(c.pilots.find((p) => p.id === "demo-chief").gave, null);
  b.company.id = "another";
  assert.throws(() => snapshotChanges(a, b), /different companies/);
});
test("deputy chief derives from captain limit and persisted schema strips injected credentials", () => {
  assert.equal(roleLabel({ rank: "cpt", lim: 0 }), "Deputy Chief");
  const s = syncSnapshotSchema.parse({
    ...exampleSnapshot(now),
    acct: "fake-secret",
  });
  assert.equal("acct" in s, false);
});

test("career KPIs are allowlisted separately from roster contributions", () => {
  const raw = rawCareer();
  raw.career.stats = {
    earned: 1234567,
    nm: 987.5,
    hours: 12.25,
    flights: 14,
    jobs: 16,
    secret: "discard-me",
  };
  const s = normalizeCareer(raw, now);
  assert.deepEqual(s.pilotStats, {
    earned: 1234567,
    distanceNm: 987.5,
    hours: 12.25,
    flights: 14,
    jobs: 16,
    balance: 999,
  });
  assert.equal(s.stats.earned, raw.company.stats.earned);
  assert.deepEqual(s.viewer, {
    pid: raw.career.pid,
    callsign: raw.career.callsign,
  });
  assert.equal(JSON.stringify(s).includes("discard-me"), false);
});
test("missing or invalid pilot counters stay unavailable while real zero survives", () => {
  const raw = rawCareer();
  delete raw.career.money;
  assert.equal(normalizeCareer(raw, now).pilotStats, null);
  raw.career.stats = { earned: 0, nm: -2, hours: "12", flights: 1.2, jobs: 0 };
  assert.deepEqual(normalizeCareer(raw, now).pilotStats, {
    earned: 0,
    distanceNm: null,
    hours: null,
    flights: null,
    jobs: 0,
    balance: null,
  });
});
