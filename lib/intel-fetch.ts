import {
  scopeSchema,
  cellsAround,
  radarCellSchema,
  weatherCellSchema,
  mergeRadar,
  mergeStations,
} from "./intel";
import { readUpstream, UpstreamError } from "./upstream";
import { sameOrigin } from "./game-data";
export async function areaRequest(request: Request, kind: "radar" | "weather") {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  const p = scopeSchema.safeParse(await request.json().catch(() => null));
  if (!p.success)
    return Response.json(
      { error: "Choose an airport and a 25, 50 or 100 nm radius." },
      { status: 400 },
    );
  const { center, radius } = p.data,
    all = cellsAround(center, radius, kind === "radar" ? 10 : 3),
    cells = all.slice(0, 4),
    warnings: string[] = [],
    air: ReturnType<typeof radarCellSchema.parse>[] = [],
    wx: ReturnType<typeof weatherCellSchema.parse>[] = [],
    times: number[] = [];
  let limited = false;
  if (all.length > 4)
    warnings.push(
      `Coverage limited to 4 of ${all.length} intersecting cells. Reduce the radius for fuller coverage.`,
    );
  for (let i = 0; i < cells.length; i += 2) {
    if (limited) {
      warnings.push("Remaining cells skipped after the game rate limit.");
      break;
    }
    await Promise.all(
      cells.slice(i, i + 2).map(async (cell) => {
        try {
          const r = await readUpstream(
            `/api/${kind === "radar" ? "air" : "wx"}/${cell}`,
            new URL(request.url).origin,
            false,
            { ttl: kind === "radar" ? 60 : 300 },
          );
          if (kind === "radar") air.push(radarCellSchema.parse(r.data));
          else wx.push(weatherCellSchema.parse(r.data));
          times.push(r.fetchedAt);
        } catch (e) {
          warnings.push(
            `${cell}: ${e instanceof UpstreamError ? e.message : "Unavailable or changed response format."}`,
          );
          if (e instanceof UpstreamError && e.status === 429) limited = true;
        }
      }),
    );
  }
  if (!times.length)
    return Response.json(
      { error: warnings.join(" ") || "No data returned. Try again later." },
      { status: limited ? 429 : 503 },
    );
  return Response.json(
    {
      ...p.data,
      cells,
      fetchedAt: Math.min(...times),
      warnings,
      ...(kind === "radar"
        ? mergeRadar(air, center, radius)
        : { stations: mergeStations(wx, center, radius) }),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
