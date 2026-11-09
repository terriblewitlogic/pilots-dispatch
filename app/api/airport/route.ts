import { z } from "zod";
import { readUpstream, UpstreamError } from "@/lib/upstream";
import { boardSchema } from "@/lib/game-data";
const detail = z.object({
  level: z.number().optional(),
  pts: z.number().optional(),
  built: z.record(z.unknown()).optional(),
  project: z.unknown().optional(),
  holder: z.string().nullable().optional(),
  standings: boardSchema.shape.list,
  bases: z.array(z.string().max(40)).max(100).optional(),
  cos: boardSchema.shape.cos,
  parked: z
    .array(
      z.object({
        cs: z.string(),
        reg: z.string().optional(),
        type: z.string().optional(),
        name: z.string().optional(),
      }),
    )
    .optional(),
});
export async function GET(request: Request) {
  const url = new URL(request.url),
    code = url.searchParams.get("code") ?? "";
  if (!/^[A-Z0-9-]{2,8}$/.test(code))
    return Response.json({ error: "Invalid airport code" }, { status: 400 });
  try {
    const r = await readUpstream(
      `/api/here?code=${encodeURIComponent(code)}`,
      url.origin,
      url.searchParams.get("fresh") === "1",
    );
    return Response.json(
      { ...detail.parse(r.data), fetchedAt: r.fetchedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Airport details are unavailable. Try again later.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
