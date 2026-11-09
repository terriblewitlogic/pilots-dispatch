import { z } from "zod";
import { flightSchema } from "./operations";
import { readUpstream } from "./upstream";
import { type Airport, type Air, type Board } from "./dispatch";
export const airportSchema = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,8}$/),
  name: z.string().min(1).max(160),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  runways: z.number().optional(),
  country: z.string().optional(),
});
const companySchema = z.object({ name: z.string(), tag: z.string() });
export const boardSchema = z.object({
  list: z
    .array(
      z.object({ id: z.string(), value: z.number().finite().nonnegative() }),
    )
    .max(10000),
  cos: z.record(companySchema),
});
export const airSchema = z.object({
  now: z.number().finite().positive(),
  held: z.record(
    z.object({
      co: z.string(),
      v: z.number().finite().nonnegative(),
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    }),
  ),
  flights: z.array(flightSchema),
});
export function parseAir(raw: unknown): Air {
  return airSchema.parse(raw);
}
export function parseBoard(
  raw: unknown,
  code: string,
  fetchedAt: number,
): Board {
  const b = boardSchema.parse(raw);
  return {
    ...b,
    code,
    fetchedAt,
    list: [...b.list].sort((a, b) => b.value - a.value),
  };
}
export function shardKey(lat: number, lon: number) {
  return `${Math.floor(lat / 5)}_${Math.floor(lon / 5)}`;
}
export function parseAirports(raw: unknown): Airport[] {
  if (!Array.isArray(raw))
    throw new Error("Airport catalog response format changed");
  return raw.flatMap((row) => {
    if (!Array.isArray(row)) return [];
    const a = airportSchema.safeParse({
      code: row[0],
      name: row[1],
      lat: row[3],
      lon: row[4],
      country: row[8],
      runways: Array.isArray(row[9]) ? row[9].length : undefined,
    });
    return a.success ? [a.data] : [];
  });
}
export async function airportShard(key: string, origin: string) {
  const r = await readUpstream(`/air/${key}.json`, origin, false, {
    ttl: 86400,
  });
  return parseAirports(r.data);
}
export async function enrichAirports(list: Airport[], origin: string) {
  const result = new Map<string, Airport>();
  const keys = [...new Set(list.map((a) => shardKey(a.lat, a.lon)))].slice(
    0,
    8,
  );
  for (let i = 0; i < keys.length; i += 2)
    await Promise.all(
      keys.slice(i, i + 2).map(async (key) => {
        try {
          for (const a of await airportShard(key, origin))
            result.set(a.code, a);
        } catch {
          /* Coordinates and exact code remain useful without catalog data. */
        }
      }),
    );
  return list.map((a) => result.get(a.code) ?? a);
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const source = new URL(origin),
      target = new URL(request.url);
    return (
      ["http:", "https:"].includes(source.protocol) &&
      (source.origin === target.origin ||
        source.host === request.headers.get("host"))
    );
  } catch {
    return false;
  }
}
