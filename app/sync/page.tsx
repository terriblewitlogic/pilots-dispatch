import { headers } from "next/headers";
import { localSyncHost } from "@/lib/sync-policy";
import SyncDesk from "./sync-desk";
import "./sync.css";

export const dynamic = "force-dynamic";

export default async function SyncPage() {
  if (localSyncHost(await headers())) return <SyncDesk />;
  return (
    <main className="sync-shell">
      <header className="sync-top">
        <a className="sync-wordmark" href="/">
          PILOTS DISPATCH
        </a>
        <a href="/">Public operations</a>
      </header>
      <section className="sync-intro">
        <div>
          <span className="sync-eyebrow">PRIVATE SYNC · LOCAL ONLY</span>
          <h1>Run private sync on your own computer.</h1>
          <p>
            The public dashboard works without an access code. Private sync is
            disabled on this server.
          </p>
        </div>
      </section>
      <section
        className="sync-code-warning"
        aria-labelledby="sync-disabled-warning"
      >
        <h2 id="sync-disabled-warning">
          Your sync code grants access to your career.
        </h2>
        <p>
          The code is exposed to the browser and server handling it. Anyone
          controlling that environment can read or misuse it, even though
          Dispatch only makes read requests. Never enter it into a hosted,
          shared, proxied, or tunneled copy of this app.
        </p>
        <p>
          Use private sync only on a computer and local server you control. This
          page has no code-entry field and the sync API rejects requests in
          public mode.
        </p>
      </section>
      <section className="sync-card sync-local-guide">
        <h2>Start the combined app locally</h2>
        <p>In your checkout of Pilots Dispatch, run:</p>
        <pre>
          <code>{"npm ci\nnpm run dev:local"}</code>
        </pre>
        <p>
          Open <code>http://127.0.0.1:3000/sync</code>. For a production build
          on your own machine, run <code>npm run build</code> followed by{" "}
          <code>npm run start:local</code>.
        </p>
        <p>
          Private Sync includes the roster, base supplies, company aircraft,
          requests, treasury, activity, history, and synced Company/Pilot
          analytics. Public features remain available at the home page.
        </p>
        <a href="/">Return to public operations →</a>
      </section>
    </main>
  );
}
