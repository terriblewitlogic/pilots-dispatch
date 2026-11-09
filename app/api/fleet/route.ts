import { companyIdSchema } from "@/lib/company";
import { parseAir } from "@/lib/game-data";
import { readUpstream, UpstreamError } from "@/lib/upstream";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const selected = companyIdSchema.safeParse(url.searchParams.get("companyId"));
  if (!selected.success)
    return Response.json(
      { error: "A valid companyId is required" },
      { status: 400 },
    );
  const COMPANY = selected.data;
  try {
    const r = await readUpstream(
      `/api/air/co${COMPANY}`,
      url.origin,
      url.searchParams.get("fresh") === "1",
    );
    const data = parseAir(r.data);
    return Response.json(
      { now: data.now, flights: data.flights, fetchedAt: r.fetchedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Fleet data could not be verified. Previous data is retained.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
