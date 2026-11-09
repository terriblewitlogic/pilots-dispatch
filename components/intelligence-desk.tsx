"use client";
import { useEffect, useRef, useState } from "react";
import { Radar as RadarIcon, CloudSun, RefreshCw } from "lucide-react";
import { type Snapshot, type Airport } from "@/lib/dispatch";
import { type Operations } from "@/lib/operations";
import {
  type Location,
  type Radar,
  type Weather,
  type Regional,
  radarSchema,
  weatherSchema,
  regionalSavedSchema,
  distance,
  windLabel,
  ceiling,
} from "@/lib/intel";
import { useCompany } from "@/components/company-provider";
const catalog: Airport[] = [];
import OperationsMap from "./operations-map";
import LocationEntry from "./location-entry";
export type IntelView = "radar" | "weather" | "regional";
const stamp = (n: number) =>
  new Date(n).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const count = (n: number) => n.toLocaleString("en-US");
const countries = [
  ["US", "United States"],
  ["CA", "Canada"],
  ["MX", "Mexico"],
  ["GB", "United Kingdom"],
  ["AU", "Australia"],
  ["BR", "Brazil"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["JP", "Japan"],
  ["NZ", "New Zealand"],
];
export default function IntelligenceDesk({
  view,
  snapshot,
}: {
  view: IntelView;
  snapshot: Snapshot;
}) {
  const {
    company,
    db: { loadLocal, patchOperations },
  } = useCompany();
  const COMPANY = company.id;
  const [custom, setCustom] = useState<Airport[]>([]);
  const [saved, setSaved] = useState<Operations>({ pilots: [] }),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [airportQuery, setAirportQuery] = useState(""),
    [centerCode, setCenterCode] = useState(""),
    [radius, setRadius] = useState(50),
    [region, setRegion] = useState("US"),
    [companyFilter, setCompanyFilter] = useState(""),
    [tick, setTick] = useState(Date.now());
  const active = useRef(true),
    working = useRef(false);
  useEffect(() => {
    active.current = true;
    void loadLocal()
      .then((d) => {
        if (active.current) {
          setSaved(d.operations ?? { pilots: [] });
          setRegion(d.operations?.regional?.region ?? "US");
          const area =
            view === "weather" ? d.operations?.weather : d.operations?.radar;
          if (area) {
            setCenterCode(area.center.code);
            setRadius(area.radius);
          }
        }
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
    const timer = setInterval(() => setTick(Date.now()), 60000);
    return () => {
      active.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setError("");
    setCompanyFilter("");
  }, [view]);
  const flights =
    saved.fleet && saved.fleet.fetchedAt >= snapshot.airFetchedAt
      ? saved.fleet.flights
      : snapshot.air.flights;
  const airports = [
    ...new Map<string, Airport>(
      [
        ...custom,
        ...catalog,
        ...snapshot.airports,
        ...flights.flatMap((f) => (f.to ? [f.from, f.to] : [f.from])),
        ...(saved.radar ? [saved.radar.center] : []),
        ...(saved.weather ? [saved.weather.center] : []),
      ].map((a) => [a.code, a]),
    ).values(),
  ].sort((a, b) => a.code.localeCompare(b.code));
  const center =
    airports.find((a) => a.code === centerCode) ??
    snapshot.airports.find((a) => snapshot.air.held[a.code]) ??
    airports[0];
  const choices = [
    ...new Map(
      [
        ...(center ? [center] : []),
        ...airports
          .filter((a) =>
            airportQuery
              ? `${a.code} ${a.name}`
                  .toLowerCase()
                  .includes(airportQuery.toLowerCase())
              : !!snapshot.air.held[a.code] ||
                flights.some(
                  (f) => f.from.code === a.code || f.to?.code === a.code,
                ),
          )
          .slice(0, 60),
      ].map((a) => [a.code, a]),
    ).values(),
  ];
  const radar = saved.radar,
    weather = saved.weather,
    regional = saved.regional;
  const names = {
    ...Object.assign({}, ...Object.values(snapshot.boards).map((b) => b.cos)),
    ...saved.events?.cos,
    ...saved.regional?.cos,
  } as Record<string, { tag: string; name: string }>;
  const tag = (co?: string) =>
    co === COMPANY
      ? company.tag
      : co
        ? (names[co]?.tag ?? co)
        : "Unlisted company";
  async function refresh() {
    if (working.current || !loaded) return;
    working.current = true;
    setBusy(true);
    setError("");
    const requested = view;
    try {
      const response = await fetch(
        requested === "regional"
          ? `/api/regional?region=${encodeURIComponent(region.trim().toUpperCase())}`
          : `/api/${requested}`,
        requested === "regional"
          ? { signal: AbortSignal.timeout(40000) }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ center, radius }),
              signal: AbortSignal.timeout(40000),
            },
      );
      if (!response.headers.get("content-type")?.includes("application/json"))
        throw Error(
          "The server did not return data. Reload the page and try again.",
        );
      const raw = await response.json();
      if (!response.ok)
        throw Error(
          raw &&
            typeof raw === "object" &&
            "error" in raw &&
            typeof raw.error === "string"
            ? raw.error
            : "Check failed",
        );
      const patch: Partial<Operations> =
        requested === "radar"
          ? { radar: radarSchema.parse(raw) }
          : requested === "weather"
            ? { weather: weatherSchema.parse(raw) }
            : { regional: regionalSavedSchema.parse(raw) };
      if (active.current) {
        setSaved((s) => ({ ...s, ...patch }));
        setCompanyFilter("");
      }
      try {
        await patchOperations(patch);
      } catch {
        if (active.current)
          setNote("Results loaded but could not be saved in this browser.");
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : "Check failed.");
    } finally {
      working.current = false;
      if (active.current) setBusy(false);
    }
  }
  const rFlights =
      radar?.flights.filter(
        (f) => f.co !== COMPANY && (!companyFilter || f.co === companyFilter),
      ) ?? [],
    rLanded =
      radar?.landed.filter(
        (f) => f.co !== COMPANY && (!companyFilter || f.co === companyFilter),
      ) ?? [],
    rHeld = Object.entries(radar?.held ?? {}).filter(
      ([, a]) => !companyFilter || a.co === companyFilter,
    );
  const rivals = [
    ...new Set([
      ...(radar?.flights ?? []).flatMap((f) =>
        f.co && f.co !== COMPANY ? [f.co] : [],
      ),
      ...(radar?.landed ?? []).flatMap((f) =>
        f.co && f.co !== COMPANY ? [f.co] : [],
      ),
      ...Object.values(radar?.held ?? {}).flatMap((a) =>
        a.co !== COMPANY ? [a.co] : [],
      ),
    ]),
  ];
  const radarPins = radar
    ? [
        {
          ...radar.center,
          label: `Search center · ${radar.center.code}`,
          color: "#b48c4e",
        },
        ...rHeld.map(([code, a]) => ({
          ...a,
          label: `${code} · held by ${tag(a.co)}`,
          color: a.co === COMPANY ? "#173d59" : "#ad3b28",
        })),
        ...rFlights.flatMap((f) =>
          [f.from, f.to]
            .filter(
              (a): a is Location =>
                !!a && distance(radar.center, a) <= radar.radius,
            )
            .map((a) => ({
              ...a,
              label: `${f.cs} · ${tag(f.co)} · ${f.from.code} → ${f.to?.code ?? "—"}`,
              color: "#8d6747",
            })),
        ),
        ...rLanded.map((f) => ({
          ...f.at,
          label: `${f.cs} · landed ${stamp(f.t)}`,
          color: "#7b8e84",
        })),
      ]
    : [];
  const result =
    view === "radar" ? radar : view === "weather" ? weather : regional;
  const selectionChanged =
    view === "regional"
      ? !!regional && regional.region !== region.trim().toUpperCase()
      : !!result &&
        "center" in result &&
        (result.center.code !== center?.code || result.radius !== radius);
  const me = regional?.list.findIndex((r) => r.id === COMPANY) ?? -1;
  return (
    <section
      className="intelligence-desk"
      aria-label={
        view === "radar"
          ? "Rival radar"
          : view === "weather"
            ? "Weather briefings"
            : "Regional boards"
      }
    >
      <div className="ops-heading">
        <div>
          <div className="eyebrow">
            {view === "radar"
              ? "NEARBY ACTIVITY"
              : view === "weather"
                ? "BEFORE YOU FLY"
                : "COMPANY COMPETITION"}
          </div>
          <h2>
            {view === "radar"
              ? "Know who shares your airspace."
              : view === "weather"
                ? "A clearer picture of the skies."
                : "See the country’s company board."}
          </h2>
          <p>
            {view === "radar"
              ? "Nearby airport activity and listed holdings. Flights alone do not establish an attack or a change of control."
              : view === "weather"
                ? "Station observations supplied by the game. Nearby reports may differ from conditions at your airport. For game planning only."
                : "Country-level scores for this week, as returned by the game. This is separate from global and pilot rankings."}
          </p>
        </div>
        {view === "radar" ? (
          <RadarIcon size={28} />
        ) : view === "weather" ? (
          <CloudSun size={28} />
        ) : null}
      </div>
      {error && (
        <div className="notice" role="alert">
          {error} Previously saved results retain their original timestamp.
        </div>
      )}
      {note && (
        <div className="notice" role="status">
          {note}
        </div>
      )}
      {view !== "regional" && (
        <LocationEntry
          onChoose={(a) => {
            setCustom((v) => [a, ...v.filter((x) => x.code !== a.code)]);
            setCenterCode(a.code);
          }}
        />
      )}
      <div className="intel-controls">
        {view === "regional" ? (
          <label>
            Country code
            <input
              aria-label="Country code"
              list="country-codes"
              maxLength={2}
              value={region}
              onChange={(e) => setRegion(e.target.value.toUpperCase())}
            />
            <datalist id="country-codes">
              {countries.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </datalist>
          </label>
        ) : (
          <>
            <label>
              Find an airport
              <input
                aria-label="Find reference airport"
                placeholder="Code or airport name"
                value={airportQuery}
                onChange={(e) => setAirportQuery(e.target.value)}
              />
            </label>
            <label>
              Reference airport
              <select
                aria-label="Intelligence reference airport"
                value={center?.code ?? ""}
                onChange={(e) => setCenterCode(e.target.value)}
              >
                {choices.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Radius
              <select
                aria-label="Intelligence radius"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              >
                {[25, 50, 100].map((r) => (
                  <option key={r} value={r}>
                    {r} nm
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <button
          className="button refresh"
          disabled={
            busy ||
            !loaded ||
            (view === "regional" ? !/^[A-Z]{2}$/.test(region) : !center)
          }
          onClick={() => void refresh()}
        >
          <RefreshCw size={15} className={busy ? "spin" : ""} />
          {busy
            ? "Checking…"
            : view === "radar"
              ? "Refresh radar"
              : view === "weather"
                ? "Refresh weather"
                : "Refresh country board"}
        </button>
      </div>
      <p className="ops-footnote">
        On demand only · shared responses may be reused for{" "}
        {view === "radar"
          ? "up to five minutes"
          : view === "weather"
            ? "five minutes"
            : "two minutes"}
        .{" "}
        {result
          ? `Data checked ${stamp(result.fetchedAt)} · ${Math.max(0, Math.floor((tick - result.fetchedAt) / 60000))} min ago.`
          : "No check saved yet."}{" "}
        {selectionChanged
          ? "Selection changed. Refresh to load the new area; results below still describe the last check."
          : ""}
      </p>
      {!result && (
        <div className="ops-empty">
          <h3>
            {view === "regional"
              ? "Choose a country to begin."
              : "Choose an airport to begin."}
          </h3>
          <p>
            Refresh when you want a new check. Your latest result is saved in
            this browser and included in JSON backups.
          </p>
        </div>
      )}
      {view === "radar" && radar && (
        <>
          <Coverage data={radar} />
          <div className="ops-summary">
            <span>
              <strong>{rFlights.length}</strong> other-company / unlisted
              flights
            </span>
            <span>
              <strong>{rLanded.length}</strong> recent landings
            </span>
            <span>
              <strong>{Object.keys(radar.held).length}</strong> nearby listed
              holdings
            </span>
          </div>
          <div className="intel-controls">
            <label>
              Company filter
              <select
                aria-label="Radar company filter"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
              >
                <option value="">All companies</option>
                {rivals
                  .sort((a, b) => tag(a).localeCompare(tag(b)))
                  .map((co) => (
                    <option key={co} value={co}>
                      {tag(co)}
                    </option>
                  ))}
              </select>
            </label>
            <span className="ops-footnote">
              Navy: your company holdings · red: other holdings · brown: flight
              endpoints · gray: recent landings
            </span>
          </div>
          <OperationsMap
            pins={radarPins}
            fitKey={`${radar.fetchedAt}:${radar.center.code}:${radar.radius}:${companyFilter}`}
            pathLabel="Airport activity · not aircraft positions"
          />
          <section className="ranking-table intel-table">
            <div className="card-heading">
              <div>
                <h2>Departures & destinations</h2>
                <p>
                  At least one endpoint lies within {radar.radius} nm of{" "}
                  {radar.center.code}. These are returned flight records, not
                  live positions.
                </p>
              </div>
            </div>
            <div className="ops-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>PILOT / COMPANY</th>
                    <th>ROUTE</th>
                    <th>DEPARTED</th>
                    <th>COMPANY CONNECTION</th>
                  </tr>
                </thead>
                <tbody>
                  {rFlights.map((f) => (
                    <tr key={`${f.pid}:${f.t0}`}>
                      <td>
                        {f.cs}
                        <small>
                          {tag(f.co)} · {f.type ?? "Aircraft unlisted"}
                        </small>
                      </td>
                      <td>
                        {f.from.code} → {f.to?.code ?? "—"}
                      </td>
                      <td>{stamp(f.t0)}</td>
                      <td>
                        {[f.from, f.to]
                          .filter((a): a is Location => !!a)
                          .filter((a) => radar.held[a.code]?.co === COMPANY)
                          .map((a) => a.code)
                          .join(", ") || "None in checked cells"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rFlights.length && (
                <div className="empty">
                  No matching flight endpoints returned in this area.
                </div>
              )}
            </div>
          </section>
          <div className="intel-columns">
            <section className="ranking-table">
              <div className="card-heading">
                <h2>Recent landings</h2>
              </div>
              <div className="ops-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>PILOT / COMPANY</th>
                      <th>AIRPORT</th>
                      <th>LANDED</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rLanded.map((f) => (
                      <tr key={f.pid}>
                        <td>
                          {f.cs}
                          <small>{tag(f.co)}</small>
                        </td>
                        <td>{f.at.code}</td>
                        <td>{stamp(f.t)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rLanded.length && (
                  <div className="empty">
                    No matching recent landings returned.
                  </div>
                )}
              </div>
            </section>
            <section className="ranking-table">
              <div className="card-heading">
                <h2>Listed holdings</h2>
              </div>
              <div className="ops-table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>AIRPORT</th>
                      <th>HOLDER</th>
                      <th>RETURNED SCORE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rHeld
                      .sort((a, b) => a[0].localeCompare(b[0]))
                      .map(([code, a]) => (
                        <tr
                          key={code}
                          className={a.co === COMPANY ? "chosen" : ""}
                        >
                          <td>{code}</td>
                          <td>{tag(a.co)}</td>
                          <td>{count(a.v)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!rHeld.length && (
                  <div className="empty">No matching holdings returned.</div>
                )}
              </div>
            </section>
          </div>
          <p className="ops-footnote">
            Company names resolve from your saved company data; unknown IDs stay
            visible. Holdings here do not replace verified airport standings or
            the territory history baseline.
          </p>
        </>
      )}
      {view === "weather" && weather && (
        <>
          <Coverage data={weather} />
          <OperationsMap
            pins={[
              {
                ...weather.center,
                label: `Reference · ${weather.center.code}`,
                color: "#ad3b28",
              },
              ...weather.stations.map((s) => ({
                ...s,
                label: `${s.id} · ${windLabel(s)}`,
                color: "#173d59",
              })),
            ]}
            fitKey={`${weather.fetchedAt}:${weather.center.code}:${weather.radius}`}
            pathLabel="Reporting stations · nearest first"
          />
          <div className="weather-grid">
            {weather.stations.map((s) => (
              <article className="weather-card" key={s.id}>
                <div className="card-heading">
                  <div>
                    <h2>{s.id}</h2>
                    <p>
                      {distance(weather.center, s).toFixed(1)} nm from{" "}
                      {weather.center.code}
                    </p>
                  </div>
                  <span
                    className={`badge ${!s.o || tick - s.o * 1000 > 3600000 ? "watch" : "secure"}`}
                  >
                    {!s.o
                      ? "Time unreported"
                      : tick - s.o * 1000 > 3600000
                        ? "Older than 1 hour"
                        : "Recent report"}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Wind</dt>
                    <dd>{windLabel(s)}</dd>
                  </div>
                  <div>
                    <dt>Visibility</dt>
                    <dd>
                      {s.v === undefined
                        ? "Not reported"
                        : `${(s.v / 1000).toFixed(1)} km`}
                    </dd>
                  </div>
                  <div>
                    <dt>Temperature / dew point</dt>
                    <dd>
                      {s.t ?? "—"}°C / {s.d ?? "—"}°C
                    </dd>
                  </div>
                  <div>
                    <dt>Reported ceiling</dt>
                    <dd>{ceiling(s)}</dd>
                  </div>
                  <div>
                    <dt>Pressure</dt>
                    <dd>{s.q === undefined ? "Not reported" : `${s.q} hPa`}</dd>
                  </div>
                  <div>
                    <dt>Conditions</dt>
                    <dd>{s.x || "None reported"}</dd>
                  </div>
                </dl>
                <p className="ops-footnote">
                  Observed {s.o ? stamp(s.o * 1000) : "time unavailable"}.
                  Checked {stamp(weather.fetchedAt)}.
                </p>
                {s.r && (
                  <details>
                    <summary>Raw station report</summary>
                    <code>{s.r}</code>
                  </details>
                )}
              </article>
            ))}
          </div>
          {!weather.stations.length && (
            <div className="ops-empty">
              <h3>No station reports returned in this radius.</h3>
              <p>
                Try a wider radius or another airport. Missing reports do not
                mean clear weather.
              </p>
            </div>
          )}
          <p className="ops-footnote">
            Surface wind is reported in knots; cloud bases are in feet. This
            view shows observations, not a forecast or the game’s interpolated
            weather aloft.
          </p>
        </>
      )}
      {view === "regional" && regional && (
        <>
          <div className="personal-ranks">
            <div className="pilot-identity">
              <span>
                {countries.find((c) => c[0] === regional.region)?.[1] ??
                  regional.region}
                <small>
                  {regional.region} · this week · {regional.list.length}{" "}
                  returned entries
                </small>
              </span>
            </div>
            <div>
              <span>{company.tag} IN RETURNED BOARD</span>
              <strong>{me >= 0 ? `#${me + 1}` : "Not listed"}</strong>
            </div>
            {me >= 0 && (
              <div>
                <span>DELIVERED VALUE</span>
                <strong>{count(regional.list[me].value)}</strong>
              </div>
            )}
          </div>
          <p className="ops-footnote">
            {me < 0
              ? "Your company is absent from this response. Its full country rank and score cannot be inferred."
              : "Position refers to the returned country board."}{" "}
            The response does not establish a full global company rank.
          </p>
          <section className="ranking-table">
            <div className="card-heading">
              <div>
                <h2>{regional.region} company leaders</h2>
                <p>
                  Weekly delivered value, not airport control scores or treasury
                  balance.
                </p>
              </div>
            </div>
            <div className="ops-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>PLACE</th>
                    <th>COMPANY</th>
                    <th>DELIVERED VALUE</th>
                    <th>GAP TO PREVIOUS</th>
                  </tr>
                </thead>
                <tbody>
                  {regional.list.map((r, i) => (
                    <tr key={r.id} className={r.id === COMPANY ? "chosen" : ""}>
                      <td>{i + 1}</td>
                      <td>
                        {regional.cos[r.id]?.tag ?? r.id}
                        <small>
                          {regional.cos[r.id]?.name ?? "Name unavailable"}
                        </small>
                      </td>
                      <td>{count(r.value)}</td>
                      <td>
                        {i
                          ? count(
                              Math.max(0, regional.list[i - 1].value - r.value),
                            )
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!regional.list.length && (
                <div className="empty">
                  No companies returned for this country code.
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
function Coverage({ data }: { data: Radar | Weather }) {
  return (
    <>
      <p className="ops-footnote">
        Showing {data.radius} nm around {data.center.code} · {data.cells.length}{" "}
        cells requested. Coverage follows returned game records.
      </p>
      {data.warnings.length > 0 && (
        <div className="notice" role="status">
          Partial coverage: {data.warnings.join(" ")} Missing areas are not an
          all-clear.
        </div>
      )}
    </>
  );
}
