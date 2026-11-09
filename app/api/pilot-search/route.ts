import { z } from "zod";
import { companyIdSchema } from "@/lib/company";
import { readUpstream, UpstreamError } from "@/lib/upstream";
const pilot = z.object({
  pid: z.string(),
  cs: z.string(),
  type: z.string().optional(),
  co: z.string().optional(),
});
const result = z.object({ flights: z.array(pilot), landed: z.array(pilot) });
export async function GET(request: Request) {
  const url = new URL(request.url),
    query = url.searchParams.get("query") ?? "";
  if (!/^[a-zA-Z0-9-]{2,12}$/.test(query))
    return Response.json(
      { error: "Use a callsign with 2–12 letters, numbers or hyphens." },
      { status: 400 },
    );
  const selected = companyIdSchema.safeParse(url.searchParams.get("companyId"));
  if (!selected.success)
    return Response.json(
      { error: "A valid companyId is required" },
      { status: 400 },
    );
  const COMPANY = selected.data;
  try {
    const r = await readUpstream(
      `/api/find/${encodeURIComponent(query)}`,
      url.origin,
      false,
    );
    const data = result.parse(r.data);
    const pilots = [
      ...new Map(
        [...data.flights, ...data.landed]
          .filter((p) => p.co === COMPANY)
          .map((p) => [
            p.pid,
            { pid: p.pid, cs: p.cs, type: p.type, seenAt: r.fetchedAt },
          ]),
      ).values(),
    ];
    return Response.json(
      { pilots, fetchedAt: r.fetchedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Pilot search is unavailable.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
