"use client";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Plane, Search, ArrowUpRight, RefreshCw } from "lucide-react";
import { companyDatabase } from "@/lib/local-db";
import {
  companySchema,
  companyIdSchema,
  type SelectedCompany,
} from "@/lib/company";
const KEY = "pilots-dispatch:selected-company";
type Scope = {
  company: SelectedCompany;
  db: ReturnType<typeof companyDatabase>;
  changeCompany: () => void;
};
const Context = createContext<Scope | null>(null);
export function useCompany() {
  const scope = useContext(Context);
  if (!scope) throw Error("Choose a company first");
  return scope;
}
function Scoped({
  company,
  changeCompany,
  children,
}: {
  company: SelectedCompany;
  changeCompany: () => void;
  children: ReactNode;
}) {
  const db = useMemo(() => companyDatabase(company.id), [company.id]);
  return (
    <Context.Provider value={{ company, db, changeCompany }}>
      {children}
    </Context.Provider>
  );
}
export default function CompanyProvider({ children }: { children: ReactNode }) {
  const [company, setCompany] = useState<SelectedCompany | null>(null),
    [ready, setReady] = useState(false),
    [choosing, setChoosing] = useState(false);
  useEffect(() => {
    try {
      const saved = companySchema.safeParse(
        JSON.parse(localStorage.getItem(KEY) || "null"),
      );
      if (saved.success) setCompany(saved.data);
    } catch {}
    setReady(true);
  }, []);
  function choose(next: SelectedCompany) {
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {}
    setCompany(next);
    setChoosing(false);
  }
  if (!ready)
    return (
      <div className="company-loading" role="status">
        Opening Pilots Dispatch…
      </div>
    );
  // Unmount the whole desk during a switch. Outstanding requests retain the old DB closure.
  if (!company || choosing)
    return (
      <CompanyChooser
        current={company}
        onChoose={choose}
        onCancel={() => setChoosing(false)}
      />
    );
  return (
    <Scoped
      key={company.id}
      company={company}
      changeCompany={() => setChoosing(true)}
    >
      {children}
    </Scoped>
  );
}
function CompanyChooser({
  current,
  onChoose,
  onCancel,
}: {
  current: SelectedCompany | null;
  onChoose: (co: SelectedCompany) => void;
  onCancel: () => void;
}) {
  const [companies, setCompanies] = useState<SelectedCompany[]>([]),
    [query, setQuery] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [id, setId] = useState(""),
    [tag, setTag] = useState(""),
    [name, setName] = useState("");
  async function load() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/companies", {
          signal: AbortSignal.timeout(20000),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.error || "Directory unavailable");
      setCompanies(companySchema.array().parse(d.companies));
      setLoaded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Directory unavailable");
    } finally {
      setBusy(false);
    }
  }
  const matches = companies.filter((c) =>
    `${c.name} ${c.tag} ${c.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="company-landing">
      <header className="landing-header">
        <a className="landing-logo" href="/">
          <Plane size={25} /> PILOTS <span>DISPATCH</span>
        </a>
        <a href="/sync">Private Sync · local only</a>
        <a href="https://pilots.nimblebit.com" target="_blank" rel="noreferrer">
          Open Pocket Pilots <ArrowUpRight size={15} />
        </a>
      </header>
      <div className="landing-grid">
        <section className="landing-intro">
          <div className="eyebrow">YOUR COMPANY. A WIDER HORIZON.</div>
          <h1>
            One desk.
            <br />
            Every sky.
          </h1>
          <p>
            Territory intelligence for your Pocket Pilots company. Find your
            footing, follow your fleet, and see what’s on the horizon.
          </p>
          <div className="landing-features">
            <span>
              01 <b>Hold your ground.</b>
              <small>Territory maps & airport defense</small>
            </span>
            <span>
              02 <b>Find your next move.</b>
              <small>Expansion targets & rival radar</small>
            </span>
            <span>
              03 <b>Know before you go.</b>
              <small>Weather, fleet & regional boards</small>
            </span>
          </div>
          <div className="landing-privacy">
            On demand. Read only. Your history stays in your browser, separately
            for each company.
          </div>
        </section>
        <section className="company-picker">
          <div className="eyebrow">OPEN YOUR OPERATIONS DESK</div>
          <h2>Choose your company.</h2>
          <p>Search the game’s public directory by name or tag.</p>
          {error && (
            <div className="notice" role="alert">
              {error}
            </div>
          )}
          <div className="directory-tools">
            <label className="directory-search">
              <Search size={17} />
              <input
                aria-label="Search companies"
                placeholder="Company name or tag"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              className="button refresh"
              disabled={busy}
              onClick={() => void load()}
            >
              <RefreshCw size={15} />
              {busy ? "Loading…" : loaded ? "Reload" : "Load directory"}
            </button>
          </div>
          {loaded ? (
            <>
              <div className="company-results">
                {matches.slice(0, 60).map((co) => (
                  <button key={co.id} onClick={() => onChoose(co)}>
                    <strong>{co.tag}</strong>
                    <span>
                      {co.name}
                      <small>{co.id}</small>
                    </span>
                    <ArrowUpRight size={17} />
                  </button>
                ))}
                {!matches.length && (
                  <p>
                    No match in the returned directory. You can enter a public
                    company ID below.
                  </p>
                )}
              </div>
              <p className="directory-note">
                {matches.length} matches · {companies.length} companies
                returned. The game directory may be incomplete.{" "}
                {matches.length > 60
                  ? "Showing the first 60; narrow your search."
                  : ""}
              </p>
            </>
          ) : (
            <div className="directory-empty">
              <Plane size={34} />
              <p>
                Load the directory when you’re ready.
                <br />
                No game account or password required.
              </p>
            </div>
          )}
          <details className="direct-company">
            <summary>Company missing? Enter a public ID</summary>
            <p>
              Use the company’s public ID, not its join code. These labels are
              saved locally. An unknown ID may return an empty fleet or
              territory.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const parsed = companyIdSchema.safeParse(id.trim());
                if (!parsed.success) {
                  setError(
                    "Use a public company ID with letters, numbers, hyphens or underscores (up to 40 characters).",
                  );
                  return;
                }
                onChoose({
                  id: parsed.data,
                  tag: tag.trim() || parsed.data,
                  name: name.trim() || "Company " + parsed.data,
                });
              }}
            >
              <label>
                Public company ID
                <input
                  required
                  maxLength={40}
                  aria-label="Public company ID"
                  value={id}
                  onChange={(e) => setId(e.target.value)}
                />
              </label>
              <label>
                Tag (optional)
                <input
                  maxLength={40}
                  aria-label="Company tag"
                  value={tag}
                  onChange={(e) => setTag(e.target.value)}
                />
              </label>
              <label>
                Name (optional)
                <input
                  maxLength={160}
                  aria-label="Company name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <button className="button">
                Open company <ArrowUpRight size={15} />
              </button>
            </form>
          </details>
          {current && (
            <button className="button return-company" onClick={onCancel}>
              Return to {current.tag}
            </button>
          )}
        </section>
      </div>
      <footer>
        Independent companion for Pocket Pilots by NimbleBit. Not affiliated
        with or endorsed by NimbleBit.
      </footer>
    </div>
  );
}
