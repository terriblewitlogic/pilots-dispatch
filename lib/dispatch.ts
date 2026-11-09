export type Airport = {
  code: string;
  name: string;
  lat: number;
  lon: number;
  type?: string;
  runways?: number;
  country?: string;
};
export type Company = { name: string; tag: string };
export type Board = {
  code: string;
  list: { id: string; value: number }[];
  cos: Record<string, Company>;
  fetchedAt: number;
  error?: string;
};
export type Flight = {
  pid?: string;
  cs: string;
  type?: string;
  from: Airport;
  to?: Airport;
  t0?: number;
  eta?: number;
  reg?: string;
  tr?: number;
  route?: [number, number][];
};
export type Air = {
  now: number;
  held: Record<string, { co: string; v: number; lat: number; lon: number }>;
  flights: Flight[];
};
export type Change = {
  code: string;
  kind: "gained" | "lost" | "lead" | "score";
  text: string;
  from: number;
  to: number;
  delta?: number;
};
export type Snapshot = {
  companyId: string;
  air: Air;
  airFetchedAt: number;
  boards: Record<string, Board>;
  airports: Airport[];
  generatedAt: number;
  errors: string[];
  previous?: string[];
  changes?: Change[];
  historySaved?: boolean;
  storageError?: string;
  coverage?: { checked: number; total: number };
  refreshMode?: string;
};
export type HistoryRun = {
  id: string;
  at: number;
  status: string;
  changes: Change[];
  held: number;
  checked: number;
  total: number;
};
export type Assessment = Airport & {
  held: boolean;
  lost: boolean;
  verified: boolean;
  score: number;
  leader: number;
  rival: number;
  rivalTag: string;
  gap: number;
  needed: number;
  rank: number | null;
  status: "secure" | "watch" | "urgent" | "lost" | "target" | "unknown";
  board?: Board;
  distance: number;
};
export const EMPTY_SNAPSHOT: Snapshot = {
  companyId: "",
  air: { now: 0, held: {}, flights: [] },
  airFetchedAt: 0,
  boards: {},
  airports: [],
  generatedAt: 0,
  errors: [],
};
export function nm(
  a: Pick<Airport, "lat" | "lon">,
  b: Pick<Airport, "lat" | "lon">,
) {
  const rad = Math.PI / 180,
    dlat = (b.lat - a.lat) * rad,
    dlon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dlon / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function assess(
  data: Snapshot,
  previous: string[] = data.previous ?? [],
  threshold = 20,
): Assessment[] {
  const COMPANY = data.companyId;
  const owned = Object.entries(data.air.held).map(([code, h]) => ({
    code,
    ...h,
  }));
  return data.airports.map((a) => {
    const board = data.boards[a.code],
      verified = !!board && !board.error && board.fetchedAt > 0;
    const rows = board?.list ?? [],
      index = rows.findIndex((r) => r.id === COMPANY),
      score = rows[index]?.value ?? 0,
      leader = rows[0]?.value ?? 0;
    const competitor = rows.find((r) => r.id !== COMPANY),
      rival = competitor?.value ?? 0;
    const held = !!data.air.held[a.code],
      lost = previous.includes(a.code) && !held,
      gap = score - rival;
    const status: Assessment["status"] = lost
      ? "lost"
      : !verified
        ? "unknown"
        : !held
          ? "target"
          : rival > 0 && gap <= Math.max(2000, score * 0.05)
            ? "urgent"
            : rival > 0 && gap <= (score * threshold) / 100
              ? "watch"
              : "secure";
    return {
      ...a,
      held,
      lost,
      verified,
      score,
      leader,
      rival,
      rivalTag: competitor
        ? (board?.cos[competitor.id]?.tag ?? competitor.id)
        : "—",
      gap,
      needed: Math.max(0, Math.max(2000, leader + 1) - score),
      rank: index < 0 ? null : index + 1,
      status,
      board,
      distance: owned.length
        ? Math.min(...owned.map((b) => nm(a, b)))
        : Infinity,
    };
  });
}
export function compareSnapshots(
  before: Snapshot | null,
  after: Snapshot,
): Change[] {
  if (!before?.airFetchedAt || after.air.now < before.air.now) return [];
  if (before.companyId !== after.companyId)
    throw new Error("Cannot compare different companies");
  const COMPANY = after.companyId;
  const changes: Change[] = [];
  for (const code of new Set([
    ...Object.keys(before.air.held),
    ...Object.keys(after.air.held),
  ])) {
    const was = !!before.air.held[code],
      held = !!after.air.held[code];
    if (was !== held)
      changes.push({
        code,
        kind: held ? "gained" : "lost",
        text: held
          ? "Company gained control"
          : "Company no longer holds this airport",
        from: before.airFetchedAt,
        to: after.airFetchedAt,
      });
  }
  for (const [code, next] of Object.entries(after.boards)) {
    const old = before.boards[code];
    if (!old || !old.fetchedAt || next.error || next.fetchedAt <= old.fetchedAt)
      continue;
    const score = (b: Board) =>
      b.list.find((r) => r.id === COMPANY)?.value ?? 0;
    const gap = (b: Board) =>
      score(b) - (b.list.find((r) => r.id !== COMPANY)?.value ?? 0);
    const delta = gap(next) - gap(old);
    if (before.air.held[code] && after.air.held[code] && delta !== 0)
      changes.push({
        code,
        kind: "lead",
        text: `Lead ${delta > 0 ? "increased" : "decreased"} by ${Math.abs(delta).toLocaleString("en-US")} points`,
        delta,
        from: old.fetchedAt,
        to: next.fetchedAt,
      });
    else if (score(next) !== score(old))
      changes.push({
        code,
        kind: "score",
        text: `Company score changed by ${(score(next) - score(old)).toLocaleString("en-US")} points`,
        delta: score(next) - score(old),
        from: old.fetchedAt,
        to: next.fetchedAt,
      });
  }
  return changes;
}

export function mergeObservation(
  old: Snapshot | null,
  next: Snapshot,
): Snapshot {
  if (old && old.companyId !== next.companyId)
    throw new Error("Cannot merge different companies");
  // Older server responses cannot roll back ownership or create false changes.
  if (
    old &&
    (next.air.now < old.air.now ||
      (next.air.now === old.air.now && next.airFetchedAt < old.airFetchedAt))
  )
    throw new Error(
      "The game returned older airspace data. Your newer observation was retained.",
    );
  const boards = { ...next.boards };
  for (const [code, b] of Object.entries(boards))
    if (b.error && old?.boards[code])
      boards[code] = { ...old.boards[code], error: b.error };
  const previous = [
    ...new Set([...(old?.previous ?? []), ...Object.keys(old?.air.held ?? {})]),
  ];
  const all = new Map(
    (old?.airports ?? [])
      .filter((a) => previous.includes(a.code))
      .map((a) => [a.code, a]),
  );
  next.airports.forEach((a) => all.set(a.code, a));
  const result = {
    ...next,
    boards,
    previous,
    airports: [...all.values()],
    historySaved: true,
  };
  return { ...result, changes: compareSnapshots(old, result) };
}
