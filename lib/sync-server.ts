// Node-only module. Never import from a client component.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { normalizeCareer } from "./sync-data";
import { localSyncHost, localSyncOrigin } from "./sync-policy";
const COOKIE = "dispatch_sync";
const TTL = 30 * 60 * 1000;
const MAX_RESPONSE = 3 * 1024 * 1024;
class SyncError extends Error {
  status: number;
  retry: number;
  constructor(message: string, status = 400, retry = 0) {
    super(message);
    this.status = status;
    this.retry = retry;
  }
}
type Session = { code: string; expires: number; companyId: string };
type State = {
  sessions: Map<string, Session>;
  busy: boolean;
  next: number;
  timer?: ReturnType<typeof setInterval>;
};
// Share across route reloads; no credentials written to disk or cache adapters.
const globalState = globalThis as typeof globalThis & { __pilotsSync?: State };
const state: State = (globalState.__pilotsSync ??= {
  sessions: new Map(),
  busy: false,
  next: 0,
});
function prune() {
  for (const [id, s] of state.sessions)
    if (s.expires <= Date.now()) state.sessions.delete(id);
}
if (!state.timer) {
  state.timer = setInterval(prune, 60000);
  state.timer.unref();
}
function guard(request: Request) {
  const allowed = localSyncOrigin();
  if (!allowed)
    throw new SyncError(
      "Local sync is disabled. Run npm run dev:local or npm run start:local on your own computer and open the printed 127.0.0.1 address.",
      403,
    );
  const url = new URL(request.url);
  if (
    // Next.js reconstructs route URLs with localhost even when bound to 127.0.0.1.
    ![allowed, allowed.replace("127.0.0.1", "localhost")].includes(
      url.origin,
    ) ||
    !localSyncHost(request.headers) ||
    url.search ||
    request.headers.get("x-dispatch-sync") !== "1"
  )
    throw new SyncError("Use Dispatch at its local 127.0.0.1 address.", 403);
  const origin = request.headers.get("origin"),
    site = request.headers.get("sec-fetch-site");
  if (
    (origin && origin !== allowed) ||
    (request.method !== "GET" && origin !== allowed) ||
    (site && site !== "same-origin" && site !== "none")
  )
    throw new SyncError("Cross-origin sync requests are blocked.", 403);
  if (
    request.headers.has("forwarded") ||
    (request.headers.has("x-forwarded-host") &&
      request.headers.get("x-forwarded-host") !== new URL(allowed).host)
  )
    throw new SyncError("Proxied sync requests are blocked.", 403);
  prune();
}
const tokenOf = (request: Request) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="))
    ?.slice(COOKIE.length + 1) ?? "";
