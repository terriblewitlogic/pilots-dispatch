import { z } from "zod";
import { performanceTotalsSchema, type PerformanceTotals } from "./performance";
const text = z.string().max(240);
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const num = z.number().finite().nonnegative();
const airport = z.object({ code: text, name: text.optional() });
const member = z.object({
  cs: text,
  rank: z.enum(["chief", "cpt", "fo"]),
  jobs: num,
  earned: num,
  gave: num.optional(),
  // Only omission gets a default; present invalid values still fail validation.
  brought: num.default(0),
  seen: num.optional(),
  at: text.nullish(),
  lim: num.optional(),
  spent: z.object({ d: num, amt: num }).optional(),
});
const base = z.object({
  code: text,
  name: text,
  gates: z.number().int().min(1).max(4),
  supplies: num,
  t: num,
  size: z.number().int().min(0).max(2),
  since: num.optional(),
  card: z.object({ w: z.number().int(), n: num }).optional(),
});
const plane = z.object({
  reg: text,
  type: text,
  name: text.optional(),
  hours: num,
  at: airport.nullish(),
  by: id.nullish(),
  held: num.optional(),
  end: airport.nullish(),
  lands: num.optional(),
});
const request = z.object({
  id,
  pid: id,
  cs: text,
  type: text,
  at: airport,
  price: num,
  t: num,
});
const book = z.object({
  h: z.number().int(),
  k: z.enum(["fly", "fee", "net"]),
  of: text,
  n: num,
  amt: num,
  cost: num.optional(),
});
const entry = z.object({ t: num, text: z.string().max(1000) });
const trophy = z.object({ name: text, place: z.number().int().positive() });
const companyHeader = z.object({
  id,
  name: text,
  tag: text,
  members: z.record(member).refine((v) => Object.keys(v).length <= 1000),
});
const viewerSchema = z.object({ pid: id, callsign: text.optional() });
export const syncSnapshotSchema = z.object({
  version: z.literal(1),
  fetchedAt: num,
  viewer: viewerSchema,
  pilotStats: performanceTotalsSchema.nullable().optional(),
  company: companyHeader,
  treasury: num.nullable(),
  stats: z.object({ jobs: num, earned: num }).nullable(),
  bases: z.array(base).max(100).nullable(),
  fleet: z.array(plane).max(2000).nullable(),
  requests: z.array(request).max(1000).nullable(),
  book: z.array(book).max(10000).nullable(),
  log: z.array(entry).max(2000).nullable(),
  trophies: z.array(trophy).max(200).nullable(),
  jumps: z.object({ n: num, w: z.number().int() }).nullable(),
  warnings: z.array(text).max(20),
});
export type SyncSnapshot = z.infer<typeof syncSnapshotSchema>;
export type SyncBase = z.infer<typeof base>;
export function normalizeCareer(raw: unknown, now = Date.now()): SyncSnapshot {
  const root = z
    .object({
      career: viewerSchema.extend({
        stats: z.unknown().optional(),
        money: z.unknown().optional(),
      }),
      company: z.unknown(),
    })
    .parse(raw);
  if (!root.company) throw Error("This career does not belong to a company.");
  const company = companyHeader.parse(root.company);
  if (!Object.hasOwn(company.members, root.career.pid))
    throw Error("The company roster does not include this pilot.");
  const source = root.company as Record<string, unknown>;
  const warnings: string[] = [];
  const stats = z.record(z.unknown()).safeParse(root.career.stats);
  const pilotValue = (key: string, whole = false) => {
    const value = stats.success ? stats.data[key] : undefined;
    const parsed = (whole ? num.int() : num).safeParse(value);
    if (value !== undefined && !parsed.success)
      warnings.push(`pilot ${key}: unavailable or changed format`);
    return parsed.success ? parsed.data : null;
  };
  const pilotStats: PerformanceTotals = {
    earned: pilotValue("earned"),
    distanceNm: pilotValue("nm"),
    hours: pilotValue("hours"),
    flights: pilotValue("flights", true),
    jobs: pilotValue("jobs", true),
    balance: num.safeParse(root.career.money).success
      ? (root.career.money as number)
      : null,
  };
  function section<T>(
    key: string,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): T | null {
    const result = schema.safeParse(source[key]);
    if (!result.success) {
      warnings.push(`${key}: unavailable or changed format`);
      return null;
    }
    return result.data;
  }
  return {
    version: 1,
    fetchedAt: now,
    viewer: viewerSchema.parse(root.career),
    pilotStats: Object.values(pilotStats).some((value) => value !== null)
      ? pilotStats
      : null,
    company,
    treasury: section("treasury", num),
    stats: section("stats", z.object({ jobs: num, earned: num })),
    bases: section("bases", z.array(base).max(100)),
    fleet: section("fleet", z.array(plane).max(2000)),
    requests: section("reqs", z.array(request).max(1000).default([])),
    book: section("book", z.array(book).max(10000)),
    log: section("log", z.array(entry).max(2000)),
    trophies: section("trophies", z.array(trophy).max(200)),
    jumps: section("bj", z.object({ n: num, w: z.number().int() })),
    warnings,
  };
}
export const DAY = 86400000,
  WEEK = 7 * DAY,
  WEEK_EPOCH = Date.UTC(2024, 0, 1);
