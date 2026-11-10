import { z } from "zod";
import { companyIdSchema } from "./company";

const amount = z.number().finite().nonnegative();
export const performanceTotalsSchema = z.object({
  earned: amount.nullable(),
  distanceNm: amount.nullable(),
  hours: amount.nullable(),
  flights: amount.int().nullable(),
  jobs: amount.int().nullable(),
  balance: amount.nullable(),
});
export const performanceSnapshotSchema = z
  .object({
    companyId: companyIdSchema,
    scope: z.enum(["company", "pilot"]),
    subjectId: companyIdSchema,
    label: z.string().trim().min(1).max(160),
    observedAt: z.number().finite().positive(),
    source: z.enum(["manual", "company-sync", "import"]),
    totals: performanceTotalsSchema,
  })
  .superRefine((value, ctx) => {
    if (value.scope === "company" && value.subjectId !== value.companyId)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Company identity does not match",
      });
    if (Object.values(value.totals).every((v) => v === null))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Enter at least one total",
      });
  });
export const performanceHistorySchema = z
  .array(performanceSnapshotSchema)
  .max(1000);
export type PerformanceSnapshot = z.infer<typeof performanceSnapshotSchema>;
export type PerformanceTotals = z.infer<typeof performanceTotalsSchema>;
export type PerformanceMetric = keyof PerformanceTotals;
export const EMPTY_TOTALS: PerformanceTotals = {
  earned: null,
  distanceNm: null,
  hours: null,
  flights: null,
  jobs: null,
  balance: null,
};
export const performanceFields: {
  key: PerformanceMetric;
  label: string;
  unit: string;
  integer?: boolean;
}[] = [
  { key: "earned", label: "Money earned", unit: "game currency" },
  { key: "distanceNm", label: "Distance flown", unit: "nautical miles" },
  { key: "hours", label: "Flight hours", unit: "hours" },
  {
    key: "flights",
    label: "Flight departures",
    unit: "departures",
    integer: true,
  },
  { key: "jobs", label: "Jobs completed", unit: "jobs", integer: true },
  { key: "balance", label: "Balance", unit: "game currency" },
];
const DAY = 86400000;

export function mergePerformanceHistory(
  existing: PerformanceSnapshot[],
  incoming: PerformanceSnapshot[],
  companyId: string,
  now = Date.now(),
) {
  const rows = performanceHistorySchema.parse(incoming);
  if (rows.some((row) => row.companyId !== companyId))
    throw Error("These totals belong to another company.");
  if (rows.some((row) => row.observedAt > now))
    throw Error("Observation times cannot be in the future.");
  if (rows.some((row) => row.observedAt < now - 90 * DAY))
    throw Error("Import observations from the last 90 days.");
  const byKey = new Map<string, PerformanceSnapshot>();
  for (const row of [...existing, ...rows]) {
    if (
      row.companyId !== companyId ||
      row.observedAt < now - 90 * DAY ||
      row.observedAt > now
    )
      continue;
    byKey.set(`${row.scope}:${row.subjectId}:${row.observedAt}`, row);
  }
  return [...byKey.values()]
    .sort((a, b) => b.observedAt - a.observedAt)
    .slice(0, 1000);
}

