import { companyIdSchema } from "@/lib/company";
import { z } from "zod";
import { type Airport, type Board } from "@/lib/dispatch";
import {
  airportSchema,
  enrichAirports,
  parseAir,
  parseBoard,
  sameOrigin,
} from "@/lib/game-data";
import { readUpstream, UpstreamError } from "@/lib/upstream";
const scope = z.object({
  companyId: companyIdSchema,
  watch: z.array(airportSchema).max(24).default([]),
  previous: z.array(airportSchema).max(128).default([]),
  fresh: z.boolean().default(true),
});
async function run(request: Request, input: z.infer<typeof scope>) {
  const COMPANY = input.companyId,
    origin = new URL(request.url).origin,
    started = Date.now();
  try {
    const result = await readUpstream(
      `/api/air/co${COMPANY}`,
      origin,
      input.fresh,
    );
    const air = parseAir(result.data);
    const all = new Map<string, Airport>();
    for (const [code, h] of Object.entries(air.held))
      all.set(code, { code, name: code, lat: h.lat, lon: h.lon });
    for (const a of [...input.watch, ...input.previous])
      if (!all.has(a.code)) all.set(a.code, a);
    const selected = [...all.values()].slice(0, 48),
      airports = await enrichAirports(selected, origin);
    const boards: Record<string, Board> = {},
      errors: string[] = [];
    let halted = false;
    for (let i = 0; i < airports.length; i += 2) {
      if (halted || Date.now() - started > 45000) {
        for (const a of airports.slice(i)) {
          const error = halted
            ? "Paused after API rate limit"
            : "Request budget reached; check again later";
          boards[a.code] = {
            code: a.code,
            list: [],
            cos: {},
            fetchedAt: 0,
            error,
          };
          errors.push(`${a.code}: ${error}`);
        }
        break;
      }
      await Promise.all(
        airports.slice(i, i + 2).map(async (a) => {
          try {
            const r = await readUpstream(
              `/api/standings?code=${a.code}&co=${COMPANY}`,
              origin,
              input.fresh,
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
            errors.push(`${a.code}: ${error}`);
            if (e instanceof UpstreamError && e.status === 429) halted = true;
          }
        }),
      );
    }
    // Keep every holding visible even if the bounded standings batch cannot cover it.
    for (const [code, h] of Object.entries(air.held))
      if (!airports.some((a) => a.code === code))
        airports.push({ code, name: code, lat: h.lat, lon: h.lon });
    return Response.json(
      {
        companyId: COMPANY,
        air,
        airFetchedAt: result.fetchedAt,
        refreshMode: input.fresh ? "fresh" : "cached",
        boards,
        airports,
        generatedAt: Date.now(),
        errors,
        coverage: {
          checked: Object.keys(air.held).filter(
            (c) => boards[c] && !boards[c].error,
          ).length,
          total: Object.keys(air.held).length,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Could not validate fresh company data. Your previous observation is safe.",
      },
      {
        status: e instanceof UpstreamError ? e.status : 503,
        headers: {
          "Cache-Control": "no-store",
          ...(e instanceof UpstreamError && e.status === 429
            ? { "Retry-After": "300" }
            : {}),
        },
      },
    );
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request))
    return Response.json({ error: "Invalid request origin" }, { status: 403 });
  try {
    if (Number(request.headers.get("content-length")) > 60000)
      return Response.json({ error: "Request too large" }, { status: 413 });
    const input = scope.parse(await request.json());
    return run(request, input);
  } catch {
    return Response.json(
      { error: "Invalid refresh selection" },
      { status: 400 },
    );
  }
}
export async function GET(request: Request) {
  const url = new URL(request.url),
    co = companyIdSchema.safeParse(url.searchParams.get("companyId"));
  if (!co.success)
    return Response.json(
      { error: "A valid companyId is required" },
      { status: 400 },
    );
  return run(request, {
    companyId: co.data,
    watch: [],
    previous: [],
    fresh: url.searchParams.get("fresh") === "1",
  });
}
