import { z } from "zod";
export const locationSchema = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,12}$/),
  name: z.string().min(1).max(200),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export const scopeSchema = z.object({
  center: locationSchema,
  radius: z.union([z.literal(25), z.literal(50), z.literal(100)]),
});
const company = z.object({
  name: z.string().max(200),
  tag: z.string().max(40),
});
export const regionalSchema = z.object({
  region: z.string().regex(/^[A-Z]{2}$/),
  list: z
    .array(
      z.object({
        id: z.string().max(60),
        value: z.number().finite().nonnegative(),
      }),
    )
    .max(1000),
  cos: z.record(company),
});
export const regionalSavedSchema = regionalSchema.extend({
  fetchedAt: z.number().finite(),
});
const flight = z.object({
  pid: z.string(),
  cs: z.string(),
  co: z.string().optional(),
  type: z.string().optional(),
  from: locationSchema,
  to: locationSchema.optional(),
  t0: z.number().finite(),
  eta: z.number().finite().nonnegative().optional(),
});
const landed = z.object({
  pid: z.string(),
  cs: z.string(),
  co: z.string().optional(),
  type: z.string().optional(),
  at: locationSchema,
  t: z.number().finite(),
});
const held = z.object({
  co: z.string(),
  v: z.number().finite().nonnegative(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export const radarCellSchema = z.object({
  now: z.number().finite(),
  flights: z.array(flight).max(10000),
  landed: z.array(landed).max(10000).default([]),
  held: z.record(held),
});
export const radarSchema = scopeSchema.extend({
  fetchedAt: z.number().finite(),
  cells: z.array(z.string()).max(4),
  warnings: z.array(z.string()),
  flights: z.array(flight).max(1000),
  landed: z.array(landed).max(1000),
  held: z.record(held),
});
export const stationSchema = z.object({
  id: z.string().max(20),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  w: z
    .tuple([
      z.number().finite(),
      z.number().finite().nonnegative(),
      z.number().finite().nonnegative(),
    ])
    .optional(),
  v: z.number().finite().nonnegative().optional(),
  t: z.number().finite().optional(),
  d: z.number().finite().optional(),
  q: z.number().finite().optional(),
  c: z.array(z.tuple([z.number(), z.number().finite(), z.string()])).optional(),
  x: z.string().max(200).optional(),
  r: z.string().max(3000).optional(),
  o: z.number().finite().positive().optional(),
});
export const weatherCellSchema = z.object({
  t: z.number().finite(),
  st: z.array(stationSchema).max(5000),
});
export const weatherSchema = scopeSchema.extend({
  fetchedAt: z.number().finite(),
  cells: z.array(z.string()).max(4),
  warnings: z.array(z.string()),
  stations: z.array(stationSchema).max(100),
});
export type Radar = z.infer<typeof radarSchema>;
export type Weather = z.infer<typeof weatherSchema>;
export type Regional = z.infer<typeof regionalSavedSchema>;
export type Location = z.infer<typeof locationSchema>;
export type Station = z.infer<typeof stationSchema>;
export function distance(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
) {
  const r = Math.PI / 180,
    h =
      Math.sin(((b.lat - a.lat) * r) / 2) ** 2 +
      Math.cos(a.lat * r) *
        Math.cos(b.lat * r) *
        Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return (
    3440.065 *
    2 *
    Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)))
  );
}
/** Bounding tiles, closest first; callers disclose a four-tile cap. Longitude wraps at the dateline. */
export function cellsAround(a: Location, radius: number, step: number) {
  const dy = radius / 60,
    dx = Math.min(
      180,
      dy /
        Math.max(
          0.01,
          Math.cos((Math.min(89.99, Math.abs(a.lat) + dy) * Math.PI) / 180),
        ),
    ),
    keys = new Map<string, number>();
  for (
    let lat = Math.max(-90, Math.floor((a.lat - dy) / step) * step);
    lat <= Math.min(90 - step, Math.floor((a.lat + dy) / step) * step);
    lat += step
  )
    for (
      let x = Math.floor((a.lon - dx) / step) * step;
      x <= Math.floor((a.lon + dx) / step) * step;
      x += step
    ) {
      const lon = ((((x + 180) % 360) + 360) % 360) - 180,
        key = `${lat}_${lon}`;
      keys.set(key, distance(a, { lat: lat + step / 2, lon: lon + step / 2 }));
    }
  return [...keys].sort((a, b) => a[1] - b[1]).map(([key]) => key);
}
export function mergeRadar(
  parts: z.infer<typeof radarCellSchema>[],
  center: Location,
  radius: number,
) {
  const flights = new Map<string, z.infer<typeof flight>>(),
    landings = new Map<string, z.infer<typeof landed>>(),
    holdings: Radar["held"] = {};
  for (const p of [...parts].sort((a, b) => a.now - b.now)) {
    for (const f of p.flights) flights.set(`${f.pid}:${f.t0}`, f);
    for (const f of p.landed) {
      const old = landings.get(f.pid);
      if (!old || f.t >= old.t) landings.set(f.pid, f);
    }
    Object.assign(holdings, p.held);
  }
  return {
    flights: [...flights.values()]
      .filter(
        (f) =>
          distance(center, f.from) <= radius ||
          (!!f.to && distance(center, f.to) <= radius),
      )
      .slice(0, 1000),
    landed: [...landings.values()]
      .filter((f) => distance(center, f.at) <= radius)
      .sort((a, b) => b.t - a.t)
      .slice(0, 1000),
    held: Object.fromEntries(
      Object.entries(holdings).filter(([, a]) => distance(center, a) <= radius),
    ),
  };
}
export function mergeStations(
  parts: z.infer<typeof weatherCellSchema>[],
  center: Location,
  radius: number,
) {
  const stations = new Map<string, Station>();
  for (const p of [...parts].sort((a, b) => a.t - b.t))
    for (const s of p.st) {
      const old = stations.get(s.id);
      if (!old || (s.o ?? 0) >= (old.o ?? 0)) stations.set(s.id, s);
    }
  return [...stations.values()]
    .filter((s) => distance(center, s) <= radius)
    .sort((a, b) => distance(center, a) - distance(center, b))
    .slice(0, 100);
}
export function windLabel(s: Station) {
  if (!s.w) return "Not reported";
  const [dir, speed, gust] = s.w;
  if (speed === 0) return "Calm";
  return `${dir < 0 ? "Variable" : `${Math.round(dir)}°`} · ${speed} kt${gust > speed ? ` · gust ${gust} kt` : ""}`;
}
export function ceiling(s: Station) {
  const bases = (s.c ?? [])
    .filter((c) => c[0] >= 5 && c[1] >= 0)
    .map((c) => c[1]);
  return bases.length
    ? `${Math.min(...bases).toLocaleString("en-US")} ft`
    : "Not reported";
}
