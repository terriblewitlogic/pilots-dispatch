"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Plus, Upload } from "lucide-react";
import { useCompany } from "./company-provider";
import Dialog from "./dialog";
import {
  EMPTY_TOTALS,
  parsePerformanceImport,
  performanceCsv,
  performanceFields,
  performanceReport,
  performanceSnapshotSchema,
  type PerformanceMetric,
  type PerformanceSnapshot,
} from "@/lib/performance";

const fmt = (value: number | null, digits = 1) =>
  value === null
    ? "—"
    : value.toLocaleString("en-US", { maximumFractionDigits: digits });
const stamp = (time: number) =>
  new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const sourceName = {
  manual: "Entered totals",
  "company-sync": "Company Sync import",
  "local-sync": "Private local sync",
  import: "Imported totals",
};
const localDateTime = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
function download(contents: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PerformanceDashboard({
  scope,
  now,
}: {
  scope: "company" | "pilot";
  now: number;
}) {
  const {
    company,
    db: { loadLocal, recordPerformance },
  } = useCompany();
  const [updatedAt, setUpdatedAt] = useState(now);
  const reportNow = Math.max(now, updatedAt);
  const [history, setHistory] = useState<PerformanceSnapshot[]>([]);
  const [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [note, setNote] = useState("");
  const [pilotId, setPilotId] = useState(""),
    [days, setDays] = useState(7);
  const [period, setPeriod] = useState(false),
    [editing, setEditing] = useState(false);
  const [metric, setMetric] = useState<PerformanceMetric>("earned");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let mounted = true;
    void loadLocal()
      .then((local) => {
        if (!mounted) return;
        setHistory(local.operations?.performance ?? []);
      })
      .catch(() => {
        if (mounted)
          setError("Could not load performance history from this browser.");
      })
      .finally(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [loadLocal]);
  const pilots = useMemo(
    () => [
      ...new Map(
        [...history]
          .sort((a, b) => a.observedAt - b.observedAt)
          .filter((row) => row.scope === "pilot")
          .map((row) => [row.subjectId, row.label]),
      ).entries(),
    ],
    [history],
  );
  const chosenPilot = pilots.some(([id]) => id === pilotId)
    ? pilotId
    : (pilots[0]?.[0] ?? "");
  const subjectId = scope === "company" ? company.id : chosenPilot;
  const report = useMemo(
    () =>
      performanceReport(
        history,
        company.id,
        scope,
        subjectId,
        reportNow - days * 86400000,
        reportNow,
      ),
    [history, company.id, scope, subjectId, reportNow, days],
  );
  const latest = report.latest;
  async function save(rows: PerformanceSnapshot[]) {
    const result = await recordPerformance(rows);
    setHistory(result);
    setUpdatedAt(Date.now());
    const pilot = rows.find((row) => row.scope === "pilot");
    if (pilot) setPilotId(pilot.subjectId);
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      if (file.size > 2_000_000)
        throw Error("Choose an export smaller than 2 MB.");
      const rows = parsePerformanceImport(
        JSON.parse(await file.text()),
        company.id,
      );
      await save(rows);
      setNote(
        `Imported ${rows.length} observation${rows.length === 1 ? "" : "s"}. ${rows.every((row) => row.scope === "company") ? "Company totals are available in the Company view." : "Choose the matching Company or Pilot view to inspect the totals."}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not import this file.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function remove(row: PerformanceSnapshot) {
    setBusy(true);
    setError("");
    try {
      setHistory(await recordPerformance([], row));
      setNote("Local observation removed.");
    } catch {
      setError("Could not remove this observation.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="analytics-desk"
      aria-label={`${scope === "company" ? "Company" : "Pilot"} operating performance`}
    >
      <div className="analytics-toolbar">
        <div>
          <span className="eyebrow">
            {scope === "company" ? "COMPANY PERFORMANCE" : "PILOT PERFORMANCE"}
          </span>
          <h2>
            {scope === "company"
              ? company.name
              : (latest?.label ?? "Your pilot’s performance")}
          </h2>
          <p>
            {latest
              ? `${sourceName[latest.source]} · observed ${stamp(latest.observedAt)}`
              : "Add a first observation to start tracking operating performance."}
          </p>
        </div>
        <div className="analytics-controls">
          {scope === "pilot" && pilots.length > 0 && (
            <label>
              Pilot
              <select
                aria-label="Performance pilot"
                value={chosenPilot}
                onChange={(e) => setPilotId(e.target.value)}
              >
                {pilots.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name} · {id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button compact"
            disabled={!loaded || busy}
            onClick={() => setEditing(true)}
          >
            <Plus size={15} />
            Update totals
          </button>
          <button
            className="button compact"
            disabled={!loaded || busy}
            onClick={() => input.current?.click()}
          >
            <Upload size={15} />
            Import totals
          </button>
          <input
            ref={input}
            hidden
            type="file"
            accept=".json,application/json"
            aria-label="Import performance totals"
            onChange={(e) => void importFile(e.target.files?.[0])}
          />
        </div>
      </div>
      <p className="performance-source-note">
        These totals update after a saved Private Sync on your own local server,
        or when you enter or import statistics. Refresh territory updates public
        data only.{" "}
        {scope === "company"
          ? "Company Sync exports provide earnings, jobs, and treasury balance; distance, hours, and departures remain unavailable unless you supply company-wide totals."
          : "Private Sync supplies the connected pilot’s career totals. You can also enter or import them. Pilots stay separate and are never summed into company totals."}
      </p>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      {note && (
        <div className="notice" role="status">
          {note}
        </div>
      )}
      <a className="text-link" href="/sync">
        Private Sync · local environment only →
      </a>
      <div className="analytics-toolbar performance-filters">
        <div className="map-tabs" aria-label="Performance values">
          <button
            aria-pressed={!period}
            className={!period ? "selected" : ""}
            onClick={() => setPeriod(false)}
          >
            Latest totals
          </button>
          <button
            aria-pressed={period}
            className={period ? "selected" : ""}
            onClick={() => setPeriod(true)}
          >
            Period change
          </button>
        </div>
        <div className="analytics-controls">
          <label>
            History period
            <select
              aria-label="Operating history period"
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
            disabled={!report.rows.length}
            onClick={() =>
              download(
                performanceCsv(report.rows),
                `pilots-${scope}-${subjectId}-${days}d.csv`,
                "text/csv;charset=utf-8",
              )
            }
          >
            <Download size={15} />
            Export CSV
          </button>
        </div>
      </div>
      <div className="analytics-kpis">
        {performanceFields.map(({ key, label, unit, integer }) => {
          const m = report.metrics[key],
            value = period ? m.change : m.total;
          return (
            <article
              className="analytics-kpi"
              aria-label={
                key === "balance" && scope === "company"
                  ? "Treasury balance"
                  : label
              }
              key={key}
            >
              <span className="stat-label">
                {key === "balance" && scope === "company"
                  ? "Treasury balance"
                  : label}
                {period && key === "balance" ? " change" : ""}
              </span>
              <strong>{fmt(value, integer ? 0 : 1)}</strong>
              <p>
                {value !== null
                  ? unit
                  : period && m.reset
                    ? "Counter decreased; comparison unavailable"
                    : period
                      ? "Needs two recorded values in this period"
                      : "Not supplied"}
              </p>
              {period && m.change !== null && (
                <small>
                  {stamp(m.from!)} – {stamp(m.to!)}
                </small>
              )}
            </article>
          );
        })}
      </div>
      <div className="performance-rates">
        <article className="analytics-kpi" aria-label="Earnings per departure">
          <span className="stat-label">Earnings per departure</span>
          <strong>
            {fmt(period ? report.periodPerFlight : report.perFlight)}
          </strong>
          <p>Game currency · based on reported departures</p>
        </article>
        <article
          className="analytics-kpi"
          aria-label="Earnings per flight hour"
        >
          <span className="stat-label">Earnings per flight hour</span>
          <strong>{fmt(period ? report.periodPerHour : report.perHour)}</strong>
          <p>Game currency · matched earnings and hours</p>
        </article>
      </div>
      <p className="analytics-coverage">
        {report.rows.length}{" "}
        {report.rows.length === 1 ? "observation" : "observations"} in this
        period.{" "}
        {period
          ? "Changes compare the first and last supplied value for each metric within the window."
          : "Latest totals are cumulative career/company records, except balance, which is the recorded cash balance."}{" "}
        Earnings are gross earnings, not profit; departures are not completed
        flights.
      </p>
      <section className="activity-card analytics-trend">
        <div className="card-heading">
          <div>
            <h2>Operating performance trend</h2>
            <p>
              Recorded totals ·{" "}
              {scope === "company" ? "company-wide" : "selected pilot only"}
            </p>
          </div>
          <label className="analytics-metric">
            Measure
            <select
              aria-label="Operating trend measure"
              value={metric}
              onChange={(e) => setMetric(e.target.value as PerformanceMetric)}
            >
              {performanceFields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <PerformanceTrend rows={report.rows} metric={metric} />
      </section>
      <details className="activity-card analytics-observations">
        <summary>Recorded observations · {report.rows.length}</summary>
        <div className="ops-table-scroll">
          <table>
            <thead>
              <tr>
                <th>OBSERVED</th>
                <th>SOURCE</th>
                {performanceFields.map((field) => (
                  <th key={field.key}>{field.label.toUpperCase()}</th>
                ))}
                <th>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.observedAt}>
                  <td>{stamp(row.observedAt)}</td>
                  <td>{sourceName[row.source]}</td>
                  {performanceFields.map((f) => (
                    <td key={f.key}>{fmt(row.totals[f.key])}</td>
                  ))}
                  <td>
                    <button
                      className="button compact"
                      disabled={busy}
                      aria-label={`Remove observation ${stamp(row.observedAt)}`}
                      onClick={() => void remove(row)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <div className="performance-backup">
        <p className="ops-footnote">
          Totals are stored in this browser for the selected company and
          included in Dispatch backups. Up to 1,000 observations from the last
          90 days are kept when saving. Unknown values stay blank; a decreasing
          cumulative counter disables its period comparison.
        </p>
        <button
          className="button compact"
          disabled={!history.length}
          onClick={() =>
            download(
              JSON.stringify(
                {
                  format: "pilots-performance",
                  version: 1,
                  observations: history,
                },
                null,
                2,
              ),
              `pilots-performance-${company.id}.json`,
              "application/json",
            )
          }
        >
          <Download size={15} />
          Export totals JSON
        </button>
      </div>
      {editing && (
        <TotalsEditor
          key={`${scope}:${subjectId}`}
          scope={scope}
          companyId={company.id}
          companyName={company.name}
          latest={latest}
          onClose={() => setEditing(false)}
          onSave={async (row) => {
            await save([row]);
            setEditing(false);
            setNote(
              "Totals saved in this browser. Add another observation later to track changes.",
            );
          }}
        />
      )}
    </section>
  );
}

function TotalsEditor({
  scope,
  companyId,
  companyName,
  latest,
  onClose,
  onSave,
}: {
  scope: "company" | "pilot";
  companyId: string;
  companyName: string;
  latest: PerformanceSnapshot | null;
  onClose: () => void;
  onSave: (row: PerformanceSnapshot) => Promise<void>;
}) {
  const [id, setId] = useState(latest?.subjectId ?? ""),
    [label, setLabel] = useState(latest?.label ?? "");
  const [date, setDate] = useState(localDateTime),
    [values, setValues] = useState<Record<PerformanceMetric, string>>({
      earned: "",
      distanceNm: "",
      hours: "",
      flights: "",
      jobs: "",
      balance: "",
    });
  const [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  return (
    <Dialog
      title={`Update ${scope} totals`}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <h2>Update {scope} totals</h2>
      <p>
        Enter cumulative values from{" "}
        {scope === "company"
          ? "your company’s records"
          : "the pilot’s career stats"}
        . Leave unavailable values blank. Money earned is not cash balance or
        profit.
      </p>
      <form
        className="performance-entry"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const totals = { ...EMPTY_TOTALS };
          for (const field of performanceFields)
            totals[field.key] = values[field.key].trim()
              ? Number(values[field.key])
              : null;
          const parsed = performanceSnapshotSchema.safeParse({
            companyId,
            scope,
            subjectId: scope === "company" ? companyId : id.trim(),
            label: scope === "company" ? companyName : label.trim(),
            observedAt: new Date(date).getTime(),
            source: "manual",
            totals,
          });
          if (!parsed.success) {
            setError(
              "Enter a pilot ID and name when applicable, a valid time, and at least one nonnegative total. Departures and jobs must be whole numbers.",
            );
            return;
          }
          setSaving(true);
          try {
            await onSave(parsed.data);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not save totals.");
          } finally {
            setSaving(false);
          }
        }}
      >
        {scope === "pilot" && (
          <>
            <label>
              Pilot ID
              <input
                required
                value={id}
                onChange={(e) => setId(e.target.value)}
                pattern="[a-zA-Z0-9_-]{1,40}"
                maxLength={40}
              />
            </label>
            <label>
              Pilot callsign
              <input
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={160}
              />
            </label>
            <p className="ops-footnote">
              Use the same ID for this pilot each time. Change the ID and
              callsign to start a separate pilot history. Pilot totals remain
              personal career totals even if they include work before joining
              this company.
            </p>
          </>
        )}
        <label>
          Observed at (your local time)
          <input
            required
            type="datetime-local"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="performance-entry-fields">
          {performanceFields.map((field) => (
            <label key={field.key}>
              {field.key === "balance" && scope === "company"
                ? "Treasury balance"
                : field.label}
              <input
                aria-label={`${field.label} total`}
                type="number"
                min="0"
                step={field.integer ? "1" : "any"}
                value={values[field.key]}
                onChange={(e) =>
                  setValues((old) => ({ ...old, [field.key]: e.target.value }))
                }
                placeholder={field.unit}
              />
            </label>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        <button className="button refresh" disabled={saving} type="submit">
          {saving ? "Saving…" : "Save totals"}
        </button>
      </form>
    </Dialog>
  );
}

function PerformanceTrend({
  rows,
  metric,
}: {
  rows: PerformanceSnapshot[];
  metric: PerformanceMetric;
}) {
  const points = rows.filter((row) => row.totals[metric] !== null);
  const [index, setIndex] = useState<number | null>(null);
  if (points.length < 2)
    return (
      <div className="empty">
        <h3>
          {points.length ? "First value recorded." : "No recorded values yet."}
        </h3>
        <p>
          Use Update totals or Import totals to add observations. Two values are
          needed to show a trend.
        </p>
      </div>
    );
  const selected =
    points[Math.min(index ?? points.length - 1, points.length - 1)];
  const start = points[0].observedAt,
    end = points.at(-1)!.observedAt,
    max = Math.max(1, ...points.map((row) => row.totals[metric]!));
  const x = (row: PerformanceSnapshot) =>
    70 + (640 * (row.observedAt - start)) / Math.max(1, end - start);
  const y = (row: PerformanceSnapshot) =>
    220 - (180 * row.totals[metric]!) / max;
  const path = points
    .map((row, i) => (i ? `H ${x(row)} V ${y(row)}` : `M ${x(row)} ${y(row)}`))
    .join(" ");
  const field = performanceFields.find((field) => field.key === metric)!;
  return (
    <div className="analytics-chart">
      <svg
        viewBox="0 0 750 260"
        role="img"
        aria-label={`${field.label} recorded totals trend`}
      >
        {[0, max / 2, max].map((value) => (
          <g key={value}>
            <line
              x1="70"
              x2="710"
              y1={220 - (180 * value) / max}
              y2={220 - (180 * value) / max}
              stroke="#e7e0d2"
            />
            <text x="60" y={224 - (180 * value) / max} textAnchor="end">
              {value.toLocaleString("en-US", {
                notation: "compact",
                maximumFractionDigits: 1,
              })}
            </text>
          </g>
        ))}
        <path d={`${path} V 220 H 70 Z`} fill="#193f5610" />
        <path d={path} fill="none" stroke="#193f56" strokeWidth="3" />
        <circle cx={x(selected)} cy={y(selected)} r="5" fill="#b13a25" />
        <text x="70" y="246">
          {new Date(start).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
        <text x="710" y="246" textAnchor="end">
          {new Date(end).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </text>
      </svg>
      <label className="analytics-scrubber">
        Inspect observation
        <input
          aria-label="Inspect operating observation"
          type="range"
          min={0}
          max={points.length - 1}
          value={Math.min(index ?? points.length - 1, points.length - 1)}
          onChange={(e) => setIndex(Number(e.target.value))}
          aria-valuetext={`${stamp(selected.observedAt)}: ${fmt(selected.totals[metric])} ${field.unit}`}
        />
      </label>
      <output>
        {stamp(selected.observedAt)} ·{" "}
        <strong>
          {fmt(selected.totals[metric])} {field.unit}
        </strong>
      </output>
      <p className="ops-footnote">
        The chart holds each recorded total until the next supplied value. It
        does not measure activity between observations.
      </p>
    </div>
  );
}
