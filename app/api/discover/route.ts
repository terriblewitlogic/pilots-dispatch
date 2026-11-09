import { companyIdSchema } from "@/lib/company";
import { z } from "zod";
import { nm, type Airport, type Board, type Air } from "@/lib/dispatch";
import {
  airportSchema,
  airportShard,
  parseAir,
  parseBoard,
  sameOrigin,
} from "@/lib/game-data";
import { readUpstream, UpstreamError } from "@/lib/upstream";
const scope = z.object({
  companyId: companyIdSchema,
  center: airportSchema,
  radius: z.union([z.literal(25), z.literal(50), z.literal(100)]),
});
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const parsed = scope.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Choose an airport and a 25, 50 or 100 nm radius." },
      { status: 400 },
    );
  const { center, radius, companyId: COMPANY } = parsed.data,
    origin = new URL(request.url).origin,
    warnings: string[] = [];
  try {
    const company = await readUpstream(`/api/air/co${COMPANY}`, origin, false);
    const air = parseAir(company.data);
    const dy = radius / 60,
      dx = Math.min(
        180,
        dy / Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)),
      ),
      keys: string[] = [];
    for (
      let y = Math.max(-18, Math.floor((center.lat - dy) / 5));
      y <= Math.min(17, Math.floor((center.lat + dy) / 5));
      y++
    )
      for (
        let x = Math.floor((center.lon - dx) / 5);
        x <= Math.floor((center.lon + dx) / 5);
        x++
      )
        keys.push(`${y}_${((((x + 36) % 72) + 72) % 72) - 36}`);
    if (keys.length > 4)
      warnings.push(
        "Search covers a limited set of nearby catalog tiles. Reduce the radius for fuller coverage.",
      );
    const airports = new Map<string, Airport>();
    for (let i = 0; i < Math.min(keys.length, 4); i += 2)
      await Promise.all(
        keys.slice(i, Math.min(i + 2, 4)).map(async (k) => {
          try {
            for (const a of await airportShard(k, origin))
              if (nm(center, a) <= radius && !air.held[a.code])
                airports.set(a.code, a);
          } catch {
            warnings.push("Part of the airport catalog could not be loaded.");
          }
        }),
      );
    const nearby = [...airports.values()].sort(
      (a, b) => nm(center, a) - nm(center, b),
    );
    const cells = [
      ...new Set(
        nearby.map(
          (a) =>
            `${Math.floor(a.lat / 10) * 10}_${Math.floor(a.lon / 10) * 10}`,
        ),
      ),
    ].slice(0, 4);
    const holders: Air["held"] = {};
    for (let i = 0; i < cells.length; i += 2)
      await Promise.all(
        cells.slice(i, i + 2).map(async (c) => {
          try {
            const r = await readUpstream(`/api/air/${c}`, origin, false);
            Object.assign(holders, parseAir(r.data).held);
          } catch {
            warnings.push("Some regional holders could not be checked.");
          }
        }),
      );
    // Verify the nearest eight, then let the visitor compare verified score and distance.
    const candidates = nearby.slice(0, 8),
      boards: Record<string, Board> = {};
    let limited = false;
    for (let i = 0; i < candidates.length; i += 2) {
      if (limited) break;
      await Promise.all(
        candidates.slice(i, i + 2).map(async (a) => {
          try {
            const r = await readUpstream(
              `/api/standings?code=${a.code}&co=${COMPANY}`,
              origin,
              false,
            );
            boards[a.code] = parseBoard(r.data, a.code, r.fetchedAt);
          } catch (e) {
            const error =
              e instanceof Error ? e.message : "Standings unavailable";
            boards[a.code] = {
              code: a.code,
              list: [],
              cos: {},
              fetchedAt: 0,
              error,
            };
            if (e instanceof UpstreamError && e.status === 429) limited = true;
          }
        }),
      );
    }
    if (limited)
      warnings.push("Standings checks paused after the game rate limit.");
    return Response.json(
      {
        companyId: COMPANY,
        air,
        airFetchedAt: company.fetchedAt,
        airports: candidates,
        boards,
        generatedAt: Date.now(),
        errors: [],
        holders,
        warnings,
        found: nearby.length,
        verified: Object.values(boards).filter((b) => !b.error).length,
        center,
        radius,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Nearby search is unavailable. Please try again.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
