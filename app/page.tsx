"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Radar,
  LockKeyhole,
  ChartNoAxesCombined,
  Building2,
  CloudSun,
  Globe,
  ArrowUpRight,
  Bell,
  Check,
  ChevronRight,
  Crosshair,
  Download,
  Flag,
  History,
  Trophy,
  CalendarDays,
  Map as MapIcon,
  Plane,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Shield,
  Star,
  Upload,
  X,
} from "lucide-react";
import IntelligenceDesk, {
  type IntelView,
} from "@/components/intelligence-desk";
import BasesDesk from "@/components/bases-desk";
import TerritoryMap from "@/components/territory-map";
import OperationsDesk, {
  type OperationsView,
} from "@/components/operations-desk";
import AirportDetail, { statusLabels } from "@/components/airport-detail";
import Dialog from "@/components/dialog";
import CompanyProvider, { useCompany } from "@/components/company-provider";
import LocationEntry from "@/components/location-entry";
import {
  assess,
  EMPTY_SNAPSHOT,
  nm,
  type Snapshot,
  type Airport,
  type Assessment,
} from "@/lib/dispatch";
import { mergeObservation, type LocalRun, type Backup } from "@/lib/local-db";
import { parseBackup } from "@/lib/backup";
import { discoveryReferences, discoveryCenter } from "@/lib/discovery";
import type { Fleet } from "@/lib/operations";
import AnalyticsWorkspace from "@/components/analytics-workspace";
import RecentlyLostAirports from "@/components/recently-lost-airports";
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const stamp = (n: number) =>
  n
    ? new Date(n).toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "Not checked";
const pref = <T,>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const put = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};
type Mode =
  | "analytics"
  | "overview"
  | "defense"
  | "targets"
  | "activity"
  | "bases"
  | OperationsView
  | IntelView;
