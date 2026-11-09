import { normalizeWorld } from "@/lib/operations";
import { readUpstream, UpstreamError } from "@/lib/upstream";
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const r = await readUpstream(
      "/api/world?v=2",
      url.origin,
      url.searchParams.get("fresh") === "1",
    );
    return Response.json(normalizeWorld(r.data, r.fetchedAt), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Event briefing could not be verified. Previous data is retained.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
