import { z } from "zod";
import { radarSchema, weatherSchema, regionalSavedSchema } from "./intel.ts";
import type { Flight } from "./dispatch";
export const pointSchema = z.tuple([
  z.number().finite().min(-90).max(90),
  z.number().finite().min(-180).max(180),
]);
const airport = z.object({
  code: z.string().max(12),
  name: z.string().max(200),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export const flightSchema = z.object({
  pid: z.string().max(40).optional(),
  cs: z.string().max(60),
  type: z.string().max(40).optional(),
  reg: z.string().max(40).optional(),
  from: airport,
  to: airport.optional(),
  t0: z.number().finite().nonnegative().optional(),
  eta: z.number().finite().nonnegative().optional(),
  tr: z.number().finite().optional(),
  route: z.array(pointSchema).max(2000).optional(),
});
export const fleetSchema = z.object({
  now: z.number().finite(),
  fetchedAt: z.number().finite(),
  flights: z.array(flightSchema).max(1000),
});
const box = z.tuple([
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
]);
const eventBase = z.object({
  id: z.string(),
  name: z.string(),
  blurb: z.string().optional(),
  unit: z.string().optional(),
  box: box.optional(),
  boxes: z.array(box).optional(),
  mode: z.string().optional(),
});
const currentEvent = eventBase.extend({
  key: z.string().optional(),
  ends: z.number().finite().optional(),
  goal: z.number().finite().nonnegative().optional(),
  units: z.number().finite().nonnegative().optional(),
  pilots: z.number().int().nonnegative().optional(),
  top: z
    .array(
      z.object({ id: z.string(), units: z.number().finite().nonnegative() }),
    )
    .max(100)
    .default([]),
});
const nextEvent = eventBase.extend({ starts: z.number().finite().optional() });
const companies = z.record(z.object({ name: z.string(), tag: z.string() }));
export const worldSchema = z.object({
  now: z.number().finite(),
  event: currentEvent.nullish(),
  next: nextEvent.nullish(),
  cos: companies.default({}),
});
export const eventBriefingSchema = z.object({
  now: z.number().finite(),
  fetchedAt: z.number().finite(),
  event: currentEvent.nullable(),
  next: nextEvent.nullable(),
  cos: companies,
});
const rank = z.number().int().positive().nullable();
const row = z.object({
  pid: z.string(),
  cs: z.string(),
  co: z.string().optional(),
  v: z.number().finite().nonnegative(),
});
export const rankingsSchema = z.object({
  type: z.string(),
  n: z.number().int().nonnegative(),
  hours: z.array(row).max(100),
  money: z.array(row).max(100),
  cos: companies,
  me: z.object({ hours: rank, money: rank }),
});
export const savedRankingsSchema = rankingsSchema.extend({
  pid: z.string(),
  fetchedAt: z.number().finite(),
});
export const knownPilotSchema = z.object({
  pid: z.string().regex(/^[a-zA-Z0-9-]{2,40}$/),
  cs: z.string().max(60),
  type: z.string().max(40).optional(),
  seenAt: z.number().finite(),
});
export const operationsSchema = z.object({
  radar: radarSchema.optional(),
  weather: weatherSchema.optional(),
  regional: regionalSavedSchema.optional(),
  fleet: fleetSchema.optional(),
  events: eventBriefingSchema.optional(),
  rankings: savedRankingsSchema.optional(),
  pilots: z.array(knownPilotSchema).max(100).default([]),
});
export type Fleet = z.infer<typeof fleetSchema>;
export type EventBriefing = z.infer<typeof eventBriefingSchema>;
export type PilotRankings = z.infer<typeof savedRankingsSchema>;
export type KnownPilot = z.infer<typeof knownPilotSchema>;
export type Operations = z.infer<typeof operationsSchema>;
export type Track = {
  t0: number;
  revision: number;
  points: [number, number][];
  fetchedAt: number;
};
export function arrivalTime(f: Pick<Flight, "t0" | "eta">): number | null {
  return typeof f.t0 === "number" &&
    typeof f.eta === "number" &&
    Number.isFinite(f.t0) &&
    Number.isFinite(f.eta) &&
    f.eta >= 0
    ? f.t0 + Math.max(60000, f.eta * 1000)
    : null;
}
export function durationLabel(ms: number): string {
  if (ms <= 0) return "Due now";
  const m = Math.ceil(ms / 60000),
    d = Math.floor(m / 1440),
    h = Math.floor((m % 1440) / 60),
    minutes = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${minutes}m` : `${m}m`;
}
export function flightKey(f: Flight) {
  return `${f.pid ?? f.cs}:${f.t0 ?? 0}`;
}
export function rememberPilots(
  existing: KnownPilot[],
  flights: Flight[],
  seenAt: number,
): KnownPilot[] {
  const pilots = new Map(existing.map((p) => [p.pid, p]));
  for (const f of flights)
    if (f.pid && (!pilots.has(f.pid) || seenAt >= pilots.get(f.pid)!.seenAt))
      pilots.set(f.pid, { pid: f.pid, cs: f.cs, type: f.type, seenAt });
  return [...pilots.values()].sort((a, b) => b.seenAt - a.seenAt).slice(0, 100);
}
export function normalizeWorld(raw: unknown, fetchedAt: number): EventBriefing {
  const w = worldSchema.parse(raw);
  return {
    now: w.now,
    fetchedAt,
    event: w.event ?? null,
    next: w.next ?? null,
    cos: w.cos,
  };
}
export function decodeTrack(
  raw: unknown,
  expectedStart: number,
): Omit<Track, "fetchedAt"> {
  const t = z
    .object({
      t0: z.number().finite(),
      rev: z.number().finite().optional(),
      trk: z.array(z.number().finite()).min(8).max(80000),
    })
    .parse(raw);
  if (t.t0 !== expectedStart)
    throw new Error(
      "This flight has changed. Refresh the fleet before loading its path.",
    );
  if (t.trk.length % 4 !== 0) throw new Error("Flight path format changed.");
  const points: [number, number][] = [];
  let previous = -Infinity;
  for (let i = 0; i < t.trk.length; i += 4) {
    if (t.trk[i] < 0 || t.trk[i] < previous)
      throw new Error("Flight path timing is invalid.");
    previous = t.trk[i];
    const p = pointSchema.parse([t.trk[i + 1], t.trk[i + 2]]);
    points.push(p);
  }
  const stride = Math.max(1, Math.ceil(points.length / 750));
  const sampled = points.filter(
    (_, i) => i % stride === 0 || i === points.length - 1,
  );
  return { t0: t.t0, revision: t.rev ?? 0, points: sampled };
}
export function unwrapRoute(points: [number, number][]): [number, number][] {
  const output: [number, number][] = [];
  for (const [lat, original] of points) {
    let lon = original;
    const previous = output.at(-1)?.[1];
    if (previous !== undefined) lon += 360 * Math.round((previous - lon) / 360);
    output.push([lat, lon]);
  }
  return output;
}