export function parsePerformanceImport(
  raw: unknown,
  companyId: string,
  now = Date.now(),
): PerformanceSnapshot[] {
  const envelope = z
    .object({
      format: z.literal("pilots-performance"),
      version: z.literal(1),
      observations: performanceHistorySchema.min(1),
    })
    .safeParse(raw);
  if (envelope.success) {
    // Imported values retain no claim of having been retrieved by this app.
    return mergePerformanceHistory(
      [],
      envelope.data.observations.map((row) => ({
        ...row,
        source: "import" as const,
      })),
      companyId,
      now,
    );
  }
  // Read only allowlisted totals from the existing Company Sync export format.
  const sync = z
    .object({
      version: z.literal(1),
      fetchedAt: z.number().finite().positive(),
      company: z.object({
        id: companyIdSchema,
        name: z.string().min(1).max(160),
      }),
      viewer: z.object({ pid: companyIdSchema }),
      stats: z.object({ earned: amount, jobs: amount.int() }).nullable(),
      treasury: amount.nullable(),
    })
    .safeParse(raw);
  if (sync.success) {
    const s = sync.data;
    if (s.stats === null && s.treasury === null)
      throw Error("This company export contains no financial totals.");
    return mergePerformanceHistory(
      [],
      [
        {
          companyId: s.company.id,
          scope: "company",
          subjectId: s.company.id,
          label: s.company.name,
          observedAt: s.fetchedAt,
          source: "company-sync",
          totals: {
            ...EMPTY_TOTALS,
            earned: s.stats?.earned ?? null,
            jobs: s.stats?.jobs ?? null,
            balance: s.treasury,
          },
        },
      ],
      companyId,
      now,
    );
  }
  throw Error(
    "Choose a Company Sync export or a Pilots Dispatch performance export. You can also enter totals from the game using Update totals.",
  );
}

export function performanceReport(
  history: PerformanceSnapshot[],
  companyId: string,
  scope: "company" | "pilot",
  subjectId: string,
  since: number,
  now: number,
) {
  const scoped = history
    .filter(
      (row) =>
        row.companyId === companyId &&
        row.scope === scope &&
        row.subjectId === subjectId &&
        row.observedAt <= now,
    )
    .sort((a, b) => a.observedAt - b.observedAt);
  const latest = scoped.at(-1) ?? null;
  const rows = scoped.filter((row) => row.observedAt >= since);
  const metrics = Object.fromEntries(
    performanceFields.map(({ key }) => {
      const available = rows.filter((row) => row.totals[key] !== null);
      const first = available[0],
        last = available.at(-1);
      const reset =
        key !== "balance" &&
        available.some(
          (row, i) => i > 0 && row.totals[key]! < available[i - 1].totals[key]!,
        );
      return [
        key,
        {
          total: latest?.totals[key] ?? null,
          change:
            available.length >= 2 && !reset
              ? last!.totals[key]! - first.totals[key]!
              : null,
          reset,
          from: first?.observedAt ?? null,
          to: last?.observedAt ?? null,
        },
      ];
    }),
  ) as Record<
    PerformanceMetric,
    {
      total: number | null;
      change: number | null;
      reset: boolean;
      from: number | null;
      to: number | null;
    }
  >;
  function rate(denominator: "flights" | "hours", period: boolean) {
    if (!period) {
      const t = latest?.totals;
      return t?.earned != null && t[denominator] != null && t[denominator]! > 0
        ? t.earned / t[denominator]!
        : null;
    }
    // Compare the exact same observations for both numerator and denominator.
    const paired = rows.filter(
      (row) => row.totals.earned !== null && row.totals[denominator] !== null,
    );
    if (paired.length < 2) return null;
    if (metrics.earned.reset || metrics[denominator].reset) return null;
    const a = paired[0].totals,
      b = paired.at(-1)!.totals;
    const difference = b[denominator]! - a[denominator]!;
    return difference > 0 ? (b.earned! - a.earned!) / difference : null;
  }
  return {
    latest,
    rows,
    metrics,
    perFlight: rate("flights", false),
    perHour: rate("hours", false),
    periodPerFlight: rate("flights", true),
    periodPerHour: rate("hours", true),
  };
}

export function performanceCsv(rows: PerformanceSnapshot[]) {
  // Exclude arbitrary names/IDs: only timestamps, enums, and numeric cells.
  return [
    "observed_at_utc,scope,source,money_earned,distance_nm,flight_hours,departures,jobs_completed,balance",
    ...rows.map((row) =>
      [
        new Date(row.observedAt).toISOString(),
        row.scope,
        row.source,
        ...performanceFields.map(({ key }) => row.totals[key] ?? ""),
      ].join(","),
    ),
  ].join("\r\n");
}
