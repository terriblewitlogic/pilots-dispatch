import { rankingsSchema } from "@/lib/operations";
import { readUpstream, UpstreamError } from "@/lib/upstream";
export async function GET(request: Request) {
  const url = new URL(request.url),
    type = url.searchParams.get("type") ?? "",
    pid = url.searchParams.get("pid") ?? "";
  if (
    !/^[a-z][a-z0-9-]{1,39}$/.test(type) ||
    (pid && !/^[a-zA-Z0-9-]{2,40}$/.test(pid))
  )
    return Response.json(
      { error: "Choose a valid aircraft type and optional public pilot ID." },
      { status: 400 },
    );
  try {
    const r = await readUpstream(
      `/api/top/${encodeURIComponent(type)}${pid ? `?pid=${encodeURIComponent(pid)}` : ""}`,
      url.origin,
      url.searchParams.get("fresh") === "1",
    );
    const data = rankingsSchema.parse(r.data);
    if (data.type !== type) throw Error("Aircraft mismatch");
    return Response.json(
      { ...data, pid, fetchedAt: r.fetchedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : "Aircraft rankings are unavailable. Check the aircraft type and try again.",
      },
      { status: e instanceof UpstreamError ? e.status : 503 },
    );
  }
}
