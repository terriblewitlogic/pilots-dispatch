// Runtime-only checks shared by the server page and authenticated API.
export function localSyncOrigin(): string | null {
  if (process.env.PILOTS_LOCAL_SYNC !== "1") return null;
  // Never enable credential entry in known hosted runtimes, even if flags were copied.
  if (
    [
      "VERCEL",
      "NETLIFY",
      "CF_PAGES",
      "AWS_LAMBDA_FUNCTION_NAME",
      "K_SERVICE",
    ].some(
      (key) =>
        process.env[key] &&
        process.env[key] !== "false" &&
        process.env[key] !== "0",
    )
  )
    return null;
  const origin = process.env.PILOTS_SYNC_ORIGIN ?? "";
  const match = /^http:\/\/127\.0\.0\.1:([1-9]\d{3,4})$/.exec(origin);
  if (!match) return null;
  const port = Number(match[1]);
  return port >= 1024 && port <= 65535 ? origin : null;
}

export function localSyncHost(headers: Pick<Headers, "get" | "has">): boolean {
  const origin = localSyncOrigin();
  if (!origin) return false;
  const host = new URL(origin).host;
  return (
    headers.get("host") === host &&
    !headers.has("forwarded") &&
    (!headers.has("x-forwarded-host") ||
      headers.get("x-forwarded-host") === host) &&
    (!headers.has("x-forwarded-proto") ||
      headers.get("x-forwarded-proto") === "http") &&
    (!headers.has("x-forwarded-for") ||
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        headers.get("x-forwarded-for")!,
      ))
  );
}
