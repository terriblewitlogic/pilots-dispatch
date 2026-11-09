"use client";
import { useState } from "react";
import type { Airport } from "@/lib/dispatch";
import { z } from "zod";
const airportSchema = z.object({
  code: z.string().regex(/^[A-Z0-9-]{2,8}$/),
  name: z.string(),
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});
export default function LocationEntry({
  onChoose,
}: {
  onChoose: (airport: Airport) => void;
}) {
  const [code, setCode] = useState(""),
    [lat, setLat] = useState(""),
    [lon, setLon] = useState(""),
    [error, setError] = useState("");
  return (
    <details className="location-entry">
      <summary>Use an airport anywhere in the world</summary>
      <p>
        Enter its game airport code and coordinates. Nearby discovery checks the
        game’s airport catalog around this point.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const a = airportSchema.safeParse({
            code: code.trim().toUpperCase(),
            name: code.trim().toUpperCase(),
            lat: lat.trim() ? Number(lat) : NaN,
            lon: lon.trim() ? Number(lon) : NaN,
          });
          if (!a.success) {
            setError(
              "Enter a valid airport code, latitude (−90 to 90) and longitude (−180 to 180).",
            );
            return;
          }
          setError("");
          onChoose(a.data);
        }}
      >
        <label>
          Airport code
          <input
            aria-label="Location airport code"
            required
            maxLength={8}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>
        <label>
          Latitude
          <input
            aria-label="Location latitude"
            required
            type="number"
            step="any"
            min="-90"
            max="90"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
          />
        </label>
        <label>
          Longitude
          <input
            aria-label="Location longitude"
            required
            type="number"
            step="any"
            min="-180"
            max="180"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
          />
        </label>
        <button className="button" type="submit">
          Use airport
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
