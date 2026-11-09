import { decodeTrack } from "@/lib/operations";
import { readUpstream, UpstreamError } from "@/lib/upstream";
export async function GET(request: Request) {
  const url = new URL(request.url),
    pid = url.searchParams.get("pid") ?? "",
    t0 = Number(url.searchParams.get("t0")),
    rev = Number(url.searchParams.get("revision"));
  if (
    !/^[a-zA-Z0-9-]{2,40}$/.test(pid) ||
    !Number.isSafeInteger(t0) ||
    t0 <= 0 ||
    !Number.isSafeInteger(rev) ||
    rev < 0
  )
    return Response.json(
      { error: "Choose a valid observed flight." },
      { status: 400 },
    );
  try {
    const r = await readUpstream(
      `/api/track/${encodeURIComponent(pid)}${rev ? `?r=${rev}` : ""}`,
      url.origin,
      url.searchParams.get("fresh") === "1",
    );
    return Response.json(
      { ...decodeTrack(r.data, t0), fetchedAt: r.fetchedAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof UpstreamError
            ? e.message
            : e instanceof Error && e.message.startsWith("This flight")
              ? e.message
              : "The game flight path is unavailable. The route overview remains visible.",
      },
      { status: e instanceof UpstreamError ? e.status : 409 },
    );
  }
}