function sessionOf(request: Request) {
  const token = tokenOf(request),
    session = state.sessions.get(token);
  if (!session)
    throw new SyncError(
      "Session expired or disconnected. Enter your sync code again.",
      401,
    );
  return { token, session };
}
async function boundedText(response: Response | Request, max: number) {
  if (Number(response.headers.get("content-length")) > max)
    throw new SyncError("Response or request exceeds the size limit.", 413);
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max)
        throw new SyncError("Response or request exceeds the size limit.", 413);
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString("utf8");
}
function cooldown() {
  if (state.busy)
    throw new SyncError("Another sync is running. Please wait.", 429, 10);
  if (Date.now() < state.next)
    throw new SyncError(
      "Please wait before refreshing again.",
      429,
      Math.ceil((state.next - Date.now()) / 1000),
    );
}
async function readCareer(code: string, signal: AbortSignal) {
  cooldown();
  state.busy = true;
  state.next = Date.now() + 10000;
  try {
    // Fixed operation and destination: callers cannot select gameplay actions.
    const response = await fetch("https://pilots.nimblebit.com/api/career", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "get", acct: code }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (response.status === 429) {
      const raw = response.headers.get("retry-after");
      const delay =
        raw && /^\d+$/.test(raw)
          ? Number(raw) * 1000
          : raw
            ? Date.parse(raw) - Date.now()
            : 300000;
      const retry = Math.min(
        86400,
        Math.max(
          10,
          Math.ceil((Number.isFinite(delay) ? delay : 300000) / 1000),
        ),
      );
      state.next = Date.now() + retry * 1000;
      await response.body?.cancel();
      throw new SyncError(
        "NimbleBit asked us to wait. Your saved data is unchanged.",
        429,
        retry,
      );
    }
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      await response.body?.cancel();
      throw new SyncError("The game did not accept this sync code.", 401);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new SyncError(
        "The game is unavailable. Try later; saved data is unchanged.",
        502,
      );
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await boundedText(response, MAX_RESPONSE));
    } catch {
      throw new SyncError("The game returned an unreadable response.", 502);
    }
    if (raw && typeof raw === "object" && "error" in raw)
      throw new SyncError("The game could not provide this career.", 502);
    try {
      const snapshot = normalizeCareer(raw);
      // Also scrub the submitted credential if it somehow appears in a name/log.
      return JSON.parse(
        JSON.stringify(snapshot).replaceAll(code, "[redacted]"),
      ) as ReturnType<typeof normalizeCareer>;
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "This career does not belong to a company."
      )
        throw new SyncError(error.message, 422);
      throw new SyncError(
        "The company response format changed or its roster is incomplete. No data was saved.",
        502,
      );
    }
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError(
      "Could not reach the game. The request timed out or was interrupted.",
      502,
    );
  } finally {
    state.busy = false;
  }
}
const cookie = (token: string, maxAge: number) =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/sync; Max-Age=${maxAge}`;
function json(
  value: unknown,
  status = 200,
  extra: Record<string, string> = {},
) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...extra,
    },
  });
}
export async function handleSync(request: Request): Promise<Response> {
  try {
    guard(request);
    if (request.method === "GET") {
      const session = state.sessions.get(tokenOf(request));
      return json({
        connected: !!session,
        expiresAt: session?.expires ?? null,
        companyId: session?.companyId ?? null,
      });
    }
    if (request.method === "DELETE") {
      state.sessions.delete(tokenOf(request));
      return json({ connected: false }, 200, { "Set-Cookie": cookie("", 0) });
    }
    if (request.method !== "POST")
      throw new SyncError("Method not allowed.", 405);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      throw new SyncError("Use a JSON request.", 415);
    let body: unknown;
    try {
      body = JSON.parse(await boundedText(request, 512));
    } catch {
      throw new SyncError("Invalid sync request.", 400);
    }
    const parsed = z
      .discriminatedUnion("action", [
        z
          .object({
            action: z.literal("connect"),
            code: z.string().min(1).max(64),
            acknowledgeCodeExposure: z.literal(true),
          })
          .strict(),
        z.object({ action: z.literal("refresh") }).strict(),
      ])
      .safeParse(body);
    if (!parsed.success) throw new SyncError("Invalid sync request.", 400);
    if (parsed.data.action === "connect") {
      const code = parsed.data.code
        .toUpperCase()
        .replace(/[\s-]/g, "")
        .replace(/O/g, "0")
        .replace(/[IL]/g, "1");
      if (!/^[A-Z0-9]{16}$/.test(code))
        throw new SyncError(
          "Enter the 16-character personal sync code, not a company join code.",
          400,
        );
      cooldown();
      // A failed account switch cannot silently leave the previous account connected.
      state.sessions.delete(tokenOf(request));
      const snapshot = await readCareer(code, request.signal);
      if (request.signal.aborted)
        throw new SyncError("Connection cancelled.", 499);
      const token = randomBytes(32).toString("hex"),
        expires = Date.now() + TTL;
      if (state.sessions.size >= 8)
        state.sessions.delete(state.sessions.keys().next().value!);
      state.sessions.set(token, {
        code,
        expires,
        companyId: snapshot.company.id,
      });
      return json({ snapshot, expiresAt: expires }, 200, {
        "Set-Cookie": cookie(token, TTL / 1000),
      });
    }
    const { token, session } = sessionOf(request);
    const snapshot = await readCareer(session.code, request.signal);
    if (
      state.sessions.get(token) !== session ||
      session.expires <= Date.now()
    ) {
      state.sessions.delete(token);
      throw new SyncError("Session ended during refresh. Connect again.", 401);
    }
    if (snapshot.company.id !== session.companyId) {
      state.sessions.delete(token);
      throw new SyncError(
        "Your company changed. Connect again to open its separate history.",
        409,
      );
    }
    return json({ snapshot, expiresAt: session.expires });
  } catch (error) {
    const safe =
      error instanceof SyncError
        ? error
        : new SyncError("Could not complete sync. No data was saved.", 500);
    if (safe.status === 401) state.sessions.delete(tokenOf(request));
    return json({ error: safe.message }, safe.status, {
      ...(safe.retry ? { "Retry-After": String(safe.retry) } : {}),
      ...(safe.status === 401 ? { "Set-Cookie": cookie("", 0) } : {}),
    });
  }
}
