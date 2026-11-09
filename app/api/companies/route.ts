import { parseDirectory } from "@/lib/company";
import { readUpstream, UpstreamError } from "@/lib/upstream";
export async function GET(request: Request) {
  try {
    const result = await readUpstream(
      "/api/world?v=2",
      new URL(request.url).origin,
      false,
    );
    return Response.json(
      {
        companies: parseDirectory(result.data),
        fetchedAt: result.fetchedAt,
        complete: false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Company directory is unavailable. You can still enter a public company ID.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
