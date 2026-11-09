"use client";
import { useEffect, useRef, useState } from "react";
import { Building2, RefreshCw } from "lucide-react";
import { useCompany } from "./company-provider";
import OperationsMap from "./operations-map";
import {
  baseBriefingSchema,
  projectProgress,
  nearestHolding,
  type BaseBriefing,
} from "@/lib/bases";
import type { Snapshot, Airport } from "@/lib/dispatch";
const stamp = (n: number) =>
  new Date(n).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const fmt = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });
type AirportBrief = {
  holder?: string | null;
  bases?: string[];
  built?: Record<string, unknown>;
  cos: Record<string, { tag: string; name: string }>;
  fetchedAt: number;
};
export default function BasesDesk({
  snapshot,
  watch,
  onWatch,
}: {
  snapshot: Snapshot;
  watch: Airport[];
  onWatch: (airport: Airport) => void;
}) {
  const { company, db } = useCompany();
  const [data, setData] = useState<BaseBriefing | null>(null),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [scope, setScope] = useState("mine"),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState<AirportBrief | null>(null),
    [detailError, setDetailError] = useState(""),
    [detailBusy, setDetailBusy] = useState(false);
  const active = useRef(true),
    working = useRef(false);
  useEffect(() => {
    active.current = true;
    void db
      .loadLocal()
      .then((b) => {
        if (active.current) setData(b.operations?.bases ?? null);
      })
      .catch(() => {
        if (active.current)
          setNote(
            "Local storage is unavailable. Results will remain visible until you leave this view.",
          );
      })
      .finally(() => {
        if (active.current) setLoaded(true);
      });
    return () => {
      active.current = false;
    };
  }, [db]);
  async function refresh() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/bases?fresh=1", {
          signal: AbortSignal.timeout(20000),
        }),
        raw = await r.json();
      if (!r.ok) throw Error(raw.error || "Could not load bases");
      const next = baseBriefingSchema.parse(raw);
      if (!active.current) return;
      setData(next);
      try {
        await db.patchOperations({ bases: next });
      } catch {
        if (active.current)
          setNote(
            "The briefing loaded but could not be saved in this browser.",
          );
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "Could not load bases");
    } finally {
      working.current = false;
      if (active.current) setBusy(false);
    }
  }
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    if (!selected) return;
    const controller = new AbortController();
    setDetailBusy(true);
    void fetch(`/api/airport?code=${encodeURIComponent(selected)}`, {
      signal: controller.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Airport check failed");
        if (!controller.signal.aborted) setDetail(d);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setDetailError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailBusy(false);
      });
    return () => controller.abort();
  }, [selected, data?.fetchedAt]);
  const name = (id: string) => data?.cos[id]?.name ?? id,
    tag = (id: string) =>
      id === company.id ? company.tag : (data?.cos[id]?.tag ?? id);
  const matches = (b: { code: string; co: string; name?: string }) =>
    (scope === "all" || b.co === company.id) &&
    `${b.code} ${b.name ?? ""} ${name(b.co)} ${tag(b.co)}`
      .toLowerCase()
      .includes(query.toLowerCase());
  const bases = data?.bases.filter(matches) ?? [],
    projects = data?.projects.filter(matches) ?? [],
    mine = data?.bases.filter((b) => b.co === company.id) ?? [];
  const holdings = Object.entries(snapshot.air.held).map(([code, a]) => ({
    code,
    lat: a.lat,
    lon: a.lon,
  }));
  const pins = [
    ...bases.map((b) => ({
      ...b,
      label: `${b.code} · ${tag(b.co)} base`,
      color: b.co === company.id ? "#173d59" : "#ad3b28",
    })),
    ...projects.map((p) => ({
      ...p,
      label: `${p.code} · ${p.kind} project · ${Math.round(projectProgress(p).percent)}%`,
      color: "#b48c4e",
    })),
  ];
  function watchButton(b: Airport) {
    const watching = watch.some((a) => a.code === b.code);
    return (
      <button className="button compact" onClick={() => onWatch(b)}>
        {watching ? "Remove watch" : "Watch airport"}
      </button>
    );
  }
  return (
    <section className="bases-desk" aria-label="Bases and projects">
      <div className="ops-heading">
        <div>
          <div className="eyebrow">COMPANY INFRASTRUCTURE</div>
          <h2>A foothold beyond the leaderboard.</h2>
          <p>
            Publicly listed bases and airport construction. A base and this
            week’s airport holder can belong to different companies.
          </p>
        </div>
        <button
          className="button refresh"
          disabled={busy || !loaded}
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          {busy ? "Checking bases…" : "Refresh bases"}
        </button>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error} Saved results keep their original timestamp.
        </div>
      )}
      {note && (
        <div className="notice" role="status">
          {note}
        </div>
      )}
      <p className="ops-footnote">
        On demand only ·{" "}
        {data
          ? `Checked ${stamp(data.fetchedAt)}. ${data.bases.length} base listings returned across ${new Set(data.bases.map((b) => b.code)).size} airports.`
          : "No base check saved yet."}{" "}
        Gates, supplies, operating status and Base Jump balances are not
        available in this public response.
      </p>
      {!data ? (
        <div className="ops-empty">
          <Building2 size={32} />
          <h3>Bring the base network into view.</h3>
          <p>
            Refresh to check listed bases and construction projects. This
            briefing is included in your company’s local backup.
          </p>
        </div>
      ) : (
        <>
          <div className="ops-summary">
            <span>
              <strong>{mine.length}</strong> {company.tag} base listings
            </span>
            <span>
              <strong>
                {data.projects.filter((p) => p.co === company.id).length}
              </strong>{" "}
              company projects
            </span>
            <span>
              <strong>{data.bases.length}</strong> base listings returned
            </span>
          </div>
          <div className="intel-controls">
            <label>
              Show
              <select
                aria-label="Base company scope"
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="mine">{company.tag} only</option>
                <option value="all">All listed companies</option>
              </select>
            </label>
            <label>
              Find a base
              <input
                aria-label="Search bases and projects"
                placeholder="Airport, company name or tag"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {!mine.length && scope === "mine" && (
            <div className="notice">
              No bases for {company.tag} appeared in this response. This does
              not describe its airport holdings.
              <button className="button" onClick={() => setScope("all")}>
                Show all companies
              </button>
            </div>
          )}
          {!!pins.length && (
            <OperationsMap
              pins={pins}
              fitKey={`${data.fetchedAt}:${scope}:${query}`}
              pathLabel="Navy: your bases · red: other companies · gold: construction"
            />
          )}
          <section className="ranking-table">
            <div className="card-heading">
              <div>
                <h2>Base network</h2>
                <p>
                  {bases.length} matching listings · an airport may have
                  multiple companies’ bases
                </p>
              </div>
            </div>
            <div className="ops-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>AIRPORT</th>
                    <th>BASE COMPANY</th>
                    <th>NEAREST HOLDING</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {bases.map((b) => {
                    const nearest = nearestHolding(b, holdings);
                    return (
                      <tr
                        key={`${b.code}:${b.co}`}
                        className={b.co === company.id ? "chosen" : ""}
                      >
                        <td>
                          <strong>{b.code}</strong>
                          <small>
                            {b.lat.toFixed(3)}, {b.lon.toFixed(3)}
                          </small>
                        </td>
                        <td>
                          {tag(b.co)}
                          <small>{name(b.co)}</small>
                        </td>
                        <td>
                          {nearest ? (
                            <>
                              {fmt(nearest.distance)} nm
                              <small>
                                {nearest.code} · checked{" "}
                                {stamp(snapshot.airFetchedAt)}
                              </small>
                            </>
                          ) : snapshot.airFetchedAt ? (
                            "No observed holdings"
                          ) : (
                            "Check territory first"
                          )}
                        </td>
                        <td>
                          <div className="base-actions">
                            <button
                              className="button compact"
                              onClick={() => setSelected(b.code)}
                            >
                              Inspect {b.code}
                            </button>
                            {watchButton({ ...b, name: b.code })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!bases.length && (
                <div className="empty">No matching base listings.</div>
              )}
            </div>
          </section>
          {selected && (
            <section
              className="base-airport-brief"
              aria-label={`Base airport ${selected}`}
            >
              <div className="card-heading">
                <div>
                  <h2>{selected} · airport brief</h2>
                  <p>
                    {detail
                      ? `Airport checked ${stamp(detail.fetchedAt)}; this may differ from the base map’s check time.`
                      : detailBusy
                        ? "Checking airport…"
                        : "Airport details"}
                  </p>
                </div>
                <button
                  className="button compact"
                  onClick={() => setSelected("")}
                >
                  Close brief
                </button>
              </div>
              {detailError && (
                <div className="notice" role="alert">
                  {detailError}
                </div>
              )}
              {detail && (
                <dl>
                  <div>
                    <dt>Returned airport holder</dt>
                    <dd>
                      {detail.holder
                        ? (detail.cos[detail.holder]?.tag ?? tag(detail.holder))
                        : "None returned"}
                    </dd>
                  </div>
                  <div>
                    <dt>Base companies at this airport</dt>
                    <dd>
                      {detail.bases
                        ?.map((co) => detail.cos[co]?.tag ?? tag(co))
                        .join(", ") || "None returned"}
                    </dd>
                  </div>
                  <div>
                    <dt>Listed airport facilities</dt>
                    <dd>
                      {Object.keys(detail.built ?? {}).join(", ") ||
                        "None returned"}
                    </dd>
                  </div>
                </dl>
              )}
              <p className="ops-footnote">
                Airport facilities are separate from a company’s private gate
                and supply records.
              </p>
            </section>
          )}
          <div className="ops-heading base-project-heading">
            <div>
              <div className="eyebrow">WORK IN PROGRESS</div>
              <h2>Construction projects</h2>
              <p>
                Progress from the game’s returned material counts. No completion
                time is inferred.
              </p>
            </div>
          </div>
          <div className="base-projects">
            {projects.map((p) => {
              const progress = projectProgress(p);
              return (
                <article
                  className="base-project"
                  key={`${p.code}:${p.co}:${p.kind}`}
                >
                  <span className="eyebrow">
                    {tag(p.co)} · {p.kind}
                  </span>
                  <h3>{p.code}</h3>
                  <p>{p.name}</p>
                  <progress
                    aria-label={`${p.code} ${p.kind} progress`}
                    max={100}
                    value={progress.percent}
                  />
                  <strong>
                    {Math.round(progress.percent)}% of reported goal
                  </strong>
                  <p>
                    {fmt(p.have)} / {fmt(p.need)} material units ·{" "}
                    {fmt(progress.remaining)} remaining
                  </p>
                  {watchButton(p)}
                </article>
              );
            })}
          </div>
          {!projects.length && (
            <div className="empty">
              No matching construction projects returned.
            </div>
          )}
        </>
      )}
    </section>
  );
}
