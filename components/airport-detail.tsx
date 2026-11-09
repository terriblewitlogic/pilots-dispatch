"use client";
import { useCompany } from "@/components/company-provider";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, RefreshCw, Star, X } from "lucide-react";
import { type Assessment, type Change } from "@/lib/dispatch";
export const statusLabels = {
  secure: "Secure",
  watch: "Watch closely",
  urgent: "Defend now",
  lost: "Territory lost",
  target: "Expansion",
  unknown: "Needs checking",
};
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const time = (n: number) =>
  new Date(n).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
type Detail = {
  level?: number;
  pts?: number;
  built?: Record<string, unknown>;
  project?: unknown;
  holder?: string | null;
  bases?: string[];
  parked?: { cs: string; reg?: string; type?: string; name?: string }[];
  cos: Record<string, { name: string; tag: string }>;
  fetchedAt: number;
};
function describe(value: unknown): string {
  if (value == null) return "None listed";
  if (typeof value === "string" || typeof value === "number")
    return String(value);
  if (typeof value === "object" && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    return (
      ["name", "kind", "code", "level", "gates"]
        .filter((k) => typeof v[k] === "string" || typeof v[k] === "number")
        .map((k) => `${k}: ${v[k]}`)
        .join(" · ") || "Project listed"
    );
  }
  return "Listed";
}
export default function AirportDetail({
  airport: a,
  watching,
  onWatch,
  onClose,
  changes,
  refreshKey,
}: {
  airport: Assessment;
  watching: boolean;
  onWatch: () => void;
  onClose: () => void;
  changes: Change[];
  refreshKey: number;
}) {
  const {
    company,
    db: { loadLocal, patchOperations },
  } = useCompany();
  const COMPANY = company.id;
  const [detail, setDetail] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [expanded, setExpanded] = useState(false);
  const cache = useRef(new Map<string, Detail>()),
    focus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    focus.current?.focus({ preventScroll: true });
    setExpanded(false);
  }, [a.code]);
  useEffect(() => {
    const control = new AbortController();
    setDetail(cache.current.get(a.code) ?? null);
    setBusy(true);
    setError("");
    fetch(
      `/api/airport?code=${encodeURIComponent(a.code)}${attempt ? "&fresh=1" : ""}`,
      { signal: control.signal },
    )
      .then(async (r) => {
        const d = (await r.json()) as Detail & { error?: string };
        if (!r.ok) throw Error(d.error || "Details unavailable");
        cache.current.set(a.code, d);
        setDetail(d);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!control.signal.aborted) setBusy(false);
      });
    return () => control.abort();
  }, [a.code, attempt, refreshKey]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose]);
  const rows = a.board?.list ?? [],
    companyIndex = rows.findIndex((r) => r.id === COMPANY),
    shown = expanded ? rows : rows.filter((r, i) => i < 4 || r.id === COMPANY);
  return (
    <section
      className="brief-card airport-detail"
      aria-label={`Airport details for ${a.code}`}
    >
      <div className="card-heading">
        <span className="eyebrow">AIRPORT BRIEF</span>
        <button
          ref={focus}
          className="icon-button"
          onClick={onClose}
          aria-label="Close airport details"
        >
          <X size={18} />
        </button>
      </div>
      <div className="airport-title">
        <span>{a.code}</span>
        <span className={`badge ${a.status}`}>{statusLabels[a.status]}</span>
      </div>
      <h3>{a.name}</h3>
      <div className="coordinates">
        {Math.abs(a.lat).toFixed(3)}° {a.lat < 0 ? "S" : "N"} /{" "}
        {Math.abs(a.lon).toFixed(3)}° {a.lon < 0 ? "W" : "E"}
      </div>
      <div className="detail-actions">
        <button className="button compact" onClick={onWatch}>
          <Star size={14} fill={watching ? "currentColor" : "none"} />
          {watching ? "Watching · remove" : "Watch airport"}
        </button>
        <button
          className="icon-button"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
          aria-label="Refresh airport details"
        >
          <RefreshCw size={14} className={busy ? "spin" : ""} />
        </button>
      </div>
      <div className="brief-score">
        <div>
          {a.held ? "your company lead over rival" : "Additional score to lead"}
          <strong>
            {!a.verified
              ? "—"
              : a.held
                ? a.rival
                  ? `${a.gap >= 0 ? "+" : ""}${fmt(a.gap)}`
                  : "Uncontested"
                : fmt(a.needed)}
          </strong>
        </div>
        <span>PTS</span>
      </div>
      {!a.verified && (
        <p className="brief-hint warning">
          Current standings are unverified.{" "}
          {a.board?.fetchedAt
            ? `Older values below were checked ${time(a.board.fetchedAt)}.`
            : "Refresh to check this airport."}
        </p>
      )}
      <div className="mini-label">
        AIRPORT STANDINGS{" "}
        {companyIndex >= 0 && `· ${company.tag} #${companyIndex + 1}`}
      </div>
      <div className="rankings">
        {shown.length ? (
          shown.map((r) => (
            <div key={r.id} className={r.id === COMPANY ? "rank tex" : "rank"}>
              <span className="rank-no">{rows.indexOf(r) + 1}</span>
              <strong>{a.board?.cos[r.id]?.tag ?? r.id}</strong>
              <span>{fmt(r.value)}</span>
            </div>
          ))
        ) : (
          <p>
            {a.verified
              ? "No scored companies returned."
              : "No verified standings available."}
          </p>
        )}
      </div>
      {rows.length > 4 && (
        <button
          className="text-link link-button"
          onClick={() => setExpanded((x) => !x)}
        >
          {expanded ? "Show fewer" : `Show all ${rows.length} companies`}
        </button>
      )}
      {a.board?.fetchedAt ? (
        <p className="brief-hint">
          Standings checked {time(a.board.fetchedAt)}
        </p>
      ) : null}
      <div className="detail-section">
        <h4>Airport operations</h4>
        {error && (
          <p className="warning" role="status">
            {error}
          </p>
        )}
        {busy && !detail ? (
          <p>Loading airport details…</p>
        ) : detail ? (
          <>
            <dl className="detail-facts">
              <div>
                <dt>Holder</dt>
                <dd>
                  {detail.holder
                    ? (detail.cos[detail.holder]?.tag ?? detail.holder)
                    : "Not listed"}
                </dd>
              </div>
              <div>
                <dt>Level</dt>
                <dd>{detail.level ?? "—"}</dd>
              </div>
              <div>
                <dt>Runways</dt>
                <dd>{a.runways ?? "—"}</dd>
              </div>
              <div>
                <dt>Nearest your company</dt>
                <dd>
                  {Number.isFinite(a.distance)
                    ? `${Math.round(a.distance)} nm`
                    : "—"}
                </dd>
              </div>
            </dl>
            <p>
              <strong>Improvements:</strong>{" "}
              {Object.keys(detail.built ?? {}).length
                ? Object.entries(detail.built!)
                    .map(([k, v]) => `${k} ${describe(v)}`)
                    .join(" · ")
                : "None listed"}
            </p>
            <p>
              <strong>Project:</strong> {describe(detail.project)}
            </p>
            {!!detail.bases?.length && (
              <p>
                <strong>Bases:</strong>{" "}
                {detail.bases
                  .map((co) => detail.cos[co]?.tag ?? co)
                  .join(" / ")}
              </p>
            )}
            <h4>Parked aircraft</h4>
            {detail.parked?.length ? (
              detail.parked.map((p, i) => (
                <div className="parked-row" key={`${p.reg}-${i}`}>
                  <strong>{p.name || p.type || "Aircraft"}</strong>
                  <span>
                    {p.cs}
                    {p.reg ? ` · ${p.reg}` : ""}
                  </span>
                </div>
              ))
            ) : (
              <p>No parked aircraft returned.</p>
            )}
            <small>Airport details checked {time(detail.fetchedAt)}</small>
          </>
        ) : null}
      </div>
      {!!changes.length && (
        <div className="detail-section">
          <h4>Observed changes</h4>
          {changes.slice(0, 4).map((c, i) => (
            <p key={i}>
              {c.text}
              <small>
                {time(c.from)} → {time(c.to)}
              </small>
            </p>
          ))}
        </div>
      )}
      <p className="brief-hint">
        {a.held
          ? "Defense reflects the latest verified scoring rival."
          : "Score estimate includes the 2,000-point minimum. Base ownership and game rules can affect control."}
      </p>
      <a
        className="text-link"
        href={`https://pilots.nimblebit.com/api/standings?code=${a.code}&co=${COMPANY}`}
        target="_blank"
        rel="noreferrer"
      >
        View standings source <ArrowUpRight size={13} />
      </a>
    </section>
  );
}
