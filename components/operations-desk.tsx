"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Flag,
  Plane,
  RefreshCw,
  Search,
  Trophy,
} from "lucide-react";
import { type Snapshot, type Flight } from "@/lib/dispatch";
import {
  arrivalTime,
  durationLabel,
  flightKey,
  rememberPilots,
  unwrapRoute,
  type Operations,
  type Fleet,
  type EventBriefing,
  type PilotRankings,
  type Track,
  type KnownPilot,
} from "@/lib/operations";
import { useCompany } from "@/components/company-provider";
import OperationsMap from "./operations-map";
export type OperationsView = "fleet" | "events" | "rankings";
const fmt = (n: number) => n.toLocaleString("en-US");
const stamp = (n: number) =>
  new Date(n).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const aircraftName = (s?: string) =>
  s
    ? s.replace(
        /(^|-)([a-z])/g,
        (_, sep, c) => `${sep ? " " : ""}${c.toUpperCase()}`,
      )
    : "Aircraft not listed";
const empty: Operations = { pilots: [] };
async function read<T>(path: string): Promise<T> {
  const r = await fetch(path, {
    signal: AbortSignal.timeout(20000),
    cache: "no-store",
  });
  if (!r.headers.get("content-type")?.includes("application/json"))
    throw Error(
      "The server did not return JSON. Try again or check the server connection.",
    );
  const d = (await r.json()) as T & { error?: string };
  if (!r.ok)
    throw Error(d.error || "The game could not complete this request.");
  return d;
}
export default function OperationsDesk({
  view,
  snapshot,
  onFleetChange,
  onInspectAirport,
  onView,
}: {
  view: OperationsView;
  snapshot: Snapshot;
  onFleetChange: (fleet: Fleet) => void;
  onInspectAirport: (code: string) => void;
  onView: (view: OperationsView) => void;
}) {
  const {
    company,
    db: { loadLocal, patchOperations },
  } = useCompany();
  const COMPANY = company.id;
  const [saved, setSaved] = useState<Operations>(empty),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [tick, setTick] = useState(Date.now());
  const [flight, setFlight] = useState(""),
    [track, setTrack] = useState<Track | null>(null),
    [trackError, setTrackError] = useState("");
  const [type, setType] = useState("packhorse"),
    [pid, setPid] = useState(""),
    [callsign, setCallsign] = useState(""),
    [metric, setMetric] = useState<"hours" | "money">("hours");
  const mounted = useRef(true),
    work = useRef(false),
    generation = useRef(0),
    savedRef = useRef<Operations>(empty);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void loadLocal()
      .then((d) => {
        if (!active) return;
        const current = d.operations ?? empty;
        savedRef.current = current;
        setSaved(current);
        if (current.rankings) {
          setPid(current.rankings.pid);
          setType(current.rankings.type);
        } else if (current.pilots[0]) {
          setPid(current.pilots[0].pid);
          setType(current.pilots[0].type ?? "packhorse");
        }
      })
      .catch(() => {
        if (active)
          setNote(
            "Local storage is unavailable. New results will remain visible until you leave this view.",
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    const timer = setInterval(() => setTick(Date.now()), 30000);
    return () => {
      active = false;
      mounted.current = false;
      generation.current++;
      clearInterval(timer);
    };
  }, []);
  const persist = useCallback(async (patch: Partial<Operations>) => {
    const value = { ...savedRef.current, ...patch };
    savedRef.current = value;
    if (patch.fleet) onFleetChange(patch.fleet);
    if (mounted.current) setSaved(value);
    try {
      const stored = await patchOperations(patch);
      if (mounted.current) {
        savedRef.current = stored;
        setSaved(stored);
      }
    } catch {
      if (mounted.current)
        setNote("Results loaded, but could not be saved in this browser.");
    }
  }, []);
  useEffect(() => {
    if (!loaded || !snapshot.airFetchedAt) return;
    const pilots = rememberPilots(
      savedRef.current.pilots,
      snapshot.air.flights,
      snapshot.airFetchedAt,
    );
    if (JSON.stringify(pilots) !== JSON.stringify(savedRef.current.pilots))
      void persist({ pilots });
  }, [loaded, snapshot.airFetchedAt, persist]);
  const fallback: Fleet = {
    now: snapshot.air.now,
    fetchedAt: snapshot.airFetchedAt,
    flights: snapshot.air.flights,
  };
  const fleet =
    saved.fleet && saved.fleet.fetchedAt >= fallback.fetchedAt
      ? saved.fleet
      : fallback;
  const selected =
    fleet.flights.find((f) => flightKey(f) === flight) ?? fleet.flights[0];
  const selectedKey = selected ? flightKey(selected) : "";
  useEffect(() => {
    generation.current++;
    setTrack(null);
    setTrackError("");
  }, [selectedKey, selected?.tr]);
  useEffect(() => {
    setError("");
  }, [view]);
  async function refreshFleet() {
    if (work.current) return;
    work.current = true;
    setBusy("fleet");
    setError("");
    try {
      const f = await read<Fleet>(`/api/fleet?fresh=1&companyId=${COMPANY}`);
      await persist({
        fleet: f,
        pilots: rememberPilots(savedRef.current.pilots, f.flights, f.fetchedAt),
      });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      work.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function refreshEvents() {
    if (work.current) return;
    work.current = true;
    setBusy("events");
    setError("");
    try {
      await persist({
        events: await read<EventBriefing>("/api/events?fresh=1"),
      });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      work.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function loadTrack() {
    if (work.current || !selected?.pid || !selected.t0) return;
    work.current = true;
    setBusy("track");
    setTrackError("");
    const requestGeneration = generation.current;
    try {
      const t = await read<Track>(
        `/api/flight-track?pid=${encodeURIComponent(selected.pid)}&t0=${selected.t0}&revision=${selected.tr ?? 0}`,
      );
      if (mounted.current && generation.current === requestGeneration)
        setTrack(t);
    } catch (e) {
      if (mounted.current && generation.current === requestGeneration)
        setTrackError((e as Error).message);
    } finally {
      work.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function lookupPilot() {
    if (work.current) return;
    work.current = true;
    setBusy("search");
    setError("");
    try {
      const r = await read<{ pilots: KnownPilot[] }>(
        `/api/pilot-search?companyId=${COMPANY}&query=${encodeURIComponent(callsign.trim())}`,
      );
      if (!r.pilots.length) {
        setNote(
          "No matching active or recently landed company pilot was returned. Try again while the pilot is flying, or enter their public pilot ID.",
        );
        return;
      }
      await persist({
        pilots: [...savedRef.current.pilots, ...r.pilots]
          .filter((p, i, a) => a.findLastIndex((x) => x.pid === p.pid) === i)
          .slice(-100),
      });
      setPid(r.pilots[0].pid);
      setType(r.pilots[0].type ?? type);
      setNote(
        `Found ${r.pilots.map((p) => p.cs).join(", ")} in public your company flight data.`,
      );
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      work.current = false;
      if (mounted.current) setBusy("");
    }
  }
  async function loadRankings() {
    if (work.current) return;
    work.current = true;
    setBusy("rankings");
    setError("");
    try {
      const result = await read<PilotRankings>(
        `/api/rankings?type=${encodeURIComponent(type.trim().toLowerCase())}&pid=${encodeURIComponent(pid.trim())}&fresh=1`,
      );
      await persist({ rankings: result });
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      work.current = false;
      if (mounted.current) setBusy("");
    }
  }
  const path =
    track && selected && track.t0 === selected.t0
      ? track.points
      : selected?.route?.length
        ? selected.route
        : selected?.to
          ? ([
              [selected.from.lat, selected.from.lon],
              [selected.to.lat, selected.to.lon],
            ] as [number, number][])
          : [];
  const pathLabel = track
    ? "Game flight path"
    : selected?.route?.length
      ? "Filed route overview"
      : "Direct airport-to-airport overview";
  const current = saved.events?.event,
    next = saved.events?.next;
  const regions = [
    ...(current?.boxes ?? (current?.box ? [current.box] : [])).map((box) => ({
      box,
      name: current!.name,
    })),
    ...(next?.boxes ?? (next?.box ? [next.box] : [])).map((box) => ({
      box,
      name: next!.name,
      next: true,
    })),
  ];
  const ranking = saved.rankings,
    matching =
      ranking &&
      ranking.type === type.trim().toLowerCase() &&
      ranking.pid === pid.trim();
  const pilotName = saved.pilots.find((p) => p.pid === ranking?.pid)?.cs;
  const knownTypes = [
    ...new Set([
      "packhorse",
      "skylark",
      "puffin",
      "hummingbird",
      "kingfisher",
      "petrel",
      "stork",
      "huey",
      ...saved.pilots.flatMap((p) => (p.type ? [p.type] : [])),
    ]),
  ];
  return (
    <section
      className="operations-desk"
      aria-label={
        view === "fleet"
          ? "Fleet board"
          : view === "events"
            ? "Event briefing"
            : "Pilot rankings"
      }
    >
      {error && (
        <div className="notice" role="alert">
          {error} Previously checked results keep their original timestamp.
        </div>
      )}
      {note && (
        <div className="notice" role="status">
          {note}
          <button
            onClick={() => setNote("")}
            aria-label="Dismiss operations notice"
          >
            ×
          </button>
        </div>
      )}
      {view === "fleet" && (
        <>
          <div className="ops-heading">
            <div>
              <div className="eyebrow">{company.tag} IN THE AIR</div>
              <h2>Every flight, one dispatch desk.</h2>
              <p>
                Active flights returned by the game, not a complete company
                roster.
              </p>
            </div>
            <button
              className="button refresh"
              disabled={!!busy || !loaded}
              onClick={() => void refreshFleet()}
            >
              <RefreshCw size={15} className={busy === "fleet" ? "spin" : ""} />
              {busy === "fleet" ? "Checking flights…" : "Refresh flights"}
            </button>
          </div>
          <div className="ops-summary">
            <span>
              <strong>{fleet.fetchedAt ? fleet.flights.length : "—"}</strong>{" "}
              flights in last response
            </span>
            <span>
              Checked {fleet.fetchedAt ? stamp(fleet.fetchedAt) : "not yet"}
            </span>
            <span>
              Arrival estimates change with time; flight status updates on
              refresh.
            </span>
          </div>
          {!fleet.flights.length ? (
            <div className="ops-empty">
              <Plane size={32} />
              <h3>
                {fleet.fetchedAt
                  ? "No active your company flights returned."
                  : "Ready to check the fleet."}
              </h3>
              <p>
                {fleet.fetchedAt
                  ? "Check again after a company pilot departs. Previously observed pilots remain available in rankings."
                  : "Refresh flights to load current departures, destinations, and scheduled arrivals."}
              </p>
            </div>
          ) : (
            <div className="fleet-layout">
              <div className="flight-list">
                {fleet.flights.map((f, i) => {
                  const arrival = arrivalTime(f);
                  return (
                    <button
                      key={`${flightKey(f)}-${i}`}
                      className={`flight-card ${flightKey(f) === selectedKey ? "selected" : ""}`}
                      onClick={() => setFlight(flightKey(f))}
                    >
                      <div>
                        <strong>{f.cs}</strong>
                        <span>{aircraftName(f.type)}</span>
                      </div>
                      <p>
                        {f.from.code}
                        <ArrowRight size={14} />
                        {f.to?.code ?? "Destination unlisted"}
                      </p>
                      <small>
                        {arrival
                          ? arrival > tick
                            ? `ETA ${stamp(arrival)} · ${durationLabel(arrival - tick)} remaining`
                            : "ETA passed · refresh status"
                          : "Arrival estimate unavailable"}
                      </small>
                    </button>
                  );
                })}
              </div>
              {selected && (
                <div className="flight-panel">
                  <div className="card-heading">
                    <div>
                      <h2>
                        {selected.cs} · {aircraftName(selected.type)}
                      </h2>
                      <p>{selected.reg ?? "Registration not listed"}</p>
                    </div>
                    <span className="badge target">Observed flight</span>
                  </div>
                  <OperationsMap
                    points={unwrapRoute(path)}
                    from={selected.from}
                    to={selected.to}
                    fitKey={`${selectedKey}:${selected?.tr ?? 0}:${track?.revision ?? "route"}`}
                    pathLabel={pathLabel}
                  />
                  <div className="flight-facts">
                    <div>
                      <span>DEPARTURE</span>
                      <strong>{selected.from.code}</strong>
                      <p>{selected.from.name}</p>
                      {selected.t0 && <small>{stamp(selected.t0)}</small>}
                    </div>
                    <div>
                      <span>DESTINATION</span>
                      <strong>{selected.to?.code ?? "—"}</strong>
                      <p>{selected.to?.name ?? "Not listed"}</p>
                      {arrivalTime(selected) && (
                        <small>Estimated {stamp(arrivalTime(selected)!)}</small>
                      )}
                    </div>
                  </div>
                  <div className="flight-actions">
                    <button
                      className="button"
                      disabled={!!busy || !selected.pid || !selected.t0}
                      onClick={() => void loadTrack()}
                    >
                      <MapMark />
                      {busy === "track"
                        ? "Loading path…"
                        : track
                          ? "Reload game flight path"
                          : "Load game flight path"}
                    </button>
                    {selected.type && selected.pid && (
                      <button
                        className="button"
                        onClick={() => {
                          setPid(selected.pid!);
                          setType(selected.type!);
                          onView("rankings");
                        }}
                      >
                        <Trophy size={14} />
                        View pilot rankings
                      </button>
                    )}
                  </div>
                  {trackError && (
                    <p className="ops-warning" role="status">
                      {trackError}
                    </p>
                  )}
                  <p className="ops-footnote">
                    {pathLabel}
                    {track ? ` · checked ${stamp(track.fetchedAt)}` : ""}. The
                    game path may include the planned remainder; it is not live
                    GPS telemetry.
                  </p>
                  <div className="flight-actions">
                    {[selected.from, selected.to]
                      .filter((a): a is NonNullable<typeof a> => !!a)
                      .filter((a) =>
                        snapshot.airports.some((x) => x.code === a.code),
                      )
                      .map((a) => (
                        <button
                          className="text-link"
                          key={a.code}
                          onClick={() => onInspectAirport(a.code)}
                        >
                          Inspect {a.code}
                          <ArrowRight size={12} />
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {view === "events" && (
        <>
          <div className="ops-heading">
            <div>
              <div className="eyebrow">WORLD OPERATIONS</div>
              <h2>Know the mission before you fly.</h2>
              <p>Current and upcoming game events, refreshed when you ask.</p>
            </div>
            <button
              className="button refresh"
              disabled={!!busy || !loaded}
              onClick={() => void refreshEvents()}
            >
              <RefreshCw
                size={15}
                className={busy === "events" ? "spin" : ""}
              />
              {busy === "events" ? "Checking events…" : "Refresh briefing"}
            </button>
          </div>
          {!saved.events ? (
            <div className="ops-empty">
              <Flag size={32} />
              <h3>Your next mission starts here.</h3>
              <p>
                Refresh the briefing for event goals, operating regions, and
                deadlines.
              </p>
            </div>
          ) : (
            <>
              <p className="ops-footnote">
                Checked {stamp(saved.events.fetchedAt)} · countdowns use the
                published schedule, not a fresh API check.
              </p>
              <div className="event-grid">
                <article className="event-card current">
                  <span className="eyebrow">CURRENT EVENT</span>
                  <h3>{current?.name ?? "No current event published"}</h3>
                  <p>
                    {current?.blurb ??
                      "Check again later for the next operation."}
                  </p>
                  {current && (
                    <>
                      <div className="event-clock">
                        {current.ends
                          ? current.ends > tick
                            ? `${durationLabel(current.ends - tick)} remaining`
                            : "Scheduled end passed · refresh briefing"
                          : "No deadline published"}
                      </div>
                      {current.ends && (
                        <small>Ends {stamp(current.ends)}</small>
                      )}
                      <div className="event-numbers">
                        <div>
                          <strong>
                            {current.units !== undefined
                              ? fmt(current.units)
                              : "—"}
                          </strong>
                          <span>
                            {current.unit ?? "units"} delivered worldwide
                          </span>
                        </div>
                        <div>
                          <strong>
                            {current.pilots !== undefined
                              ? fmt(current.pilots)
                              : "—"}
                          </strong>
                          <span>participating pilots</span>
                        </div>
                      </div>
                      {current.goal && current.goal > 0 ? (
                        <>
                          <progress
                            aria-label="Global event goal progress"
                            max={current.goal}
                            value={Math.min(current.units ?? 0, current.goal)}
                          />
                          <p>
                            {fmt(current.units ?? 0)} / {fmt(current.goal)}{" "}
                            {current.unit ?? "units"} ·{" "}
                            {Math.round(
                              ((current.units ?? 0) / current.goal) * 100,
                            )}
                            % of published goal
                          </p>
                        </>
                      ) : (
                        <p className="goal-note">
                          No numeric target published in this response.
                        </p>
                      )}
                    </>
                  )}
                </article>
                <article className="event-card next">
                  <span className="eyebrow">NEXT ON THE HORIZON</span>
                  <h3>{next?.name ?? "Awaiting the next briefing."}</h3>
                  <p>
                    {next?.blurb ??
                      "The game has not supplied an upcoming event. Refresh later to check."}
                  </p>
                  {next?.starts && (
                    <>
                      <div className="event-clock">
                        {next.starts > tick
                          ? `Starts in ${durationLabel(next.starts - tick)}`
                          : "Scheduled start passed · refresh briefing"}
                      </div>
                      <small>{stamp(next.starts)}</small>
                    </>
                  )}
                </article>
              </div>
              {regions.length > 0 && (
                <section className="event-map-card">
                  <div className="card-heading">
                    <div>
                      <h2>Operating regions</h2>
                      <p>Red: current event · gold: upcoming event</p>
                    </div>
                  </div>
                  <OperationsMap
                    regions={regions}
                    fitKey={`${saved.events.fetchedAt}`}
                  />
                </section>
              )}
              {current && (
                <section className="ranking-table">
                  <div className="card-heading">
                    <div>
                      <h2>Event company leaders</h2>
                      <p>
                        Only the entries returned by the game. This is not the
                        global company ranking.
                      </p>
                    </div>
                  </div>
                  {current.top.length ? (
                    <div className="ops-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>PLACE</th>
                            <th>COMPANY</th>
                            <th>{current.unit ?? "UNITS"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {current.top.map((row, i) => (
                            <tr
                              key={row.id}
                              className={row.id === COMPANY ? "chosen" : ""}
                            >
                              <td>{i + 1}</td>
                              <td>
                                {saved.events?.cos[row.id]?.tag ?? row.id}
                                <small>{saved.events?.cos[row.id]?.name}</small>
                              </td>
                              <td>{fmt(row.units)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="empty">
                      No event company standings returned yet.
                    </div>
                  )}
                  <p className="ops-footnote">
                    {current.top.some((r) => r.id === COMPANY)
                      ? "your company appears in the returned event leaders."
                      : "your company has no entry in the returned event leaders; that does not establish its full event rank or total contribution."}
                  </p>
                </section>
              )}
            </>
          )}
        </>
      )}
      {view === "rankings" && (
        <>
          <div className="ops-heading">
            <div>
              <div className="eyebrow">PILOT RECORDS</div>
              <h2>A place on the board.</h2>
              <p>
                Aircraft-specific hours and revenue rankings—including a pilot’s
                rank beyond the displayed leaders.
              </p>
            </div>
            <Trophy size={28} />
          </div>
          <section className="ranking-controls">
            <div className="pilot-finder">
              <label>
                Find a company pilot by callsign
                <input
                  aria-label="Pilot callsign"
                  value={callsign}
                  maxLength={12}
                  placeholder="e.g. HOWDY"
                  onChange={(e) => setCallsign(e.target.value.toUpperCase())}
                />
              </label>
              <button
                className="button"
                disabled={!!busy || !loaded || !callsign.trim()}
                onClick={() => void lookupPilot()}
              >
                <Search size={14} />
                {busy === "search" ? "Searching…" : "Find pilot"}
              </button>
            </div>
            <p className="ops-footnote">
              Search covers active or recently landed your company pilots. This
              browser remembers pilots it observes; it does not have a complete
              roster.
            </p>
            <div className="rank-inputs">
              <label>
                Observed your company pilots
                <select
                  aria-label="Observed your company pilots"
                  value={saved.pilots.some((p) => p.pid === pid) ? pid : ""}
                  onChange={(e) => {
                    const p = saved.pilots.find(
                      (p) => p.pid === e.target.value,
                    );
                    if (p) {
                      setPid(p.pid);
                      setType(p.type ?? type);
                    } else setPid("");
                  }}
                >
                  <option value="">
                    Choose a pilot or show global leaders
                  </option>
                  {saved.pilots.map((p) => (
                    <option key={p.pid} value={p.pid}>
                      {p.cs}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Aircraft type
                <input
                  aria-label="Aircraft type"
                  list="aircraft-types"
                  value={type}
                  onChange={(e) => setType(e.target.value.toLowerCase())}
                />
                <datalist id="aircraft-types">
                  {knownTypes.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </label>
              <label>
                Public pilot ID (optional)
                <input
                  aria-label="Public pilot ID"
                  value={pid}
                  maxLength={40}
                  onChange={(e) => setPid(e.target.value.trim())}
                  placeholder="Leave empty for leaders only"
                />
              </label>
              <button
                className="button refresh"
                disabled={!!busy || !loaded || !type.trim()}
                onClick={() => void loadRankings()}
              >
                <RefreshCw
                  size={14}
                  className={busy === "rankings" ? "spin" : ""}
                />
                {busy === "rankings" ? "Loading rankings…" : "Load rankings"}
              </button>
            </div>
          </section>
          {!ranking ? (
            <div className="ops-empty">
              <Trophy size={32} />
              <h3>Choose an aircraft to begin.</h3>
              <p>
                Add a pilot to retrieve their personal rank, or leave the pilot
                blank to see aircraft leaders.
              </p>
            </div>
          ) : (
            <>
              <div className="ranking-context">
                <h3>
                  {aircraftName(ranking.type)} · {fmt(ranking.n)} pilots
                </h3>
                <p>
                  Checked {stamp(ranking.fetchedAt)}
                  {!matching
                    ? " · Selection changed. Load rankings to update these results."
                    : ""}
                </p>
              </div>
              {ranking.pid && (
                <div className="personal-ranks">
                  <div className="pilot-identity">
                    <Trophy size={24} />
                    <span>
                      {pilotName ?? "Selected pilot"}
                      <small>{ranking.pid}</small>
                    </span>
                  </div>
                  <div>
                    <span>FLIGHT HOURS RANK</span>
                    <strong>
                      {ranking.me.hours
                        ? `#${fmt(ranking.me.hours)}`
                        : "Not ranked"}
                    </strong>
                  </div>
                  <div>
                    <span>REVENUE RANK</span>
                    <strong>
                      {ranking.me.money
                        ? `#${fmt(ranking.me.money)}`
                        : "Not ranked"}
                    </strong>
                  </div>
                </div>
              )}
              <section className="ranking-table">
                <div className="card-heading">
                  <div>
                    <h2>Aircraft leaders</h2>
                    <p>
                      {ranking[metric].length} returned entries · pilot
                      rankings, not company rankings
                    </p>
                  </div>
                  <div className="map-tabs">
                    <button
                      className={metric === "hours" ? "selected" : ""}
                      onClick={() => setMetric("hours")}
                    >
                      Hours
                    </button>
                    <button
                      className={metric === "money" ? "selected" : ""}
                      onClick={() => setMetric("money")}
                    >
                      Revenue
                    </button>
                  </div>
                </div>
                <div className="ops-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>PLACE</th>
                        <th>PILOT</th>
                        <th>COMPANY</th>
                        <th>{metric === "hours" ? "HOURS" : "REVENUE"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ranking[metric].map((row, i) => (
                        <tr
                          key={row.pid}
                          className={row.pid === ranking.pid ? "chosen" : ""}
                        >
                          <td>{i + 1}</td>
                          <td>{row.cs}</td>
                          <td>
                            {row.co
                              ? (ranking.cos[row.co]?.tag ?? row.co)
                              : "—"}
                          </td>
                          <td>
                            {metric === "hours"
                              ? row.v.toLocaleString("en-US", {
                                  maximumFractionDigits: 1,
                                })
                              : fmt(row.v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!ranking[metric].length && (
                    <div className="empty">
                      No pilots returned for this metric.
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </section>
  );
}
function MapMark() {
  return <Plane size={14} />;
}
