import { companyIdSchema } from "./company.ts";
import { z } from "zod";
import { operationsSchema, flightSchema } from "./operations.ts";
import type { Backup } from "./local-db";
const airport = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,8}$/),
  name: z.string().max(160),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  country: z.string().optional(),
  runways: z.number().optional(),
});
const change = z.object({
  code: z.string().max(8),
  kind: z.enum(["gained", "lost", "lead", "score"]),
  text: z.string().max(250),
  from: z.number().finite(),
  to: z.number().finite(),
  delta: z.number().finite().optional(),
});
const snapshot = z.object({
  companyId: companyIdSchema,
  air: z.object({
    now: z.number().finite(),
    held: z.record(
      z.object({
        co: z.string(),
        v: z.number().finite(),
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
      }),
    ),
    flights: z.array(flightSchema).max(1000),
  }),
  airFetchedAt: z.number().finite(),
  boards: z.record(
    z.object({
      code: z.string(),
      list: z
        .array(z.object({ id: z.string(), value: z.number().finite() }))
        .max(10000),
      cos: z.record(z.object({ name: z.string(), tag: z.string() })),
      fetchedAt: z.number().finite(),
      error: z.string().optional(),
    }),
  ),
  airports: z.array(airport).max(1000),
  generatedAt: z.number().finite(),
  errors: z.array(z.string()),
  previous: z.array(z.string()).max(1000).optional(),
  changes: z.array(change).optional(),
  historySaved: z.boolean().optional(),
  coverage: z.object({ checked: z.number(), total: z.number() }).optional(),
});
const schema = z.object({
  format: z.literal("pilots-dispatch"),
  version: z.literal(1),
  companyId: companyIdSchema,
  exportedAt: z.number(),
  snapshot: snapshot.nullable(),
  watch: z.array(airport).max(24),
  operations: operationsSchema.optional(),
  runs: z
    .array(
      z.object({
        id: z.string().max(100),
        at: z.number().finite(),
        status: z.string().max(40),
        changes: z.array(change),
        held: z.number(),
        checked: z.number(),
        total: z.number(),
        snapshot,
      }),
    )
    .max(1000),
});
export function parseBackup(raw: unknown): Backup {
  const b = schema.parse(raw);
  if (
    (b.snapshot && b.snapshot.companyId !== b.companyId) ||
    b.runs.some((r) => r.snapshot.companyId !== b.companyId)
  )
    throw new Error("Backup contains mixed companies");
  return b;
}
