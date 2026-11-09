import { z } from "zod";
import { companyIdSchema } from "./company.ts";
import { nm, type Airport } from "./dispatch.ts";
const location = {
  code: z.string().regex(/^[A-Z0-9-]{2,8}$/),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
};
export const baseSchema = z.object({ ...location, co: companyIdSchema });
export const projectSchema = z.object({
  ...location,
  name: z.string().max(200),
  kind: z.string().max(80),
  need: z.number().finite().positive(),
  have: z.number().finite().nonnegative(),
  co: companyIdSchema,
  t: z.number().finite().optional(),
});
const worldBasesSchema = z.object({
  now: z.number().finite(),
  bases: z.array(baseSchema).max(10000),
  projects: z.array(projectSchema).max(1000),
  cos: z.record(
    z.object({ name: z.string().max(200), tag: z.string().max(40) }),
  ),
});
export const baseBriefingSchema = worldBasesSchema.extend({
  fetchedAt: z.number().finite(),
});
export type BaseBriefing = z.infer<typeof baseBriefingSchema>;
export function normalizeBases(raw: unknown, fetchedAt: number): BaseBriefing {
  const data = worldBasesSchema.parse(raw);
  return {
    ...data,
    bases: [
      ...new Map(data.bases.map((b) => [`${b.code}:${b.co}`, b])).values(),
    ],
    fetchedAt,
  };
}
export function projectProgress(
  p: Pick<z.infer<typeof projectSchema>, "have" | "need">,
) {
  return {
    percent: Math.min(100, Math.max(0, (p.have / p.need) * 100)),
    remaining: Math.max(0, p.need - p.have),
  };
}
export function nearestHolding(
  base: Pick<Airport, "lat" | "lon">,
  holdings: Pick<Airport, "code" | "lat" | "lon">[],
) {
  return (
    holdings
      .map((a) => ({ code: a.code, distance: nm(base, a) }))
      .sort((a, b) => a.distance - b.distance)[0] ?? null
  );
}
