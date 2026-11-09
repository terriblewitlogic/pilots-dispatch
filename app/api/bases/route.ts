import { normalizeBases } from "@/lib/bases";
import { readUpstream, UpstreamError } from "@/lib/upstream";
export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const r = await readUpstream(
      "/api/world?v=2",
      url.origin,
      url.searchParams.get("fresh") === "1",
    );
    return Response.json(normalizeBases(r.data, r.fetchedAt), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Base data could not be verified. Your previous briefing is retained.",
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
