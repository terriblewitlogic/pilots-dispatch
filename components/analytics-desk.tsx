"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, Download, TrendingUp } from "lucide-react";
import type { Snapshot } from "@/lib/dispatch";
import type { LocalRun } from "@/lib/local-db";
import { analyticsCsv, companyAnalytics } from "@/lib/analytics";

const number = (value: number | null | undefined) =>
  value == null
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: 0 });
const percent = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value)}%`;
const stamp = (time: number) =>
  new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
type Analytics = ReturnType<typeof companyAnalytics>;

export default function AnalyticsDesk({
  snapshot,
  runs,
  now,
  threshold,
  onInspectAirport,
  onDefense,
}: {
  snapshot: Snapshot;
  runs: LocalRun[];
  now: number;
  threshold: number;
  onInspectAirport: (code: string) => void;
  onDefense: () => void;
}) {
  const [days, setDays] = useState(7);
  const [metric, setMetric] = useState<"held" | "points">("held");
  const report = useMemo(
    () =>
      companyAnalytics(snapshot, runs, now - days * 86400000, now, threshold),
    [snapshot, runs, now, days, threshold],
  );
  const current = report.current;
  const statuses = [
    { label: "Secure", count: current?.secure ?? 0, className: "secure" },
    { label: "Watch closely", count: current?.watch ?? 0, className: "watch" },
    { label: "Urgent", count: current?.urgent ?? 0, className: "urgent" },
    { label: "Unverified", count: current?.unknown ?? 0, className: "unknown" },
  ];
  const priorities = (current?.holdings ?? [])
    .filter((a) => a.status !== "secure")
    .sort((a, b) => {
      const rank = {
        urgent: 0,
        watch: 1,
        unknown: 2,
        secure: 3,
        lost: 4,
        target: 5,
      };
      return rank[a.status] - rank[b.status] || a.gap - b.gap;
    })
    .slice(0, 8);
  function download() {
    const url = URL.createObjectURL(
      new Blob([analyticsCsv(report.trend)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `pilots-dispatch-${snapshot.companyId}-analytics-${days}d.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="analytics-desk" aria-label="Company analytics">
      <div className="analytics-toolbar">
        <div>
          <span className="eyebrow">COMPANY PERFORMANCE</span>
          <h2>Territory, measured over time.</h2>
          <p>
            {current
              ? `Latest territory check: ${stamp(current.at)}.`
              : "Refresh data to start tracking your company."}{" "}
            History stays in this browser.
          </p>
        </div>
        <div className="analytics-controls">
          <label>
            History period
            <select
              aria-label="Analytics history period"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              <option value={1}>Last 24 hours</option>
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <button
            className="button compact"
            disabled={!report.trend.length}
            onClick={download}
          >
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </div>

      <div className="analytics-kpis">
        <Kpi
          label="Airports held"
          value={number(current?.held)}
          detail="At the latest territory check"
        />
        <Kpi
          label="Net territory change"
          value={
            report.net == null
              ? "—"
              : `${report.net > 0 ? "+" : ""}${number(report.net)}`
          }
          detail={
            report.net == null
              ? "Needs two checks in this period"
              : `${number(report.gains)} ${report.gains === 1 ? "gain" : "gains"} · ${number(report.losses)} ${report.losses === 1 ? "loss" : "losses"} observed`
          }
          tone={report.net != null && report.net < 0 ? "warm" : ""}
        />
        <Kpi
          label="Territory retained"
          value={percent(report.retention)}
          detail={
            report.retention == null
              ? "Needs a baseline with holdings and a later check"
              : `${report.retained} of ${report.baselineHeld} baseline airports held at the end`
          }
        />
        <Kpi
          label="Vulnerable holdings"
          value={current ? number(current.urgent + current.watch) : "—"}
          detail={
            current
              ? `${current.urgent} urgent · ${current.watch} watch closely · ${current.unknown} unverified`
              : "Awaiting standings checks"
          }
          tone={current && current.urgent + current.watch > 0 ? "warm" : ""}
        />
        <Kpi
          label="Standings coverage"
          value={percent(current?.coverage)}
          detail={
            current
              ? `${current.verified} of ${current.held} holdings verified`
              : "Awaiting territory data"
          }
        />
        <Kpi
          label="Held-airport points"
          value={number(current?.points)}
          detail="Sum of points reported for current holdings"
        />
      </div>

      <p className="analytics-coverage" role="status">
        {report.baselineAt && report.endAt
          ? `${report.trend.length} observations in this period · comparisons cover ${stamp(report.baselineAt)} to ${stamp(report.endAt)}.`
          : "No observations in this period. Choose a longer period or refresh data."}{" "}
        Current KPIs use the latest check; period comparisons start at the first
        available check inside the selected window.
      </p>

      <div className="analytics-grid">
        <section
          className="activity-card analytics-trend"
          aria-labelledby="analytics-trend-title"
        >
          <div className="card-heading">
            <div>
              <h2 id="analytics-trend-title">Territory trend</h2>
              <p>Observed values at each check</p>
            </div>
            <label className="analytics-metric">
              Measure
              <select
                aria-label="Trend measure"
                value={metric}
                onChange={(e) => setMetric(e.target.value as "held" | "points")}
              >
                <option value="held">Airports held</option>
                <option value="points">Held-airport points</option>
              </select>
            </label>
          </div>
          {report.trend.length >= 2 ? (
            <TrendChart points={report.trend} metric={metric} />
          ) : (
            <div className="empty">
              <TrendingUp size={30} />
              <h3>
                {report.trend.length
                  ? "Your baseline is ready."
                  : "No history in this period."}
              </h3>
              <p>
                {report.trend.length
                  ? "Refresh again later to see how territory changes."
                  : "Refresh data or select a longer period to view observations."}
              </p>
            </div>
          )}
          <p className="ops-footnote">
            The line holds each observed value until the next check. Changes
            between checks may be missed.
          </p>
        </section>

        <section
          className="activity-card analytics-health"
          aria-labelledby="analytics-health-title"
        >
          <div className="card-heading">
            <div>
              <h2 id="analytics-health-title">Defense health</h2>
              <p>Current holdings · {threshold}% watch threshold</p>
            </div>
          </div>
          <div className="analytics-health-body">
            <strong>
              {current ? number(current.held) : "—"}
              <span> {current?.held === 1 ? "airport" : "airports"} held</span>
            </strong>
            <div className="analytics-health-bar" aria-hidden="true">
              {statuses.map(
                (status) =>
                  status.count > 0 && (
                    <span
                      key={status.label}
                      className={status.className}
                      style={{ flex: status.count }}
                    />
                  ),
              )}
            </div>
            <ul>
              {statuses.map((status) => (
                <li key={status.label}>
                  <span>
                    <i className={status.className} />
                    {status.label}
                  </span>
                  <strong>{current ? status.count : "—"}</strong>
                </li>
              ))}
            </ul>
            <button className="button compact" onClick={onDefense}>
              Open Airport defense <ArrowUpRight size={15} />
            </button>
          </div>
        </section>
      </div>

      <section className="activity-card analytics-priorities">
        <div className="card-heading">
          <div>
            <h2>Holdings needing attention</h2>
            <p>
              Urgent contests first, followed by watch alerts and verification
              gaps
            </p>
          </div>
        </div>
        {priorities.length ? (
          priorities.map((a) => (
            <button
              key={a.code}
              className="activity-row"
              onClick={() => onInspectAirport(a.code)}
            >
              <span className={`badge ${a.status}`}>
                {a.status === "urgent"
                  ? "Urgent"
                  : a.status === "watch"
                    ? "Watch closely"
                    : "Unverified"}
              </span>
              <div>
                <strong>
                  {a.code} · {a.name}
                </strong>
                <span>
                  {a.verified
                    ? `${number(a.gap)} point lead vs ${a.rivalTag}`
                    : "Refresh to verify airport standings"}
                </span>
              </div>
              <ArrowUpRight size={16} />
            </button>
          ))
        ) : (
          <div className="empty">
            {!current
              ? "Refresh data to identify defense priorities."
              : current.held
                ? "No vulnerable or unverified holdings at the latest check."
                : "No airports held at the latest check."}
          </div>
        )}
      </section>

      <details className="activity-card analytics-observations">
        <summary>Observation data · {report.trend.length} checks</summary>
        <div className="ops-table-scroll">
          <table>
            <thead>
              <tr>
                <th>OBSERVED</th>
                <th>HELD</th>
                <th>POINTS</th>
                <th>VERIFIED</th>
                <th>URGENT</th>
                <th>WATCH</th>
                <th>UNVERIFIED</th>
              </tr>
            </thead>
            <tbody>
              {report.trend.map((p) => (
                <tr key={p.at}>
                  <td>{stamp(p.at)}</td>
                  <td>{number(p.held)}</td>
                  <td>{number(p.points)}</td>
                  <td>{number(p.verified)}</td>
                  <td>{number(p.urgent)}</td>
                  <td>{number(p.watch)}</td>
                  <td>{number(p.unknown)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="ops-footnote">
        Gains and losses count observed control changes; taking an airport back
        counts as a gain. Retention measures baseline airports held at the end,
        including regained airports. Unverified holdings are excluded from
        vulnerable counts. History is retained for up to 90 days or 1,000
        checks; defense classifications apply your current threshold throughout.
      </p>
    </section>
  );
}

function Kpi({
  label,
  value,
  detail,
  tone = "",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: string;
}) {
  return (
    <article className="analytics-kpi" aria-label={label}>
      <span className="stat-label">{label}</span>
      <strong className={tone}>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function TrendChart({
  points,
  metric,
}: {
  points: Analytics["trend"];
  metric: "held" | "points";
}) {
  const [active, setActive] = useState<number | null>(null);
  const selected =
    points[Math.min(active ?? points.length - 1, points.length - 1)];
  const max = Math.max(1, ...points.map((p) => p[metric]));
  const start = points[0].at,
    span = Math.max(1, points.at(-1)!.at - start);
  const x = (at: number) => 65 + ((at - start) / span) * 645;
  const y = (value: number) => 220 - (value / max) * 180;
  const path = points
    .map((p, i) =>
      i ? `H ${x(p.at)} V ${y(p[metric])}` : `M ${x(p.at)} ${y(p[metric])}`,
    )
    .join(" ");
  return (
    <div className="analytics-chart">
      <svg
        viewBox="0 0 750 260"
        role="img"
        aria-label={`${metric === "held" ? "Airports held" : "Held-airport points"} across ${points.length} observations. Use the observation selector or data table for exact values.`}
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1="65" x2="710" y1={y(v)} y2={y(v)} stroke="#e7e0d2" />
            <text x="54" y={y(v) + 4} textAnchor="end">
              {v.toLocaleString("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              })}
            </text>
          </g>
        ))}
        <path d={`${path} V 220 H 65 Z`} fill="#193f5610" />
        <path d={path} fill="none" stroke="#193f56" strokeWidth="3" />
        <line
          x1={x(selected.at)}
          x2={x(selected.at)}
          y1="30"
          y2="220"
          stroke="#b58d54"
          strokeDasharray="4 4"
        />
        <circle
          cx={x(selected.at)}
          cy={y(selected[metric])}
          r="5"
          fill="#b13a25"
        />
        <text x="65" y="246">
          {new Date(start).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
        <text x="710" y="246" textAnchor="end">
          {new Date(points.at(-1)!.at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
      </svg>
      <label className="analytics-scrubber">
        Inspect observation
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={Math.min(active ?? points.length - 1, points.length - 1)}
          onChange={(e) => setActive(Number(e.target.value))}
          aria-label="Inspect trend observation"
          aria-valuetext={`${stamp(selected.at)}: ${number(selected[metric])}`}
        />
      </label>
      <output>
        {stamp(selected.at)} ·{" "}
        <strong>
          {number(selected[metric])}{" "}
          {metric === "held"
            ? `${selected.held === 1 ? "airport" : "airports"} held`
            : "points"}
        </strong>
      </output>
    </div>
  );
}
