"use client";
import { useState, type ComponentProps } from "react";
import AnalyticsDesk from "./analytics-desk";
import PerformanceDashboard from "./performance-dashboard";

export default function AnalyticsWorkspace(
  props: ComponentProps<typeof AnalyticsDesk>,
) {
  const [view, setView] = useState<"company" | "pilot" | "territory">(
    "company",
  );
  return (
    <div className="analytics-workspace">
      <div className="map-tabs performance-tabs" aria-label="Analytics views">
        {(["company", "pilot", "territory"] as const).map((tab) => (
          <button
            key={tab}
            aria-pressed={view === tab}
            className={view === tab ? "selected" : ""}
            onClick={() => setView(tab)}
          >
            {tab === "company"
              ? "Company"
              : tab === "pilot"
                ? "Pilot"
                : "Territory"}
          </button>
        ))}
      </div>
      {view === "territory" ? (
        <AnalyticsDesk {...props} />
      ) : (
        <PerformanceDashboard scope={view} now={props.now} />
      )}
    </div>
  );
}
