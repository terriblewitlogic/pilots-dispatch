import { regionalSchema } from "@/lib/intel";
import { readUpstream, UpstreamError } from "@/lib/upstream";
export async function GET(request: Request) {
  const url = new URL(request.url),
    region = url.searchParams.get("region") ?? "";
  if (!/^[A-Z]{2}$/.test(region))
    return Response.json(
      { error: "Enter a two-letter country code, such as US." },
      { status: 400 },
    );
  try {
    const r = await readUpstream(
        `/api/tables?region=${region}`,
        url.origin,
        false,
        { ttl: 120 },
      ),
      data = regionalSchema.parse(r.data);
    if (data.region !== region) throw Error("Region mismatch");
    return Response.json(
      { ...data, fetchedAt: r.fetchedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Regional board unavailable or its format changed.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
