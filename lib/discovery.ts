import type { Airport, Snapshot } from "./dispatch";
import type { Fleet } from "./operations";

export function discoveryReferences(
  snapshot: Snapshot,
  fleet: Fleet | undefined,
  held: Airport[],
  watch: Airport[],
) {
  const flights =
    fleet && fleet.fetchedAt >= snapshot.airFetchedAt
      ? fleet.flights
      : snapshot.air.flights;
  const seen = new Set<string>();
  return [
    {
      label: "Current flight destinations",
      airports: flights.flatMap((f) => (f.to ? [f.to] : [])),
    },
    {
      label: "Parked plane locations",
      airports: flights.filter((f) => !f.to).map((f) => f.from),
    },
    { label: "Held airports", airports: held },
    { label: "Watched airports", airports: watch },
    {
      label: "Flight departure airports",
      airports: flights.filter((f) => f.to).map((f) => f.from),
    },
  ]
    .map((group) => ({
      ...group,
      airports: group.airports
        .filter((a) => {
          if (seen.has(a.code)) return false;
          seen.add(a.code);
          return true;
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
    }))
    .filter((group) => group.airports.length);
}

export function discoveryCenter(airports: Airport[], selected: string) {
  return airports.find((a) => a.code === selected) ?? airports[0];
}
