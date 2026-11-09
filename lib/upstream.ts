// Bounded, process-local cache for portable Node hosting. No player credentials.
const entries = new Map<string, { body: string; expires: number }>();
const memoryCache = {
  async match(request: Request) {
    const key = request.url,
      item = entries.get(key);
    if (!item) return undefined;
    if (item.expires <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return new Response(item.body, {
      headers: { "Content-Type": "application/json" },
    });
  },
  async put(request: Request, response: Response) {
    const seconds = Number(
      response.headers.get("Cache-Control")?.match(/max-age=(\d+)/)?.[1] ?? 300,
    );
    const body = await response.text();
    for (const [key, item] of entries)
      if (item.expires <= Date.now()) entries.delete(key);
    entries.delete(request.url);
    while (entries.size >= 128) entries.delete(entries.keys().next().value!);
    entries.set(request.url, { body, expires: Date.now() + seconds * 1000 });
  },
};
type Stored = {
  data?: unknown;
  fetchedAt: number;
  error?: string;
  status?: number;
};
type CacheStore = Pick<Cache, "match" | "put">;
type Dependencies = {
  fetcher?: typeof fetch;
  cache?: CacheStore | null;
  now?: () => number;
  ttl?: number;
};
export class UpstreamError extends Error {
  status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.status = status;
  }
}
/** Manual refresh skips successful cached data, but respects API rate limits. */
export async function readUpstream(
  path: string,
  origin: string,
  fresh = false,
  deps: Dependencies = {},
) {
  const fetcher = deps.fetcher ?? fetch,
    now = deps.now ?? Date.now;
  const cache = deps.cache !== undefined ? deps.cache : memoryCache;
  const key = new Request(
    `${origin}/__dispatch_cache/${encodeURIComponent(path)}`,
  );
  const cached = await cache?.match(key).catch(() => undefined);
  if (cached) {
    const stored = (await cached.json().catch(() => null)) as Stored | null;
    if (stored?.error && stored.status === 429)
      throw new UpstreamError(stored.error, 429);
    if (stored?.data && !fresh)
      return { data: stored.data, fetchedAt: stored.fetchedAt };
  }
  const response = await fetcher(`https://pilots.nimblebit.com${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const message =
      response.status === 429
        ? "The game API is rate limiting requests. Please wait before refreshing."
        : `Game API returned ${response.status}. Try Refresh data again.`;
    if (response.status === 429) {
      const retry = response.headers.get("Retry-After");
      const seconds =
        retry && /^\d+$/.test(retry)
          ? Number(retry)
          : retry
            ? (Date.parse(retry) - now()) / 1000
            : 0;
      const ttl =
        Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) : 300;
      await cache
        ?.put(
          key,
          Response.json(
            { error: message, status: 429, fetchedAt: now() },
            { headers: { "Cache-Control": `public, max-age=${ttl}` } },
          ),
        )
        .catch(() => {});
    }
    throw new UpstreamError(message, response.status === 429 ? 429 : 503);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new UpstreamError("Empty game response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new UpstreamError("Game response exceeded size limit");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const data: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const value = { data, fetchedAt: now() };
  // A cache outage must not turn a successful API request into a failed refresh.
  await cache
    ?.put(
      key,
      Response.json(value, {
        headers: { "Cache-Control": `public, max-age=${deps.ttl ?? 300}` },
      }),
    )
    .catch(() => {});
  return value;
}