export const weekAt = (at: number) => Math.floor((at - WEEK_EPOCH) / WEEK);
export function baseSupply(base: SyncBase, at: number) {
  const daily = 40 * base.gates,
    capacity = 1000 * base.gates;
  const remaining = Math.max(
    0,
    base.supplies - (Math.max(0, at - base.t) / DAY) * daily,
  );
  const fillKg = Math.max(0, Math.floor(capacity - remaining));
  return {
    daily,
    capacity,
    remaining,
    days: remaining / daily,
    fillKg,
    fillCost: fillKg * 30,
    emptyAt: base.t + (base.supplies / daily) * DAY,
    stamps: base.card?.w === weekAt(at) ? base.card.n : 0,
    nextGateCost:
      ([0, 0, 100000, 250000, 600000] as number[])[base.gates + 1] ?? null,
    nextGateDays: base.gates < 4 ? remaining / (daily + 40) : null,
  };
}
// Mirrors the current game's weekly accrual rule; unknown establishment dates
// prevent calculation rather than inventing a balance.
export function jumpBalance(snapshot: SyncSnapshot): number | null {
  if (
    !snapshot.jumps ||
    !snapshot.bases ||
    snapshot.bases.some((b) => b.since === undefined)
  )
    return null;
  const week = weekAt(snapshot.fetchedAt);
  let balance = snapshot.jumps.n;
  for (let w = Math.max(snapshot.jumps.w + 1, week - 2); w <= week; w++) {
    const boundary = WEEK_EPOCH + w * WEEK;
    const increment = snapshot.bases
      .filter(
        (b) => b.since! <= boundary && baseSupply(b, boundary).remaining > 0,
      )
      .reduce((sum, b) => sum + (b.size === 0 ? 2 : 1), 0);
    balance = Math.max(balance, Math.min(2 * increment, balance + increment));
  }
  return balance;
}
export function incomeSummary(snapshot: SyncSnapshot) {
  if (!snapshot.book) return null;
  const hour = Math.floor(snapshot.fetchedAt / 3600000);
  const rows = snapshot.book.filter((b) => b.h > hour - 24 && b.h <= hour);
  return {
    rows,
    flights: rows.filter((b) => b.k === "fly").reduce((n, b) => n + b.amt, 0),
    costs: rows.reduce((n, b) => n + (b.cost ?? 0), 0),
    fees: rows.filter((b) => b.k === "fee").reduce((n, b) => n + b.amt, 0),
    network: rows.filter((b) => b.k === "net").reduce((n, b) => n + b.amt, 0),
    net: rows.reduce((n, b) => n + b.amt - (b.cost ?? 0), 0),
  };
}
export function snapshotChanges(before: SyncSnapshot, after: SyncSnapshot) {
  if (before.company.id !== after.company.id)
    throw Error("Cannot compare different companies.");
  const a = before.company.members,
    b = after.company.members;
  return {
    joined: Object.keys(b).filter((id) => !Object.hasOwn(a, id)),
    left: Object.keys(a).filter((id) => !Object.hasOwn(b, id)),
    pilots: Object.keys(b)
      .filter((id) => Object.hasOwn(a, id))
      .map((id) => ({
        id,
        cs: b[id].cs,
        jobs: b[id].jobs - a[id].jobs,
        earned: b[id].earned - a[id].earned,
        gave:
          b[id].gave === undefined || a[id].gave === undefined
            ? null
            : b[id].gave! - a[id].gave!,
        brought:
          b[id].brought === undefined || a[id].brought === undefined
            ? null
            : b[id].brought! - a[id].brought!,
        roleChanged: b[id].rank !== a[id].rank || b[id].lim !== a[id].lim,
      })),
    treasury:
      before.treasury === null || after.treasury === null
        ? null
        : after.treasury - before.treasury,
  };
}
export function roleLabel(member: SyncSnapshot["company"]["members"][string]) {
  return member.rank === "chief"
    ? "Chief Pilot"
    : member.rank === "cpt"
      ? member.lim === 0
        ? "Deputy Chief"
        : "Captain"
      : "First Officer";
}