type Discovery = Snapshot & {
  found: number;
  verified: number;
  warnings: string[];
  center: Airport;
  radius: number;
  holders: Record<string, { co: string }>;
};
const nav = [
  { id: "overview" as Mode, name: "Territory overview", icon: MapIcon },
  { id: "analytics" as Mode, name: "Analytics", icon: ChartNoAxesCombined },
  { id: "defense" as Mode, name: "Airport defense", icon: Shield },
  { id: "targets" as Mode, name: "Expansion targets", icon: Crosshair },
  { id: "activity" as Mode, name: "Activity log", icon: History },
  { id: "bases" as Mode, name: "Bases & projects", icon: Building2 },
  { id: "fleet" as Mode, name: "Fleet board", icon: Plane },
  { id: "events" as Mode, name: "Event briefing", icon: CalendarDays },
  { id: "rankings" as Mode, name: "Pilot rankings", icon: Trophy },
  { id: "radar" as Mode, name: "Rival radar", icon: Radar },
  { id: "weather" as Mode, name: "Weather briefings", icon: CloudSun },
  { id: "regional" as Mode, name: "Regional boards", icon: Globe },
];
export default function Page() {
  return (
    <CompanyProvider>
      <Dispatch />
    </CompanyProvider>
  );
}
function Dispatch() {
  const {
    company,
    db: { loadLocal, recordLocal, saveWatch, importLocal },
    changeCompany,
  } = useCompany();
  const prefKey = (key: string) => `pilots-dispatch:${company.id}:${key}`;
  const empty = { ...EMPTY_SNAPSHOT, companyId: company.id };
  const catalog: Airport[] = [];
  const [data, setData] = useState<Snapshot>(empty),
    [mode, setMode] = useState<Mode>("overview"),
    [selected, setSelected] = useState(""),
    [watch, setWatch] = useState<Airport[]>([]),
    [runs, setRuns] = useState<LocalRun[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [initialized, setInitialized] = useState(false),
    [storage, setStorage] = useState("Opening local database…");
  const [query, setQuery] = useState(""),
    [settings, setSettings] = useState(false),
    [adding, setAdding] = useState(false),
    [airportSearch, setAirportSearch] = useState(""),
    [threshold, setThreshold] = useState(20),
    [auto, setAuto] = useState(false),
    [notifications, setNotifications] = useState(false);
  const [fleet, setFleet] = useState<Fleet>();
  const [localRevision, setLocalRevision] = useState(0);
  const [discovery, setDiscovery] = useState<Discovery | null>(null),
    [searchBusy, setSearchBusy] = useState(false),
    [center, setCenter] = useState(""),
    [radius, setRadius] = useState(50),
    [sort, setSort] = useState("points"),
    [tick, setTick] = useState(Date.now()),
    [restore, setRestore] = useState<Backup | null>(null);
  const dataRef = useRef(data),
    watchRef = useRef(watch),
    busyRef = useRef(false),
    autoRef = useRef(false),
    nextFetch = useRef(0),
    notifyRef = useRef(false),
    thresholdRef = useRef(20),
    notificationStates = useRef(new Map<string, string>()),
    importInput = useRef<HTMLInputElement>(null),
    cooldown = useRef(0),
    restoreRef = useRef(false);
  const select = useCallback((code: string) => setSelected(code), []),
    closeDetail = useCallback(() => setSelected(""), []);
  const refresh = useCallback(async (fresh = true) => {
    if (busyRef.current || restoreRef.current) return;
    if (Date.now() < cooldown.current) {
      setError(
        `The game asked us to wait. Try after ${stamp(cooldown.current)}.`,
      );
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    nextFetch.current = Date.now() + 300000;
    try {
      const response = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: company.id,
          fresh,
          watch: watchRef.current,
          previous: dataRef.current.airports
            .filter(
              (a) =>
                !!dataRef.current.air.held[a.code] ||
                dataRef.current.previous?.includes(a.code),
            )
            .slice(0, 128),
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw Error(
          "The server did not return JSON. Try again or check the server connection.",
        );
      const incoming = (await response.json()) as Snapshot & { error?: string };
      if (!response.ok) {
        if (response.status === 429)
          cooldown.current =
            Date.now() +
            (Number(response.headers.get("Retry-After")) || 300) * 1000;
        throw Error(incoming.error || "Refresh failed");
      }
      let result = mergeObservation(
        dataRef.current.airFetchedAt ? dataRef.current : null,
        incoming as Snapshot,
      );
      try {
        result = await recordLocal(incoming);
        const local = await loadLocal();
        setRuns(local.runs);
        setFleet(local.operations?.fleet);
        setStorage("Saved in this browser");
      } catch (e) {
        if (e instanceof Error && e.message.includes("older airspace")) throw e;
        result = { ...result, historySaved: false };
        setStorage("Local save failed");
        setNote(
          "Fresh data is visible, but this check could not be saved locally. Export a backup before closing.",
        );
      }
      dataRef.current = result;
      setData(result);
      setTick(Date.now());
      const alerts = assess(result, undefined, thresholdRef.current);
      for (const a of alerts) {
        const old = notificationStates.current.get(a.code);
        if (a.verified || a.lost) {
          notificationStates.current.set(a.code, a.status);
          if (
            notifyRef.current &&
            old !== a.status &&
            ["urgent", "watch", "lost"].includes(a.status) &&
            Notification.permission === "granted"
          )
            new Notification(`Pilots Dispatch · ${a.code}`, {
              body: a.lost
                ? "company no longer holds this airport."
                : `${statusLabels[a.status]}: ${fmt(a.gap)} point lead over ${a.rivalTag}.`,
              tag: `dispatch-${company.id}-${a.code}`,
            });
        }
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not refresh. Previous data retained.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "analytics")
      setMode("analytics");
    let mounted = true;
    (async () => {
      try {
        let local = await loadLocal();
        if (!mounted) return;
        const snapshot = local.snapshot ?? empty;
        dataRef.current = snapshot;
        setData(snapshot);
        watchRef.current = local.watch;
        setWatch(local.watch);
        setRuns(local.runs);
        setFleet(local.operations?.fleet);
        setStorage("Saved in this browser");
        for (const a of assess(snapshot))
          notificationStates.current.set(a.code, a.status);
      } catch {
        if (mounted) {
          setStorage("Local database unavailable");
          setNote(
            "Your browser could not open local storage. Live checks still work; export before closing to keep your data.",
          );
        }
      }
      if (mounted) {
        const t = pref(prefKey("threshold"), 20),
          automatic = pref(prefKey("auto"), false);
        setThreshold(t);
        thresholdRef.current = t;
        setAuto(automatic);
        autoRef.current = automatic;
        nextFetch.current = Date.now() + 300000;
        setInitialized(true);
      }
    })();
    const timer = setInterval(() => {
      setTick(Date.now());
      if (
        autoRef.current &&
        !document.hidden &&
        Date.now() >= nextFetch.current
      )
        void refresh(false);
    }, 30000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [refresh]);
  const assessments = useMemo(
    () =>
      assess(
        {
          ...data,
          airports: [
            ...new Map(
              [...watch, ...data.airports].map((a) => [a.code, a]),
            ).values(),
          ],
        },
        undefined,
        threshold,
      ),
    [data, watch, threshold],
  );
  const discovered = useMemo(
    () => (discovery ? assess(discovery, [], threshold) : []),
    [discovery, threshold],
  );
  const all = useMemo(() => {
    const map = new Map(assessments.map((a) => [a.code, a]));
    for (const a of discovered)
      if (
        !map.has(a.code) ||
        (!map.get(a.code)!.held &&
          a.board?.fetchedAt! > (map.get(a.code)!.board?.fetchedAt ?? 0))
      )
        map.set(a.code, a);
    return [...map.values()];
  }, [assessments, discovered]);
  const alerts = assessments
    .filter((a) => ["lost", "urgent", "watch"].includes(a.status))
    .sort(
      (a, b) =>
        ({ lost: 0, urgent: 1, watch: 2, secure: 3, target: 4, unknown: 5 })[
          a.status
        ] -
          { lost: 0, urgent: 1, watch: 2, secure: 3, target: 4, unknown: 5 }[
            b.status
          ] || a.gap - b.gap,
    );
  const held = assessments.filter((a) => a.held),
    verified = held.filter((a) => a.verified).length;
  const targets = all
    .filter((a) => !a.held && !a.lost)
    .sort(
      (a, b) =>
        Number(b.verified) - Number(a.verified) ||
        (sort === "distance"
          ? a.distance - b.distance
          : sort === "competition"
            ? a.leader - b.leader
            : a.needed - b.needed) ||
        a.distance - b.distance,
    );
  const referenceGroups = discoveryReferences(data, fleet, held, watch);
  const referenceAirports = referenceGroups.flatMap((group) => group.airports);
  const chosenCenter = discoveryCenter(referenceAirports, center);
  const current = all.find((a) => a.code === selected),
    opportunity = targets.find((a) => a.verified);
  const filtered = (
    mode === "targets"
      ? targets
      : mode === "defense"
        ? [
            ...alerts,
            ...assessments
              .filter((a) => a.held && !alerts.includes(a))
              .sort(
                (a, b) =>
                  Number(a.verified) - Number(b.verified) || a.gap - b.gap,
              ),
          ]
        : assessments.filter((a) => a.held || a.lost)
  ).filter((a) =>
    `${a.code} ${a.name}`.toLowerCase().includes(query.toLowerCase()),
  );
  const matches =
    airportSearch.length >= 2
      ? [...new Map([...all, ...catalog].map((a) => [a.code, a])).values()]
          .filter((a) =>
            `${a.code} ${a.name}`
              .toLowerCase()
              .includes(airportSearch.toLowerCase()),
          )
          .slice(0, 8)
      : [];
  const eventList = runs
    .flatMap((r) =>
      r.changes.map((c) => ({ ...c, id: `${r.id}-${c.code}-${c.kind}` })),
    )
    .filter(
      (c) =>
        !query ||
        `${c.code} ${c.text}`.toLowerCase().includes(query.toLowerCase()),
    );
  const age = data.airFetchedAt
    ? Math.floor((tick - data.airFetchedAt) / 60000)
    : 0;
  async function toggleWatch(a: Airport) {
    const exists = watchRef.current.some((w) => w.code === a.code);
    if (!exists && watchRef.current.length >= 24) {
      setNote(
        "Your watchlist holds up to 24 airports. Remove one before adding another.",
      );
      return;
    }
    const next = exists
      ? watchRef.current.filter((w) => w.code !== a.code)
      : [
          ...watchRef.current,
          { code: a.code, name: a.name, lat: a.lat, lon: a.lon },
        ];
    try {
      await saveWatch(next);
      watchRef.current = next;
      setWatch(next);
      setNote(
        `${a.code} ${exists ? "removed from" : "added to"} your local watchlist. Refresh data to update watched standings.`,
      );
    } catch {
      setNote("Could not save the watchlist in this browser.");
    }
  }
  async function discover() {
    const chosen = chosenCenter;
    if (!chosen) return;
    setSearchBusy(true);
    setError("");
    try {
      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: company.id, center: chosen, radius }),
        signal: AbortSignal.timeout(90000),
      });
      const result = (await response.json()) as Discovery & { error?: string };
      if (!response.ok) throw Error(result.error || "Search failed");
      setDiscovery(result);
      setMode("targets");
      setSelected("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Nearby search failed");
    } finally {
      setSearchBusy(false);
    }
  }
  async function exportBackup() {
    try {
      let local: Backup;
      try {
        local = await loadLocal();
      } catch {
        local = {
          format: "pilots-dispatch",
          version: 1,
          companyId: company.id,
          exportedAt: Date.now(),
          snapshot: dataRef.current,
          watch: watchRef.current,
          runs,
        };
      }
      if (dataRef.current.airFetchedAt > (local.snapshot?.airFetchedAt ?? 0))
        local.snapshot = dataRef.current;
      const url = URL.createObjectURL(
          new Blob([JSON.stringify(local, null, 2)], {
            type: "application/json",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `pilots-dispatch-${company.id}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNote("Local backup exported. Keep it somewhere safe.");
    } catch {
      setNote("Backup export failed. Please try again.");
    }
  }
  async function chooseBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 25000000)
        throw Error("Backup must be smaller than 25 MB.");
      const backup = parseBackup(JSON.parse(await file.text()));
      if (backup.companyId !== company.id)
        throw Error(
          "This backup belongs to another company. Switch companies before importing it.",
        );
      restoreRef.current = true;
      setRestore(backup);
    } catch (e) {
      setNote(
        e instanceof Error &&
          (e.message.includes("25 MB") || e.message.includes("another company"))
          ? e.message
          : "This file is not a valid Pilots Dispatch backup. Nothing was changed.",
      );
    }
    if (importInput.current) importInput.current.value = "";
  }
  async function restoreBackup() {
    if (!restore) return;
    try {
      await importLocal(restore);
      const local = await loadLocal();
      dataRef.current = local.snapshot ?? empty;
      watchRef.current = local.watch;
      setData(dataRef.current);
      setWatch(local.watch);
      setRuns(local.runs);
      setFleet(local.operations?.fleet);
      setLocalRevision((revision) => revision + 1);
      setDiscovery(null);
      setSelected("");
      restoreRef.current = false;
      setRestore(null);
      setStorage("Saved in this browser");
      setNote(
        "Backup restored locally. Refresh when you want a new game observation.",
      );
    } catch {
      setNote("Restore failed. Your existing local records were retained.");
    }
  }
  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNote(
        "Desktop notifications are not supported here. Defense alerts remain available on the page.",
      );
      return;
    }
    const permission = await Notification.requestPermission();
    notifyRef.current = permission === "granted";
    setNotifications(notifyRef.current);
    setNote(
      permission === "granted"
        ? "Notifications enabled for meaningful changes observed while this page is open."
        : "Desktop notifications are blocked. In-page alerts remain available.",
    );
  }
  const switchMode = (m: Mode) => {
    setMode(m);
    setQuery("");
    setSelected("");
  };
  const isIntel = ["radar", "weather", "regional"].includes(mode);
  const isOperations =
    isIntel || ["bases", "fleet", "events", "rankings"].includes(mode);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Pilots Dispatch home">
          <div className="brand-emblem">
            <Star size={24} fill="currentColor" />
          </div>
          <div>
            PILOTS <span>DISPATCH</span>
          </div>
        </a>
        <button
          className="company-switch"
          onClick={changeCompany}
          aria-label="Switch company"
        >
          <strong>{company.tag}</strong>
          <span>{company.name}</span>
          <small>Switch company ↗</small>
        </button>
        <div className="nav-label">PUBLIC · NO CODE REQUIRED</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.name}
              title={n.name}
              onClick={() => switchMode(n.id)}
              className={`nav-button ${mode === n.id ? "active" : ""}`}
            >
              <n.icon size={18} />
              {n.name}
              {n.id === "defense" && alerts.length > 0 && (
                <b>{alerts.length}</b>
              )}
            </button>
          ))}
          <button
            className="nav-button"
            aria-label={`Watchlist (${watch.length})`}
            title="Watchlist"
            onClick={() => setAdding(true)}
          >
            <Star size={18} />
            Watchlist <b>{watch.length}</b>
          </button>
        </nav>
        <div className="nav-label">PRIVATE · LOCAL ONLY</div>
        <a className="nav-button" href="/sync">
          <LockKeyhole size={18} />
          Private Sync
        </a>
        <div className="sidebar-bottom">
          <div className="dispatch-note">
            <Star size={19} />
            <p>
              {company.name}
              <br />
              Company operations desk.
            </p>
          </div>
          <button
            className="nav-button"
            aria-label="Dispatch settings"
            title="Dispatch settings"
            onClick={() => setSettings(true)}
          >
            <Settings2 size={18} />
            Dispatch settings
          </button>
          <a
            className="nav-button"
            aria-label="Open Pocket Pilots"
            title="Open Pocket Pilots"
            href="https://pilots.nimblebit.com"
            target="_blank"
            rel="noreferrer"
          >
            <Plane size={18} />
            Open Pocket Pilots
            <ArrowUpRight size={15} />
          </a>
          <div className="sidebar-foot">
            Independent companion
            <br />
            History stays in this browser
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div className="breadcrumb">
            {company.tag} Dispatch <ChevronRight size={14} />
            <span>{nav.find((n) => n.id === mode)?.name}</span>
          </div>
          <div className="top-actions">
            <div className="refresh-status" role="status">
              <strong>
                {busy
                  ? "Checking company & standings…"
                  : data.airFetchedAt
                    ? `${isOperations || mode === "analytics" ? "Territory checked" : "Last checked"} ${new Date(data.airFetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                    : "Ready for first check"}
              </strong>
              <span>
                {auto
                  ? "Auto-check every 5 min while open"
                  : "On-demand refresh"}
                {data.airFetchedAt
                  ? ` · ${age < 1 ? "just now" : `${age} min ago`}`
                  : ""}
              </span>
            </div>
            <button
              className="button refresh"
              disabled={busy || searchBusy || !initialized || !!restore}
              onClick={() => void refresh(true)}
            >
              <RefreshCw size={15} className={busy ? "spin" : ""} />
              {busy
                ? "Refreshing…"
                : isOperations || mode === "analytics"
                  ? "Refresh territory"
                  : "Refresh data"}
            </button>
            <button
              className="icon-button"
              aria-label="Notification settings"
              onClick={() => setSettings(true)}
            >
              <Bell size={18} />
              {alerts.length > 0 && <i />}
            </button>
          </div>
        </header>
        <div className="mobile-freshness" role="status">
          {busy
            ? "Checking company & standings…"
            : data.airFetchedAt
              ? `${isOperations || mode === "analytics" ? "Territory checked" : "Last checked"} ${stamp(data.airFetchedAt)}`
              : "Ready for first check"}{" "}
          · {auto ? "Auto-check on" : "On demand"}
        </div>
        <div className="main-content">
          <section className="page-heading compact-masthead">
            <div className="masthead-art dispatch-chart" aria-hidden="true">
              <Plane size={130} />
            </div>
            <div className="masthead-copy">
              <div className="eyebrow">
                <span className="wing-lines" />
                {company.name} · AIR OPERATIONS
              </div>
              <h1>
                {mode === "overview"
                  ? `${company.tag} Dispatch`
                  : mode === "analytics"
                    ? "Analytics"
                    : mode === "defense"
                      ? "Airport defense"
                      : mode === "targets"
                        ? "Expansion targets"
                        : mode === "bases"
                          ? "Bases & projects"
                          : mode === "fleet"
                            ? "Fleet board"
                            : mode === "events"
                              ? "Event briefing"
                              : mode === "rankings"
                                ? "Pilot rankings"
                                : mode === "radar"
                                  ? "Rival radar"
                                  : mode === "weather"
                                    ? "Weather briefings"
                                    : mode === "regional"
                                      ? "Regional boards"
                                      : "Activity log"}
              </h1>
              {mode !== "overview" && (
                <p>
                  {mode === "analytics"
                    ? "Earnings, distance, and flight activity."
                    : mode === "defense"
                      ? "Keep your ground. Watch the gaps."
                      : mode === "targets"
                        ? "Find your next foothold."
                        : mode === "bases"
                          ? "Build a presence. Know the neighborhood."
                          : mode === "fleet"
                            ? "Follow your company through the skies."
                            : mode === "events"
                              ? "A new mission on the horizon."
                              : mode === "rankings"
                                ? "See where your flying takes you."
                                : mode === "radar"
                                  ? "Keep an eye on the neighborhood."
                                  : mode === "weather"
                                    ? "Read the skies before you go."
                                    : mode === "regional"
                                      ? "Your company. A wider horizon."
                                      : "Every check tells a story."}
                </p>
              )}
            </div>
            <span className="masthead-mark" aria-hidden="true">
              ★ {company.tag} ★
            </span>
          </section>
          {error && (
            <div className="notice" role="alert">
              {error}{" "}
              {data.airFetchedAt
                ? "Your last successful observation is still shown."
                : ""}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {!!data.errors.length && (
            <div className="notice" role="status">
              Partial check: {data.errors.length} airport standings could not be
              verified. Older values keep their original timestamps.
            </div>
          )}
          {note && (
            <div className="notice" role="status">
              {note}
              <button aria-label="Dismiss message" onClick={() => setNote("")}>
                <X size={15} />
              </button>
            </div>
          )}
          {!isOperations && mode !== "analytics" && (
            <>
              <div className="dispatch-briefing">
                <div>
                  <span className="eyebrow">DISPATCH BRIEFING</span>
                  <p>
                    {!data.airFetchedAt
                      ? "Your first live check establishes the local history baseline."
                      : alerts.length
                        ? `${alerts.length} airport${alerts.length === 1 ? " needs" : "s need"} attention. ${verified} of ${held.length} holdings have verified standings.`
                        : verified < held.length
                          ? `${held.length - verified} holdings need a standings check before an all-clear.`
                          : "No close contests in verified standings. Choose a nearby search to plan your next move."}
                  </p>
                </div>
                <button
                  className="text-link"
                  onClick={() =>
                    switchMode(alerts.length ? "defense" : "targets")
                  }
                >
                  {alerts.length ? "Review defense" : "Explore targets"}
                  <ArrowUpRight size={14} />
                </button>
              </div>
              <section className="stats">
                <div className="stat">
                  <div className="stat-label">
                    AIRPORTS HELD
                    <Flag size={17} />
                  </div>
                  <div className="stat-value">
                    {data.airFetchedAt
                      ? Object.keys(data.air.held).length
                      : "—"}
                    <span>territories</span>
                  </div>
                  <div className="stat-foot">Observed company control</div>
                </div>
                <div className="stat">
                  <div className="stat-label">
                    DEFENSE ALERTS
                    <Shield size={17} />
                  </div>
                  <div className={`stat-value ${alerts.length ? "warm" : ""}`}>
                    {data.airFetchedAt ? alerts.length : "—"}
                    <span>need attention</span>
                  </div>
                  <div className="stat-foot">
                    {verified} / {held.length} holdings verified
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">
                    EXPANSION OPTIONS
                    <Crosshair size={17} />
                  </div>
                  <div className="stat-value">
                    {targets.filter((a) => a.verified).length}
                    <span>verified</span>
                  </div>
                  <div className="stat-foot">
                    {targets.filter((a) => !a.verified).length} need checking
                  </div>
                </div>
                <div className="stat">
                  <div className="stat-label">
                    {company.tag} IN THE AIR
                    <Plane size={17} />
                  </div>
                  <div className="stat-value">
                    {data.airFetchedAt ? data.air.flights.length : "—"}
                    <span>flights</span>
                  </div>
                  <div className="stat-foot">At the last territory check</div>
                </div>
              </section>
            </>
          )}
          {!isOperations && mode !== "analytics" && !data.airFetchedAt && (
            <section className="first-check">
              <RadioMark />
              <h2>Your operations desk is ready.</h2>
              <p>
                Check your company’s territory and airport standings. History is
                stored only in this browser; nothing polls the game until you
                ask.
              </p>
              <button
                className="button refresh"
                disabled={busy || !initialized}
                onClick={() => void refresh(true)}
              >
                <RefreshCw size={15} />
                Start first check
              </button>
            </section>
          )}
          {mode === "targets" && (
            <section className="discovery-card">
              <div>
                <span className="eyebrow">NEARBY DISCOVERY</span>
                <h2>Find your next foothold.</h2>
                <p>
                  Search game airports, then verify the nearest eight
                  candidates. Start from a current flight destination, a parked
                  plane’s airport, or a held or watched airport.
                </p>
              </div>
              <div className="discovery-controls">
                <label>
                  Start from
                  <select
                    aria-label="Discovery reference airport"
                    value={chosenCenter?.code ?? ""}
                    disabled={!chosenCenter}
                    onChange={(e) => setCenter(e.target.value)}
                  >
                    {!chosenCenter && (
                      <option value="">Refresh data to load airports</option>
                    )}
                    {referenceGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.airports.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  Radius
                  <select
                    aria-label="Search radius"
                    value={radius}
                    onChange={(e) => setRadius(Number(e.target.value))}
                  >
                    {[25, 50, 100].map((n) => (
                      <option key={n} value={n}>
                        {n} nm
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button refresh"
                  disabled={searchBusy || busy || !referenceAirports.length}
                  onClick={() => void discover()}
                >
                  <Search size={15} />
                  {searchBusy ? "Checking nearby…" : "Find opportunities"}
                </button>
              </div>
              {discovery && (
                <p className="discovery-result">
                  {discovery.found} nearby airports found · {discovery.verified}{" "}
                  of {discovery.airports.length} shortlisted candidates verified
                  · within {discovery.radius} nm of {discovery.center.code}.
                  Search completed {stamp(discovery.generatedAt)}. Watch a
                  candidate to keep it after reload.{" "}
                  {discovery.warnings.join(" ")}
                </p>
              )}
            </section>
          )}
          {mode === "analytics" ? (
            <AnalyticsWorkspace
              key={localRevision}
              snapshot={data}
              runs={runs}
              now={tick}
              threshold={threshold}
              onDefense={() => switchMode("defense")}
              onInspectAirport={(code) => {
                setMode("defense");
                select(code);
              }}
            />
          ) : mode === "bases" ? (
            <BasesDesk
              snapshot={data}
              watch={watch}
              onWatch={(a) => void toggleWatch(a)}
            />
          ) : isIntel ? (
            <IntelligenceDesk view={mode as IntelView} snapshot={data} />
          ) : isOperations ? (
            <OperationsDesk
              view={mode as OperationsView}
              snapshot={data}
              onFleetChange={setFleet}
              onView={(v) => setMode(v)}
              onInspectAirport={(code) => {
                setMode("overview");
                select(code);
              }}
            />
          ) : mode === "activity" ? (
            <section className="activity-card">
              <div className="card-heading">
                <div>
                  <h2>Observed changes</h2>
                  <p>
                    {runs.length} local checks · retained for 90 days, up to
                    1,000 checks
                  </p>
                </div>
                <button
                  className="button compact"
                  onClick={() => void exportBackup()}
                >
                  <Download size={14} />
                  Export backup
                </button>
              </div>
              <div className="table-toolbar">
                <label>
                  <Search size={15} />
                  <input
                    aria-label="Filter activity"
                    placeholder="Airport or change…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <span>{eventList.length} events</span>
              </div>
              {eventList.length ? (
                eventList.slice(0, 100).map((c) => (
                  <button
                    className="activity-row"
                    key={c.id}
                    onClick={() => {
                      setMode("overview");
                      select(c.code);
                    }}
                  >
                    <span className={`event-icon ${c.kind}`}>
                      <Flag size={17} />
                    </span>
                    <div>
                      <strong>
                        {c.code} · {c.text}
                      </strong>
                      <span>
                        Observed between {stamp(c.from)} and {stamp(c.to)}
                      </span>
                    </div>
                    <ChevronRight size={16} />
                  </button>
                ))
              ) : (
                <div className="empty">
                  <History size={28} />
                  <h3>
                    {query
                      ? "No matching events."
                      : runs.length
                        ? "Baseline established."
                        : "No saved checks yet."}
                  </h3>
                  <p>
                    {query
                      ? "Try another airport code or change description."
                      : runs.length
                        ? "Changes will appear after later refreshes. Unchanged checks do not create events."
                        : "Run your first refresh to start local territory history."}
                  </p>
                </div>
              )}
              <details className="run-list">
                <summary>Recent refresh checks</summary>
                {runs.slice(0, 20).map((r) => (
                  <div key={r.id}>
                    <span>{stamp(r.at)}</span>
                    <span>
                      {r.held} held · {r.checked}/{r.total} verified ·{" "}
                      {r.changes.length} changes
                    </span>
                  </div>
                ))}
              </details>
            </section>
          ) : (
            <>
              {mode === "defense" && (
                <RecentlyLostAirports
                  snapshot={data}
                  runs={runs}
                  airports={assessments}
                  now={tick}
                  onSelect={select}
                />
              )}
              <div
                className={`workspace-grid ${current ? "has-selection" : "no-selection"}`}
              >
                <section className="map-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        {mode === "targets"
                          ? "Opportunity map"
                          : "Territory map"}
                      </h2>
                      <p>
                        {mode === "defense"
                          ? "Defense conditions and verification gaps"
                          : mode === "targets"
                            ? "Verified candidates & local watchlist"
                            : "Company holdings and airport control"}
                      </p>
                    </div>
                    <div className="map-tabs">
                      <button
                        className={mode !== "targets" ? "selected" : ""}
                        onClick={() => switchMode("overview")}
                      >
                        Territory
                      </button>
                      <button
                        className={mode === "targets" ? "selected" : ""}
                        onClick={() => switchMode("targets")}
                      >
                        Targets
                      </button>
                    </div>
                  </div>
                  <TerritoryMap
                    airports={all}
                    selected={selected}
                    onSelect={select}
                    view={mode}
                  />
                </section>
                {current ? (
                  <AirportDetail
                    airport={current}
                    watching={watch.some((w) => w.code === current.code)}
                    onWatch={() => void toggleWatch(current)}
                    onClose={closeDetail}
                    changes={runs
                      .flatMap((r) => r.changes)
                      .filter((c) => c.code === current.code)}
                    refreshKey={data.generatedAt}
                  />
                ) : (
                  <section className="brief-card selection-prompt">
                    <Crosshair size={28} />
                    <h3>Inspect an airport.</h3>
                    <p>
                      Select a marker or airport row for standings, operations,
                      and observed changes.
                    </p>
                    <div className="prompt-rule" />
                    <span className="eyebrow">LOCAL FLIGHT LOG</span>
                    <strong>{runs.length} checks saved</strong>
                    <small>{storage}</small>
                  </section>
                )}
              </div>
              <section className="lower-grid">
                <div className="table-card">
                  <div className="card-heading">
                    <div>
                      <h2>
                        {mode === "targets"
                          ? "Expansion shortlist"
                          : mode === "defense"
                            ? "Defense priorities"
                            : "Territory watch"}
                      </h2>
                      <p>
                        {mode === "targets"
                          ? "Verified estimates first · score is not a guarantee of control"
                          : "Ownership and standings verified separately"}
                      </p>
                    </div>
                    <button
                      className="button compact"
                      onClick={() => setAdding(true)}
                    >
                      <Star size={14} />
                      Watchlist ({watch.length})
                    </button>
                  </div>
                  <div className="table-toolbar">
                    <label>
                      <Search size={15} />
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Find an airport…"
                        aria-label="Filter airports"
                      />
                    </label>
                    {mode === "targets" ? (
                      <select
                        aria-label="Sort targets"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="points">Fewest points</option>
                        <option value="distance">Nearest holding</option>
                        <option value="competition">Lowest leader score</option>
                      </select>
                    ) : (
                      <span>{filtered.length} airports</span>
                    )}
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>AIRPORT</th>
                          <th>
                            {mode === "targets" ? "TO LEAD" : "COMPANY SCORE"}
                          </th>
                          <th>
                            {mode === "targets"
                              ? "NEAREST HOLDING"
                              : "LEAD / RIVAL"}
                          </th>
                          <th>STATUS</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((a) => (
                          <tr
                            key={a.code}
                            className={selected === a.code ? "chosen" : ""}
                            onClick={() => select(a.code)}
                          >
                            <td>
                              <button
                                className="airport-name"
                                onClick={() => select(a.code)}
                              >
                                <strong>{a.code}</strong>
                                <span>{a.name}</span>
                                {mode === "targets" &&
                                  discovery?.holders[a.code] && (
                                    <small>
                                      Listed holder:{" "}
                                      {a.board?.cos[
                                        discovery.holders[a.code].co
                                      ]?.tag ?? discovery.holders[a.code].co}
                                    </small>
                                  )}
                              </button>
                            </td>
                            <td
                              className="numeric"
                              data-label={
                                mode === "targets" ? "To lead" : "company score"
                              }
                            >
                              {!a.verified
                                ? "—"
                                : fmt(mode === "targets" ? a.needed : a.score)}
                            </td>
                            <td
                              data-label={
                                mode === "targets"
                                  ? "Nearest holding"
                                  : "Lead / rival"
                              }
                            >
                              {!a.verified ? (
                                "—"
                              ) : mode === "targets" ? (
                                Number.isFinite(a.distance) ? (
                                  `${Math.round(a.distance)} nm`
                                ) : (
                                  "No holdings"
                                )
                              ) : a.rival ? (
                                <>
                                  <strong className={a.gap < 0 ? "warm" : ""}>
                                    {a.gap >= 0 ? "+" : ""}
                                    {fmt(a.gap)}
                                  </strong>
                                  <small>vs {a.rivalTag}</small>
                                </>
                              ) : (
                                "Uncontested"
                              )}
                            </td>
                            <td>
                              <span className={`badge ${a.status}`}>
                                {statusLabels[a.status]}
                              </span>
                              {a.lost && !a.verified && (
                                <small>Standings unverified</small>
                              )}
                            </td>
                            <td>
                              <button
                                className="row-open"
                                aria-label={`View ${a.code}`}
                                onClick={() => select(a.code)}
                              >
                                <ArrowUpRight size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!filtered.length && (
                      <div className="empty">
                        {data.airFetchedAt
                          ? "No matching airports. Run a nearby search or adjust the filter."
                          : "Your first check will populate this board."}
                      </div>
                    )}
                  </div>
                </div>
                <aside className="action-column">
                  <section className="alert-card">
                    <div className="card-heading">
                      <h2>
                        <Shield size={17} />
                        Defense desk
                      </h2>
                      <span className="count">{alerts.length}</span>
                    </div>
                    {alerts.length ? (
                      alerts.slice(0, 4).map((a) => (
                        <button
                          className="alert-item"
                          key={a.code}
                          onClick={() => select(a.code)}
                        >
                          <span
                            className={`dot ${a.status === "watch" ? "amber" : "red"}`}
                          />
                          <div>
                            <strong>
                              {a.code} · {statusLabels[a.status]}
                            </strong>
                            <p>
                              {a.lost
                                ? "Confirmed absent from company holdings"
                                : `${fmt(a.gap)} point lead over ${a.rivalTag}`}
                            </p>
                          </div>
                          <ChevronRight size={15} />
                        </button>
                      ))
                    ) : (
                      <div className="all-clear">
                        <div>
                          <Check size={24} />
                        </div>
                        <h3>
                          {!data.airFetchedAt
                            ? "Ready to check"
                            : verified < held.length
                              ? "Verification incomplete"
                              : "Holding steady."}
                        </h3>
                        <p>
                          {!data.airFetchedAt
                            ? "Refresh to check airport defense."
                            : verified < held.length
                              ? "Some holdings still need standings before an all-clear."
                              : "No close contests in verified standings at the last check."}
                        </p>
                      </div>
                    )}
                    <div className="alert-foot">
                      {verified}/{held.length} holdings verified · watch below{" "}
                      {threshold}% lead.{" "}
                      <button onClick={() => setSettings(true)}>
                        Adjust <ArrowUpRight size={12} />
                      </button>
                    </div>
                  </section>
                  <section className="opportunity-card">
                    <span className="eyebrow">NEXT OPPORTUNITY</span>
                    {opportunity ? (
                      <>
                        <h3>
                          {opportunity.code}
                          <ArrowUpRight size={21} />
                        </h3>
                        <p>{opportunity.name}</p>
                        <div>
                          <strong>{fmt(opportunity.needed)}</strong>
                          <span>additional points to lead</span>
                        </div>
                        <button
                          onClick={() => {
                            setMode("targets");
                            select(opportunity.code);
                          }}
                        >
                          Inspect target
                          <ChevronRight size={15} />
                        </button>
                      </>
                    ) : (
                      <>
                        <h3>A new horizon.</h3>
                        <p>
                          Discover nearby airports and verify their standings.
                        </p>
                        <button onClick={() => switchMode("targets")}>
                          Find opportunities
                          <ChevronRight size={15} />
                        </button>
                      </>
                    )}
                  </section>
                </aside>
              </section>
            </>
          )}
          <footer>
            <span>★ Pilots Dispatch · {storage}</span>
            <button onClick={() => setSettings(true)}>
              Scores, refresh & backups <ArrowUpRight size={12} />
            </button>
          </footer>
        </div>
      </main>
      {(settings || adding) && (
        <Dialog
          title={adding ? "Airport watchlist" : "Dispatch settings"}
          onClose={() => {
            setSettings(false);
            setAdding(false);
          }}
        >
          {adding ? (
            <>
              <div className="eyebrow">LOCAL WATCHLIST</div>
              <h2>Your airport watchlist</h2>
              <p>
                Saved for {company.name} in this browser. Refresh data to update
                watched standings.
              </p>
              {watch.length ? (
                <>
                  <h3>
                    Watching {watch.length}{" "}
                    {watch.length === 1 ? "airport" : "airports"}
                  </h3>
                  {watch.map((a) => (
                    <div className="watch-entry" key={a.code}>
                      <span>
                        {a.code} · {a.name}
                      </span>
                      <button
                        aria-label={`Remove ${a.code} from watchlist`}
                        onClick={() => void toggleWatch(a)}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </>
              ) : (
                <p>
                  No watched airports yet. Use “Watch airport” in an airport’s
                  details or add one below.
                </p>
              )}
              <h3>Add an airport</h3>
              <p>
                Search known airports and observed flight endpoints, or enter an
                airport’s public code and coordinates anywhere in the world.
                Nearby discovery uses exact game airport records. Save up to 24
                airports in this browser.
              </p>
              <LocationEntry onChoose={(a) => void toggleWatch(a)} />
              <input
                className="search-input"
                aria-label="Search airports to watch"
                placeholder="Airport code or name"
                value={airportSearch}
                onChange={(e) => setAirportSearch(e.target.value)}
              />
              <div className="search-results">
                {matches.map((a) => (
                  <button key={a.code} onClick={() => void toggleWatch(a)}>
                    <strong>{a.code}</strong>
                    <span>{a.name}</span>
                    {watch.some((w) => w.code === a.code) ? (
                      <Check size={16} />
                    ) : (
                      <Plus size={16} />
                    )}
                  </button>
                ))}
                {airportSearch.length >= 2 && !matches.length && (
                  <p>
                    No match. Try nearby discovery from one of your holdings.
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="eyebrow">DISPATCH PREFERENCES</div>
              <h2>Your desk. Your data.</h2>
              <label className="toggle-setting">
                <input
                  type="checkbox"
                  checked={auto}
                  onChange={(e) => {
                    setAuto(e.target.checked);
                    autoRef.current = e.target.checked;
                    nextFetch.current = Date.now() + 300000;
                    put(prefKey("auto"), e.target.checked);
                  }}
                />
                <span>
                  Automatically check every five minutes while this page is open
                </span>
              </label>
              <p>
                Off by default. Refresh data requests fresh operational data;
                optional automatic checks reuse shared caches. Rate limits still
                apply.
              </p>
              <label className="setting-label">
                Watch a lead below <strong>{threshold}%</strong>
                <input
                  type="range"
                  min="5"
                  max="50"
                  step="5"
                  value={threshold}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    setThreshold(n);
                    thresholdRef.current = n;
                    put(prefKey("threshold"), n);
                  }}
                />
              </label>
              <p>
                Urgent: a lead at or below 5% of company’s score or 2,000
                points, whichever is larger. No scoring rival means uncontested.
                Ownership losses are tracked separately from standings failures.
              </p>
              <button
                className="button"
                onClick={() => void enableNotifications()}
              >
                <Bell size={15} />
                {notifications
                  ? "Notifications enabled"
                  : "Enable desktop notifications"}
              </button>
              <p className="fine-print">
                Notifications describe meaningful changes seen during a refresh.
                This page must remain open; closed-page monitoring is not
                enabled.
              </p>
              <hr />
              <h3>Local database & backups</h3>
              <p>
                Snapshots, watchlist, history, fleet, events, rankings, radar,
                and weather checks stay in IndexedDB in this browser profile.
                They do not sync across devices. Clearing site data removes
                them. Keep a backup.
              </p>
              <div className="backup-actions">
                <button className="button" onClick={() => void exportBackup()}>
                  <Download size={15} />
                  Export JSON backup
                </button>
                <button
                  className="button"
                  disabled={busy || searchBusy}
                  onClick={() => importInput.current?.click()}
                >
                  <Upload size={15} />
                  Import backup
                </button>
              </div>
              <input
                ref={importInput}
                hidden
                type="file"
                accept="application/json,.json"
                onChange={(e) => void chooseBackup(e.target.files?.[0])}
              />
              <p className="fine-print">
                History retains up to 1,000 checks within 90 days. The first
                check establishes a baseline. Event times describe the interval
                between observations.
              </p>
              <hr />
              <h3>Reading the board</h3>
              <p>
                Expansion estimates aim for one point above the leader and at
                least 2,000 total points. Base ownership and other game rules
                can affect actual control. The game does not provide a verified
                full company rank beyond the returned leaders.
              </p>
              <p className="fine-print">
                Independent companion for Pocket Pilots. No game account
                credentials or game-changing actions are used.
              </p>
            </>
          )}
        </Dialog>
      )}
      {restore && (
        <Dialog
          title="Restore local backup"
          onClose={() => {
            restoreRef.current = false;
            setRestore(null);
          }}
        >
          <div className="eyebrow">RESTORE LOCAL DATA</div>
          <h2>Replace this browser’s records?</h2>
          <p>
            This backup contains {restore.runs.length} checks and{" "}
            {restore.watch.length} watched airports, exported{" "}
            {stamp(restore.exportedAt)}. Restoring replaces the current local
            history and watchlist.
          </p>
          <div className="backup-actions">
            <button
              className="button"
              onClick={() => {
                restoreRef.current = false;
                setRestore(null);
              }}
            >
              Cancel
            </button>
            <button
              className="button refresh"
              onClick={() => void restoreBackup()}
            >
              Restore backup
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
function RadioMark() {
  return (
    <div className="first-icon">
      <Plane size={26} />
    </div>
  );
}
