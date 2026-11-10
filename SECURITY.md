# Local sync security boundary

The personal game sync code is a full-career credential, not a scoped API key. Dispatch's read-only adapter does not restrict what a stolen code could do elsewhere.

## Implemented controls

- Default `dev`/`start` scripts leave Private Sync disabled. The explicit `dev:local`/`start:local` launchers bind Next.js exclusively to `127.0.0.1`. The server-rendered page omits credential entry when disabled, and the API independently rejects requests. Known hosted runtime flags also disable it. Authenticated routes require the launcher's explicit enable flag and exact configured loopback Host. Next's internal `localhost` URL reconstruction is allowed only with that loopback Host; externally supplied remote hosts remain rejected.
- POST/DELETE require the exact local Origin. All methods require a custom header; conflicting Fetch Metadata, forwarded hosts/protocols, and non-loopback forwarded clients are rejected. No CORS grants are emitted. Query strings are rejected.
- The page warns that the code is exposed to the browser/server environment. Both the form and connect API require an explicit acknowledgment. Credentials arrive only in a bounded JSON POST body. The only upstream destination and operation are hardcoded. Redirects are rejected, TLS verification stays enabled, and requests have a 15-second timeout.
- Input is capped at 512 bytes, upstream content at 3 MiB, schemas have collection limits, requests are serialized, and cooldowns respect the game's rate limit.
- Sync codes stay in a bounded in-memory session map. Random 256-bit session IDs use an HttpOnly, SameSite=Strict cookie scoped to `/api/sync`. It is intentionally not a Secure cookie because the isolated loopback server uses HTTP. There is no localStorage credential, environment-file secret, disk session store, or game credential export.
- Sessions expire after 30 minutes, are not renewed by refresh, and are invalidated on disconnect, failed authentication, company change, or process exit. Expired map entries are pruned every minute. Session identity is rechecked after an in-flight refresh.
- The full upstream career response exists transiently in process memory. The normalized career fields are only the viewer identity and available numeric earnings, distance, hours, departures, jobs, and balance. Explicit schemas strip unknown fields before returning or persisting data. Error responses never include upstream bodies, credential strings, or validation objects. The submitted credential is also redacted if reflected in allowlisted text.
- Authenticated responses use `Cache-Control: no-store`. The sync page blocks framing and external connections/assets through CSP and uses a no-referrer policy. Development permits inline/eval scripts required by Next; production retains Next's inline bootstrap support. React renders names/logs as text.
- No raw request bodies, credentials, or upstream responses are logged by application code. Development server access logs contain route/method/status, not request bodies.

## Operational limits

This is a single-user local application, not a hardened hosted service. Do not change the listener to `0.0.0.0`, publish it, proxy it, or expose it using a tunnel. Host/Origin checks are not a substitute for loopback binding; a proxy that rewrites/strips headers cannot be reliably detected. The code is exposed to the local browser and server processes that handle it. A local process, privileged browser extension, same-origin script compromise, or compromised dependency can defeat the boundary. JavaScript strings cannot be reliably zeroed from memory; disconnect removes references, not a forensic guarantee.

Saved snapshots and exports contain member activity and private company information. They are not encrypted. Device access, filesystem backups, browser sync/settings, and exported copies are outside this app's control. The sync code grants access to the entire career even though this application only performs reads.

Do not attach real sync codes, raw career responses, or private company exports to bug reports. Report schema issues using only the section name and a synthetic reproduction. Never ask contributors to commit an `.env` file or capture real credentials in screenshots.

## Validation limit

The adapter is based on the inspected official game client, not a published server specification. Automated security/data tests and browser previews use fictional data. A real account read has not been performed during implementation; the app must reject incompatible payloads rather than weaken the allowlist. The `op: get` operation is the game's read operation; normal server-side reconciliation may occur as it does when the game refreshes.
