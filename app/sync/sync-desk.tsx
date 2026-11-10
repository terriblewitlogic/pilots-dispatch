"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Building2,
  Check,
  Clock,
  Download,
  LockKeyhole,
  LogOut,
  Plane,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  baseSupply,
  DAY,
  incomeSummary,
  jumpBalance,
  roleLabel,
  snapshotChanges,
  syncSnapshotSchema,
  type SyncSnapshot,
} from "@/lib/sync-data";
import {
  clearSyncHistory,
  readSyncHistory,
  saveSyncSnapshot,
} from "@/lib/sync-history";
import { exampleSnapshot } from "@/lib/sync-example";
import { companyDatabase } from "@/lib/local-db";
import { performanceFromSync } from "@/lib/performance";
import { companySchema } from "@/lib/company";
const amount = (n: number | null | undefined) =>
  n == null ? "Unavailable" : Math.round(n).toLocaleString("en-US");
const money = (n: number | null | undefined) =>
  n == null ? "Unavailable" : `$${amount(n)}`;
const when = (n: number | null | undefined) =>
  n ? new Date(n).toLocaleString() : "Unknown";
const tabs = [
  "Briefing",
  "Roster",
  "Bases",
  "Aircraft",
  "Requests",
  "Treasury",
  "Activity",
  "Trends",
] as const;
type Tab = (typeof tabs)[number];
type Session = {
  connected: boolean;
  expiresAt: number | null;
  companyId: string | null;
};
const emptySession: Session = {
  connected: false,
  expiresAt: null,
  companyId: null,
};
export default function SyncDesk() {
  const [session, setSession] = useState<Session>(emptySession),
    [snapshot, setSnapshot] = useState<SyncSnapshot | null>(null),
    [history, setHistory] = useState<SyncSnapshot[]>([]);
  const [tab, setTab] = useState<Tab>("Briefing"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [demo, setDemo] = useState(false),
    [persist, setPersist] = useState(true),
    [acknowledged, setAcknowledged] = useState(false),
    [query, setQuery] = useState(""),
    [sort, setSort] = useState("jobs"),
    [cooldown, setCooldown] = useState(0),
    [now, setNow] = useState(Date.now()),
    [clearArmed, setClearArmed] = useState(false);
  const codeInput = useRef<HTMLInputElement>(null),
    epoch = useRef(0),
    flight = useRef<AbortController | null>(null),
    pending = useRef(false);
  useEffect(() => {
    let active = true;
    const generation = epoch.current;
    void readSyncHistory()
      .then((rows) => {
        if (active && epoch.current === generation) {
          setHistory(rows);
          setSnapshot(rows[0] ?? null);
        }
      })
      .catch(() => {
        if (active)
          setNotice(
            "Local history is unavailable. You can still connect without saving.",
          );
      });
    void fetch("/api/sync", {
      headers: { "X-Dispatch-Sync": "1" },
      cache: "no-store",
    })
      .then(async (r) => {
        const result = await r.json();
        if (active && epoch.current === generation) {
          if (r.ok) setSession(result);
          else setError(result.error || "Local sync is unavailable.");
        }
      })
      .catch(() => {
        if (active) setError("Could not reach the local Dispatch server.");
      });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      active = false;
      clearInterval(timer);
      flight.current?.abort();
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (session.expiresAt && now >= session.expiresAt) setSession(emptySession);
  }, [now, session.expiresAt]);
  async function sync(action: "connect" | "refresh") {
    if (
      pending.current ||
      Date.now() < cooldown ||
      (action === "connect" && !acknowledged)
    )
      return;
    pending.current = true;
    const generation = ++epoch.current,
      controller = new AbortController();
    flight.current = controller;
    let code =
      action === "connect" ? (codeInput.current?.value ?? "") : undefined;
    if (codeInput.current) codeInput.current.value = "";
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const request = fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dispatch-Sync": "1" },
        body: JSON.stringify(
          action === "connect"
            ? { action, code, acknowledgeCodeExposure: true }
            : { action },
        ),
        signal: controller.signal,
        cache: "no-store",
      });
      code = undefined;
      const response = await request,
        result = await response.json();
      if (epoch.current !== generation) return;
      if (!response.ok) {
        if (response.status === 429)
          setCooldown(
            Date.now() +
              (Number(response.headers.get("retry-after")) || 30) * 1000,
          );
        if ([401, 409].includes(response.status) || action === "connect")
          setSession(emptySession);
        throw Error(result.error || "Sync failed.");
      }
      const incoming = syncSnapshotSchema.parse(result.snapshot);
      setDemo(false);
      setSnapshot(incoming);
      setSession({
        connected: true,
        expiresAt: result.expiresAt,
        companyId: incoming.company.id,
      });
      setCooldown(Date.now() + 10000);
      if (persist) {
        try {
          await saveSyncSnapshot(incoming);
          const performance = performanceFromSync(incoming);
          if (performance.length)
            await companyDatabase(incoming.company.id).recordPerformance(
              performance,
            );
          const rows = await readSyncHistory();
          if (epoch.current === generation) {
            setHistory(rows);
            setNotice(
              "Private snapshot and available Company/Pilot analytics saved in this browser.",
            );
          }
        } catch {
          if (epoch.current === generation)
            setNotice(
              "Fresh data is visible, but some local records could not be saved. Export it before closing.",
            );
        }
      } else setNotice("Fresh data is in memory only. Saving is turned off.");
    } catch (e) {
      if (epoch.current === generation)
        setError(e instanceof Error ? e.message : "Sync failed.");
    } finally {
      if (epoch.current === generation) {
        setBusy(false);
        pending.current = false;
      }
    }
  }
  async function disconnect() {
    ++epoch.current;
    flight.current?.abort();
    pending.current = false;
    setBusy(false);
    setError("");
    try {
      const r = await fetch("/api/sync", {
        method: "DELETE",
        headers: { "X-Dispatch-Sync": "1" },
        cache: "no-store",
      });
      if (!r.ok) throw Error();
      setSession(emptySession);
      setNotice("Disconnected. Saved observations remain on this computer.");
    } catch {
      setError(
        "Could not confirm disconnect. Stop the local server to clear its session memory.",
      );
    }
  }
  function preview() {
    ++epoch.current;
    const current = exampleSnapshot(),
      before = exampleSnapshot(current.fetchedAt - DAY);
    before.company.members["demo-captain"].jobs -= 12;
    before.company.members["demo-captain"].earned -= 18000;
    before.treasury = 710000;
    setSnapshot(current);
    setDemo(true);
    setTab("Briefing");
    setError("");
    setNotice("Fictional example. Nothing is fetched or saved.");
    setDemoHistory([current, before]);
  }
  const [demoHistory, setDemoHistory] = useState<SyncSnapshot[]>([]);
  const companyHistory = (demo ? demoHistory : history).filter(
    (s) => s.company.id === snapshot?.company.id,
  );
  const before = companyHistory.find(
    (s) => s.fetchedAt < (snapshot?.fetchedAt ?? 0),
  );
  const changes = snapshot && before ? snapshotChanges(before, snapshot) : null;
  const bases = snapshot?.bases
    ?.map((b) => ({ ...b, supply: baseSupply(b, snapshot.fetchedAt) }))
    .sort((a, b) => a.supply.days - b.supply.days);
  const income = snapshot ? incomeSummary(snapshot) : null;
  const requests = snapshot?.requests?.filter(
    (r) => r.t + 3 * DAY > snapshot.fetchedAt,
  );
  const members = snapshot
    ? Object.entries(snapshot.company.members)
        .filter(([, m]) =>
          `${m.cs} ${roleLabel(m)} ${m.at ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
        )
        .sort((a, b) =>
          sort === "callsign"
            ? a[1].cs.localeCompare(b[1].cs)
            : sort === "seen"
              ? (b[1].seen ?? 0) - (a[1].seen ?? 0)
              : sort === "contribution"
                ? (b[1].gave ?? 0) +
                  (b[1].brought ?? 0) -
                  ((a[1].gave ?? 0) + (a[1].brought ?? 0))
                : b[1].jobs - a[1].jobs,
        )
    : [];
  function openAnalytics() {
    if (!snapshot || demo) return;
    try {
      localStorage.setItem(
        "pilots-dispatch:selected-company",
        JSON.stringify(companySchema.parse(snapshot.company)),
      );
      window.location.assign("/?view=analytics");
    } catch {
      setError(
        "Could not select this company. Open public operations and choose it manually.",
      );
    }
  }
  function exportSnapshot() {
    if (!snapshot || demo) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = `dispatch-sync-${snapshot.company.id}-${snapshot.fetchedAt}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function clearHistory() {
    if (!snapshot || demo) return;
    if (!clearArmed) {
      setClearArmed(true);
      return;
    }
    try {
      await clearSyncHistory(snapshot.company.id);
      setHistory(await readSyncHistory());
      setClearArmed(false);
      setNotice(
        "Private workspace history cleared. Saved analytics and exports remain; remove analytics observations in Analytics. The displayed observation remains in memory.",
      );
    } catch {
      setError("Could not clear local history.");
    }
  }
  return (
    <main className="sync-shell">
      <header className="sync-top">
        <a href="/" className="sync-wordmark">
          <Plane size={23} /> PILOTS DISPATCH <span>SYNC</span>
        </a>
        <a href="/">
          <ArrowLeft size={15} /> Public operations
        </a>
        <span className="sync-local">
          <LockKeyhole size={13} /> LOCAL WORKSPACE
        </span>
      </header>
      <section className="sync-intro">
        <div>
          <span className="sync-eyebrow">YOUR COMPANY · YOUR COMPUTER</span>
          <h1>The company desk.</h1>
          <p>People, planes, and the places that keep you flying.</p>
        </div>
        <span className="sync-readonly">
          <ShieldCheck size={17} /> Read-only · on demand
        </span>
      </section>
      <section className="sync-code-warning" aria-labelledby="sync-risk-title">
        <h2 id="sync-risk-title">
          Your sync code is exposed to this environment.
        </h2>
        <p>
          It grants access to your full career. Your browser and this local
          server handle the code, and anyone controlling them can read or misuse
          it. Dispatch makes read requests, but that does not limit what a
          stolen code can do.
        </p>
        <p>
          Use only a computer and local server you control. Never enter your
          code in a hosted, shared, proxied, or tunneled copy. Saved
          observations and exports contain private data and are not encrypted.
        </p>
        {!session.connected && (
          <label className="sync-risk-ack">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I control this computer and local server and understand the code is
            exposed here.
          </label>
        )}
      </section>
      <section className="sync-connection" aria-label="Local connection">
        <div>
          <strong>
            {session.connected
              ? "Private session connected"
              : "Connect your career"}
          </strong>
          <p>
            {session.connected
              ? `Expires ${when(session.expiresAt)}. Refresh only when you need it.`
              : "Use your personal 16-character sync code from Menu → Options → Account. It grants access to your career."}
          </p>
        </div>
        {session.connected ? (
          <div className="sync-actions">
            <button
              className="sync-primary"
              disabled={busy || now < cooldown}
              onClick={() => void sync("refresh")}
            >
              <RefreshCw size={15} />
              {busy
                ? "Checking…"
                : now < cooldown
                  ? `Wait ${Math.ceil((cooldown - now) / 1000)}s`
                  : "Refresh company"}
            </button>
            <button onClick={() => void disconnect()}>
              <LogOut size={15} /> Disconnect
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sync("connect");
            }}
          >
            <label className="sr-only" htmlFor="sync-code">
              Personal sync code
            </label>
            <input
              ref={codeInput}
              id="sync-code"
              type="password"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="Personal sync code"
              maxLength={64}
              required
              disabled={busy || !acknowledged}
            />
            <button
              className="sync-primary"
              disabled={busy || !acknowledged || now < cooldown}
            >
              {busy
                ? "Connecting…"
                : now < cooldown
                  ? `Wait ${Math.ceil((cooldown - now) / 1000)}s`
                  : "Connect & read"}
            </button>
          </form>
        )}
        <div className="sync-privacy">
          <span>
            <LockKeyhole size={12} /> Code is sent to this local server and
            NimbleBit; kept in session memory, never saved in history or
            exports.
          </span>
          <label>
            <input
              type="checkbox"
              checked={persist}
              onChange={(e) => setPersist(e.target.checked)}
            />{" "}
            Save private observations and analytics in this browser
          </label>
        </div>
      </section>
      {snapshot && !demo && (
        <div className="sync-message">
          <button onClick={openAnalytics}>
            Open saved Company / Pilot analytics <ArrowUpRight size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="sync-message sync-error" role="alert">
          {error} {snapshot && "Previous observation retained."}
        </div>
      )}
      {notice && (
        <div className="sync-message" role="status">
          {notice}
        </div>
      )}
      {!snapshot ? (
        <section className="sync-welcome">
          <div className="sync-emblem">
            <Plane size={42} />
          </div>
          <span className="sync-eyebrow">READY WHEN YOU ARE</span>
          <h2>A clearer view of your company.</h2>
          <p>
            Find bases running low, locate parked aircraft, and see everyone’s
            contribution. Connect to establish your first observation.
          </p>
          <div className="sync-preview-grid">
            <span>
              <Users /> Every pilot
            </span>
            <span>
              <Building2 /> Base supplies
            </span>
            <span>
              <Plane /> Company aircraft
            </span>
          </div>
          <button className="sync-primary" onClick={preview}>
            Explore a fictional example <ArrowUpRight size={15} />
          </button>
          <p className="sync-small">
            The example uses no account and makes no game requests.
          </p>
        </section>
      ) : (
        <>
          <section className="sync-company">
            <div>
              <span className="sync-tag">{snapshot.company.tag}</span>
              <div>
                <h2>{snapshot.company.name}</h2>
                <p>
                  <Clock size={12} /> {demo ? "EXAMPLE · " : ""}Observed{" "}
                  {when(snapshot.fetchedAt)} · {snapshot.company.id}
                </p>
              </div>
            </div>
            <div className="sync-actions">
              {!demo && history.length > 0 && (
                <select
                  aria-label="Saved company"
                  value={snapshot.company.id}
                  onChange={(e) => {
                    const row = history.find(
                      (s) => s.company.id === e.target.value,
                    );
                    if (row) {
                      setSnapshot(row);
                      setClearArmed(false);
                    }
                  }}
                >
                  {Array.from(
                    new Map(
                      history.map((s) => [s.company.id, s.company.name]),
                    ).entries(),
                  ).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
              {demo ? (
                <button
                  onClick={() => {
                    setDemo(false);
                    setSnapshot(history[0] ?? null);
                    setNotice("");
                  }}
                >
                  Exit example
                </button>
              ) : (
                <button onClick={exportSnapshot}>
                  <Download size={14} /> Export observation
                </button>
              )}
            </div>
          </section>
          {session.connected && snapshot.company.id !== session.companyId && (
            <div className="sync-message">
              Viewing saved data for another company. Refresh reads the
              connected career’s company.
            </div>
          )}
          {!!snapshot.warnings.length && (
            <div className="sync-message sync-warning">
              Some fields were unavailable: {snapshot.warnings.join("; ")}.
              Unavailable sections are not treated as empty.
            </div>
          )}
          <nav className="sync-tabs" aria-label="Company sections">
            {tabs.map((t) => (
              <button
                key={t}
                aria-current={tab === t ? "page" : undefined}
                className={tab === t ? "active" : ""}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
          {tab === "Briefing" && (
            <>
              <div className="sync-stats">
                <Stat
                  label="Company pilots"
                  value={amount(Object.keys(snapshot.company.members).length)}
                  sub="Complete returned membership"
                />
                <Stat
                  label="Treasury"
                  value={money(snapshot.treasury)}
                  sub="At the last observation"
                />
                <Stat
                  label="Bases needing supplies"
                  value={
                    bases
                      ? amount(bases.filter((b) => b.supply.days < 3).length)
                      : "Unavailable"
                  }
                  sub="Less than three days remaining"
                />
                <Stat
                  label="Company aircraft"
                  value={
                    snapshot.fleet
                      ? amount(snapshot.fleet.length)
                      : "Unavailable"
                  }
                  sub={
                    snapshot.fleet
                      ? `${snapshot.fleet.filter((p) => p.at).length} parked at last check`
                      : "Awaiting inventory"
                  }
                />
              </div>
              <div className="sync-columns">
                <section className="sync-card">
                  <div className="sync-card-title">
                    <h3>Restocking priorities</h3>
                    <button onClick={() => setTab("Bases")}>All bases →</button>
                  </div>
                  {bases === undefined ? (
                    <Empty text="Base details unavailable." />
                  ) : !bases.length ? (
                    <Empty text="No bases in this observation." />
                  ) : (
                    bases.slice(0, 5).map((b) => (
                      <div className="sync-list-row" key={b.code}>
                        <span
                          className={`sync-dot ${b.supply.days < 3 ? "danger" : ""}`}
                        />
                        <div>
                          <strong>
                            {b.code} · {b.name}
                          </strong>
                          <p>
                            {b.supply.remaining <= 0
                              ? "Out of supplies"
                              : `${b.supply.days.toFixed(1)} days of supplies`}{" "}
                            · {b.gates} gates
                          </p>
                        </div>
                        <strong>
                          {money(b.supply.fillCost)}
                          <small>to fill stores</small>
                        </strong>
                      </div>
                    ))
                  )}
                  <p className="sync-footnote">
                    Estimates at observation time. New deliveries or spending
                    can change the picture.
                  </p>
                </section>
                <section className="sync-card">
                  <div className="sync-card-title">
                    <h3>Dispatch notes</h3>
                  </div>
                  <div className="sync-note">
                    <Users size={19} />
                    <div>
                      <strong>
                        {amount(Object.keys(snapshot.company.members).length)}{" "}
                        pilots on the roster
                      </strong>
                      <p>
                        Membership includes pilots who are not currently flying.
                      </p>
                    </div>
                  </div>
                  <div className="sync-note">
                    <Plane size={19} />
                    <div>
                      <strong>
                        {requests
                          ? `${requests.length} open aircraft requests`
                          : "Requests unavailable"}
                      </strong>
                      <p>
                        Review requested aircraft and treasury affordability.
                      </p>
                    </div>
                  </div>
                  <div className="sync-note">
                    <Building2 size={19} />
                    <div>
                      <strong>
                        {jumpBalance(snapshot) === null
                          ? "Base Jump balance unavailable"
                          : `${jumpBalance(snapshot)} Base Jumps`}
                      </strong>
                      <p>Calculated using the game’s weekly accrual rule.</p>
                    </div>
                  </div>
                  <button
                    className="sync-text-button"
                    onClick={() => setTab("Trends")}
                  >
                    Compare observations →
                  </button>
                </section>
              </div>
            </>
          )}
          {tab === "Roster" && (
            <section className="sync-card">
              <div className="sync-card-title">
                <h3>
                  Company roster ·{" "}
                  {Object.keys(snapshot.company.members).length}
                </h3>
                <div className="sync-actions">
                  <input
                    aria-label="Search roster"
                    placeholder="Callsign, role, airport"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    aria-label="Sort roster"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="jobs">Most company jobs</option>
                    <option value="callsign">Callsign</option>
                    <option value="seen">Last seen</option>
                    <option value="contribution">Treasury contribution</option>
                  </select>
                </div>
              </div>
              <Table
                heads={[
                  "Pilot",
                  "Role",
                  "Company jobs",
                  "Earned",
                  "Donated / flying brought",
                  "Last known airport",
                  "Last seen",
                ]}
              >
                {members.map(([id, m]) => (
                  <tr key={id}>
                    <td>
                      <strong>{m.cs}</strong>
                      {id === snapshot.viewer.pid && <small>Your career</small>}
                    </td>
                    <td>{roleLabel(m)}</td>
                    <td>{amount(m.jobs)}</td>
                    <td>{money(m.earned)}</td>
                    <td>
                      {money(m.gave)} / {money(m.brought)}
                    </td>
                    <td>{m.at || "Unknown"}</td>
                    <td>{when(m.seen)}</td>
                  </tr>
                ))}
              </Table>
              {!members.length && <Empty text="No matching pilots." />}
              <p className="sync-footnote">
                Last seen and last known airport describe returned observations,
                not a live online status.
              </p>
            </section>
          )}
          {tab === "Bases" && (
            <>
              <div className="sync-section-title">
                <h3>Base readiness</h3>
                <p>
                  40 kg per gate each day · $30 per kg to buy supplies ·
                  estimates at the last check
                </p>
              </div>
              {!bases ? (
                <Empty text="Base details unavailable." />
              ) : !bases.length ? (
                <Empty text="Your company has no bases in this observation." />
              ) : (
                <div className="sync-base-grid">
                  {bases.map((b) => (
                    <section className="sync-card" key={b.code}>
                      <div className="sync-card-title">
                        <div>
                          <span className="sync-eyebrow">
                            {b.size === 0 ? "HUB BASE" : "COMPANY BASE"}
                          </span>
                          <h3>
                            {b.code} · {b.name}
                          </h3>
                        </div>
                        <span
                          className={`sync-pill ${b.supply.days < 3 ? "danger" : ""}`}
                        >
                          {b.supply.remaining <= 0
                            ? "No supplies"
                            : `${b.supply.days.toFixed(1)} days`}
                        </span>
                      </div>
                      <progress
                        aria-label={`${b.code} supply level`}
                        max={b.supply.capacity}
                        value={Math.min(b.supply.remaining, b.supply.capacity)}
                      />
                      <p>
                        {amount(b.supply.remaining)} /{" "}
                        {amount(b.supply.capacity)} kg · {b.gates} gates
                      </p>
                      <dl className="sync-facts">
                        <dt>Daily consumption</dt>
                        <dd>{amount(b.supply.daily)} kg</dd>
                        <dt>Estimated empty</dt>
                        <dd>{when(b.supply.emptyAt)}</dd>
                        <dt>Fill stores</dt>
                        <dd>
                          {amount(b.supply.fillKg)} kg ·{" "}
                          {money(b.supply.fillCost)}
                        </dd>
                        <dt>Treasury can cover fill</dt>
                        <dd>
                          {snapshot.treasury === null
                            ? "Unknown"
                            : snapshot.treasury >= b.supply.fillCost
                              ? "Yes"
                              : "No"}
                        </dd>
                        <dt>Network card this week</dt>
                        <dd>{b.supply.stamps} / 4 stamps</dd>
                        <dt>Next gate</dt>
                        <dd>
                          {b.supply.nextGateCost === null
                            ? "All four built"
                            : money(b.supply.nextGateCost)}
                        </dd>
                        <dt>Current supplies with extra gate</dt>
                        <dd>
                          {b.supply.nextGateDays === null
                            ? "—"
                            : `${b.supply.nextGateDays.toFixed(1)} days`}
                        </dd>
                      </dl>
                      <p className="sync-footnote">
                        Planning only. Buy supplies, build gates, and arrange
                        deliveries in the game. Affordability does not account
                        for pilot spending limits.
                      </p>
                    </section>
                  ))}
                </div>
              )}
            </>
          )}
          {tab === "Aircraft" && (
            <section className="sync-card">
              <div className="sync-card-title">
                <h3>Company aircraft inventory</h3>
              </div>
              {snapshot.fleet === null ? (
                <Empty text="Aircraft inventory unavailable." />
              ) : !snapshot.fleet.length ? (
                <Empty text="No company aircraft in this observation." />
              ) : (
                <Table
                  heads={[
                    "Aircraft",
                    "Type",
                    "Hours",
                    "Location / destination",
                    "Pilot",
                    "Reservation until",
                  ]}
                >
                  {snapshot.fleet.map((p, i) => (
                    <tr key={`${p.reg}-${i}`}>
                      <td>
                        <strong>{p.name || p.reg}</strong>
                        <small>{p.name ? p.reg : ""}</small>
                      </td>
                      <td>{p.type}</td>
                      <td>{p.hours.toFixed(1)}</td>
                      <td>
                        {p.at
                          ? `Parked · ${p.at.code}`
                          : p.end
                            ? `→ ${p.end.code}`
                            : "Location unavailable"}
                        {!p.at && p.lands && (
                          <small>
                            {p.lands > snapshot.fetchedAt
                              ? `Expected ${when(p.lands)}`
                              : "Arrival time passed; refresh to verify"}
                          </small>
                        )}
                      </td>
                      <td>
                        {p.by
                          ? (snapshot.company.members[p.by]?.cs ??
                            "Unknown pilot")
                          : "—"}
                      </td>
                      <td>
                        {p.at && p.held && p.held > snapshot.fetchedAt
                          ? when(p.held)
                          : "No active hold reported"}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              <p className="sync-footnote">
                Parked inventory and reported flight details at observation
                time. No aircraft are reserved or moved by Dispatch.
              </p>
            </section>
          )}
          {tab === "Requests" && (
            <section className="sync-card">
              <div className="sync-card-title">
                <h3>Aircraft purchase requests</h3>
              </div>
              {requests === undefined ? (
                <Empty text="Requests unavailable." />
              ) : !requests.length ? (
                <Empty text="No unexpired requests in this observation." />
              ) : (
                <Table
                  heads={[
                    "Requested by",
                    "Aircraft",
                    "Airport",
                    "Price",
                    "Treasury covers",
                    "Requested",
                    "Membership",
                  ]}
                >
                  {requests.map((r) => (
                    <tr key={r.id}>
                      <td>{r.cs}</td>
                      <td>{r.type}</td>
                      <td>{r.at.code}</td>
                      <td>{money(r.price)}</td>
                      <td>
                        {snapshot.treasury === null
                          ? "Unknown"
                          : snapshot.treasury >= r.price
                            ? "Yes"
                            : "No"}
                      </td>
                      <td>{when(r.t)}</td>
                      <td>
                        {Object.hasOwn(snapshot.company.members, r.pid)
                          ? "Current member"
                          : "No longer on roster"}
                      </td>
                    </tr>
                  ))}
                </Table>
              )}
              <p className="sync-footnote">
                Requests expire after three days in the current game.
                Affordability checks treasury funds only; approvals and pilot
                limits remain in-game.
              </p>
            </section>
          )}
          {tab === "Treasury" && (
            <>
              <div className="sync-stats">
                <Stat
                  label="Balance"
                  value={money(snapshot.treasury)}
                  sub="Company treasury"
                />
                <Stat
                  label="Recent net income"
                  value={money(income?.net)}
                  sub="Returned hourly records · last 24 hours"
                />
                <Stat
                  label="Jobs flown"
                  value={amount(snapshot.stats?.jobs)}
                  sub="Company statistics"
                />
                <Stat
                  label="Earned together"
                  value={money(snapshot.stats?.earned)}
                  sub="Company statistics"
                />
              </div>
              <section className="sync-card">
                <div className="sync-card-title">
                  <h3>Income breakdown</h3>
                </div>
                {income ? (
                  <>
                    <div className="sync-income">
                      <Stat
                        label="Flight share"
                        value={money(income.flights)}
                      />
                      <Stat label="Fuel & upkeep" value={money(income.costs)} />
                      <Stat label="Service fees" value={money(income.fees)} />
                      <Stat
                        label="Network bonuses"
                        value={money(income.network)}
                      />
                    </div>
                    <Table
                      heads={[
                        "Hour",
                        "Source",
                        "Pilot / airport",
                        "Count",
                        "Gross",
                        "Costs",
                        "Net",
                      ]}
                    >
                      {income.rows
                        .slice()
                        .sort((a, b) => b.h - a.h)
                        .map((r, i) => (
                          <tr key={i}>
                            <td>{when(r.h * 3600000)}</td>
                            <td>
                              {
                                {
                                  fly: "Flight share",
                                  fee: "Service fee",
                                  net: "Network bonus",
                                }[r.k]
                              }
                            </td>
                            <td>{r.of}</td>
                            <td>{amount(r.n)}</td>
                            <td>{money(r.amt)}</td>
                            <td>{money(r.cost ?? 0)}</td>
                            <td>{money(r.amt - (r.cost ?? 0))}</td>
                          </tr>
                        ))}
                    </Table>
                    {!income.rows.length && (
                      <Empty text="No income records returned for the last 24 hours." />
                    )}
                  </>
                ) : (
                  <Empty text="Income records unavailable." />
                )}
                <p className="sync-footnote">
                  This is the game’s recent income book, not a complete bank
                  ledger. Donations, purchases, and other balance changes may
                  not appear here.
                </p>
              </section>
            </>
          )}
          {tab === "Activity" && (
            <div className="sync-columns">
              <section className="sync-card">
                <div className="sync-card-title">
                  <h3>Recent company activity</h3>
                </div>
                {snapshot.log === null ? (
                  <Empty text="Activity log unavailable." />
                ) : !snapshot.log.length ? (
                  <Empty text="No log entries returned." />
                ) : (
                  snapshot.log
                    .slice()
                    .sort((a, b) => b.t - a.t)
                    .map((l, i) => (
                      <div className="sync-list-row" key={i}>
                        <Check size={15} />
                        <div>
                          <p>{l.text}</p>
                          <small>{when(l.t)}</small>
                        </div>
                      </div>
                    ))
                )}
              </section>
              <section className="sync-card">
                <div className="sync-card-title">
                  <h3>Company trophies</h3>
                </div>
                {snapshot.trophies === null ? (
                  <Empty text="Trophies unavailable." />
                ) : !snapshot.trophies.length ? (
                  <Empty text="No trophies returned." />
                ) : (
                  snapshot.trophies.map((t, i) => (
                    <div className="sync-list-row" key={i}>
                      <span className="sync-tag">#{t.place}</span>
                      <strong>{t.name}</strong>
                    </div>
                  ))
                )}
              </section>
            </div>
          )}
          {tab === "Trends" && (
            <section className="sync-card">
              <div className="sync-card-title">
                <h3>Changes between observations</h3>
                <select
                  aria-label="Observation to compare"
                  value={snapshot.fetchedAt}
                  onChange={(e) => {
                    const row = companyHistory.find(
                      (s) => s.fetchedAt === Number(e.target.value),
                    );
                    if (row) setSnapshot(row);
                  }}
                >
                  {!companyHistory.some(
                    (s) => s.fetchedAt === snapshot.fetchedAt,
                  ) && (
                    <option value={snapshot.fetchedAt}>
                      {when(snapshot.fetchedAt)} · unsaved
                    </option>
                  )}
                  {companyHistory.map((s) => (
                    <option key={s.fetchedAt} value={s.fetchedAt}>
                      {when(s.fetchedAt)}
                    </option>
                  ))}
                </select>
              </div>
              {changes && before ? (
                <>
                  <p className="sync-footnote">
                    {when(before.fetchedAt)} → {when(snapshot.fetchedAt)}.
                    Differences are observed within this interval, not exact
                    event times.
                  </p>
                  <div className="sync-income">
                    <Stat
                      label="Joined"
                      value={amount(changes.joined.length)}
                      sub={
                        changes.joined
                          .map((id) => snapshot.company.members[id].cs)
                          .join(", ") || "No observed additions"
                      }
                    />
                    <Stat
                      label="Left"
                      value={amount(changes.left.length)}
                      sub={
                        changes.left
                          .map((id) => before.company.members[id].cs)
                          .join(", ") || "No observed departures"
                      }
                    />
                    <Stat
                      label="Treasury change"
                      value={money(changes.treasury)}
                      sub="All balance movements combined"
                    />
                  </div>
                  <Table
                    heads={[
                      "Pilot",
                      "Company jobs Δ",
                      "Earned Δ",
                      "Donated Δ",
                      "Flying brought Δ",
                      "Role / limit",
                    ]}
                  >
                    {changes.pilots.map((p) => (
                      <tr key={p.id}>
                        <td>{p.cs}</td>
                        <td>{amount(p.jobs)}</td>
                        <td>{money(p.earned)}</td>
                        <td>{money(p.gave)}</td>
                        <td>{money(p.brought)}</td>
                        <td>{p.roleChanged ? "Changed" : "Unchanged"}</td>
                      </tr>
                    ))}
                  </Table>
                  <p className="sync-footnote">
                    Contribution deltas compare continuing members. Negative
                    values may reflect game corrections or resets.
                  </p>
                </>
              ) : (
                <Empty text="This is a baseline. Save another observation later to compare contributions and membership." />
              )}
              <div className="sync-history-controls">
                <p>
                  {companyHistory.length} saved observations for this company.
                  Up to 200 checks retained for 90 days. Exports contain private
                  company data, never your sync code.
                </p>
                {!demo && (
                  <div className="sync-actions">
                    <button disabled={busy} onClick={() => void clearHistory()}>
                      {clearArmed
                        ? "Confirm: delete this company’s history"
                        : "Clear company history"}
                    </button>
                    {clearArmed && (
                      <button onClick={() => setClearArmed(false)}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}
      <footer className="sync-footer">
        <span>
          Independent Pocket Pilots companion · Private company data stays on
          this computer.
        </span>
        <span>Observations, not continuous monitoring.</span>
      </footer>
    </main>
  );
}
function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="sync-stat">
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <div className="sync-empty">{text}</div>;
}
function Table({
  heads,
  children,
}: {
  heads: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="sync-table-wrap">
      <table>
        <thead>
          <tr>
            {heads.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
