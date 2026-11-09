import { z } from "zod";
// Public IDs are opaque identifiers, never URLs or API path fragments.
export const companyIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
export const companySchema = z.object({
  id: companyIdSchema,
  name: z.string().min(1).max(160),
  tag: z.string().min(1).max(40),
});
export type SelectedCompany = z.infer<typeof companySchema>;
export function parseDirectory(raw: unknown) {
  const world = z
    .object({ cos: z.record(z.object({ name: z.string(), tag: z.string() })) })
    .parse(raw);
  return Object.entries(world.cos)
    .flatMap(([id, co]) => {
      const parsed = companySchema.safeParse({ id, ...co });
      return parsed.success ? [parsed.data] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
