"use client";
import { useMemo, useState } from "react";
import { ArrowUpRight, Flag } from "lucide-react";
import type { Assessment, Snapshot } from "@/lib/dispatch";
import type { LocalRun } from "@/lib/local-db";
import { recentlyLostAirports } from "@/lib/defense";

const stamp = (time: number) =>
  new Date(time).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export default function RecentlyLostAirports({
  snapshot,
  runs,
  airports,
  now,
  onSelect,
}: {
  snapshot: Snapshot;
  runs: LocalRun[];
  airports: Assessment[];
  now: number;
  onSelect: (code: string) => void;
}) {
  const [days, setDays] = useState(7);
  const losses = useMemo(
    () => recentlyLostAirports(snapshot, runs, now - days * 86400000, now),
    [snapshot, runs, days, now],
  );
  return (
    <section
      className="activity-card recent-losses"
      aria-labelledby="recent-losses-heading"
    >
      <div className="card-heading">
        <div>
          <h2 id="recent-losses-heading">Recently lost airports</h2>
          <p>
            Latest loss per airport, based on observed history in this browser.
          </p>
        </div>
        <span className="count">{losses.length}</span>
      </div>
      <div className="table-toolbar">
        <label>
          Report period
          <select
            aria-label="Lost airports report period"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
          </select>
        </label>
      </div>
      {losses.length ? (
        <div className="ops-table-scroll">
          <table>
            <thead>
              <tr>
                <th>AIRPORT</th>
                <th>LOSS OBSERVED</th>
                <th>STATUS AT LAST CHECK</th>
                <th>POINTS TO RETAKE</th>
                <th>DETAILS</th>
              </tr>
            </thead>
            <tbody>
              {losses.map((loss) => {
                const airport = airports.find((a) => a.code === loss.code);
                return (
                  <tr key={loss.code}>
                    <td>
                      <strong>{loss.code}</strong>
                      <small>{loss.name}</small>
                    </td>
                    <td>
                      <strong>{stamp(loss.to)}</strong>
                      <small>Last held check: {stamp(loss.from)}</small>
                    </td>
                    <td>
                      <span
                        className={`badge ${loss.regained ? "secure" : "lost"}`}
                      >
                        {loss.regained ? "Regained" : "Still lost"}
                      </span>
                    </td>
                    <td>
                      {loss.regained
                        ? "—"
                        : airport?.verified
                          ? airport.needed.toLocaleString("en-US")
                          : "Unverified"}
                    </td>
                    <td>
                      {airport && (
                        <button
                          className="row-open"
                          aria-label={`Inspect lost airport ${loss.code}`}
                          onClick={() => onSelect(loss.code)}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <Flag size={26} />
          <h3>
            {snapshot.airFetchedAt
              ? "No losses recorded in this period."
              : "No territory history yet."}
          </h3>
          <p>
            {snapshot.airFetchedAt
              ? "Only changes between checks can establish a loss. Try a longer period or refresh to check for changes."
              : "Refresh data to establish a baseline. Later checks will record airports your company loses."}
          </p>
        </div>
      )}
      <p className="ops-footnote">
        Losses occurred between the last held check and the first check showing
        the airport lost; the exact time is unknown.
        {snapshot.airFetchedAt > 0 &&
          ` Current status checked ${stamp(snapshot.airFetchedAt)}.`}{" "}
        Points to retake are estimates from the latest verified standings.
      </p>
    </section>
  );
}
