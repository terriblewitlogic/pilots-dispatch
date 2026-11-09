"use client";
import { useEffect, useRef, useState } from "react";
export default function TerritoryMap({ airports, selected, onSelect, view }) {
  const node = useRef(null),
    map = useRef(null),
    layer = useRef(null),
    select = useRef(onSelect);
  const [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  select.current = onSelect;
  useEffect(() => {
    let disposed = false;
    let observer;
    const init = () => {
      if (disposed || map.current) return;
      const L = window.L;
      map.current = L.map(node.current, {
        zoomControl: false,
        scrollWheelZoom: false,
      }).setView([20, 0], 2);
      L.control.zoom({ position: "bottomright" }).addTo(map.current);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map.current);
      layer.current = L.layerGroup().addTo(map.current);
      setReady(true);
      observer = new ResizeObserver(() => map.current?.invalidateSize());
      observer.observe(node.current);
    };
    let script = document.querySelector("script[data-leaflet]");
    if (window.L) init();
    else {
      if (!script) {
        script = document.createElement("script");
        script.src = "/vendor/leaflet.js";
        script.dataset.leaflet = "true";
        document.head.append(script);
      }
      script.addEventListener("load", init);
      script.addEventListener("error", () => setFailed(true));
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      script?.removeEventListener("load", init);
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const L = window.L;
    layer.current.clearLayers();
    for (const a of airports) {
      if (view !== "targets" && !a.held && !a.lost) continue;
      if (view === "targets" && (a.held || a.lost)) continue;
      const color =
        a.status === "unknown"
          ? "#8c9191"
          : a.status === "lost" || a.status === "urgent"
            ? "#b8432e"
            : a.status === "watch"
              ? "#bd882c"
              : a.held
                ? "#173d59"
                : "#b88b42";
      const marker = L.circleMarker([a.lat, a.lon], {
        radius: selected === a.code ? 10 : a.held ? 7 : 5,
        color: selected === a.code ? "#102d43" : "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: a.verified || a.lost ? 1 : 0.55,
        dashArray: a.status === "unknown" ? "3 3" : undefined,
      }).addTo(layer.current);
      const label = document.createElement("span");
      label.textContent = a.code;
      marker.bindTooltip(label, {
        direction: "top",
        permanent: selected === a.code,
        className: "airport-label",
      });
      marker.on("click", () => select.current(a.code));
    }
  }, [airports, selected, ready, view]);
  useEffect(() => {
    if (!ready || !selected) return;
    const a = airports.find((a) => a.code === selected);
    if (a)
      map.current.flyTo([a.lat, a.lon], Math.max(map.current.getZoom(), 8), {
        duration: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : 0.7,
      });
  }, [selected, ready]);
  useEffect(() => {
    if (!ready || !airports.length) return;
    map.current.fitBounds(
      airports.map((a) => [a.lat, a.lon]),
      { padding: [35, 35], maxZoom: 8 },
    );
  }, [ready, airports.map((a) => a.code).join(",")]);
  const visible = airports.filter((a) =>
    view === "targets" ? !a.held && !a.lost : a.held || a.lost,
  );
  const fit = (list) => {
    if (list.length)
      map.current?.fitBounds(
        list.map((a) => [a.lat, a.lon]),
        { padding: [35, 35], maxZoom: 8 },
      );
  };
  return (
    <div className="map-wrap">
      <div
        ref={node}
        className="map-canvas"
        aria-label="Interactive map of company territory and expansion targets"
      />
      {failed && (
        <p className="map-error">
          Map unavailable. Airport details remain available below.
        </p>
      )}
      <div className="map-controls">
        <button
          disabled={!airports.some((a) => a.held)}
          onClick={() => fit(airports.filter((a) => a.held))}
        >
          Fit company
        </button>
        <button disabled={!visible.length} onClick={() => fit(visible)}>
          Fit results
        </button>
        {selected && (
          <button
            onClick={() => fit(airports.filter((a) => a.code === selected))}
          >
            Selected airport
          </button>
        )}
      </div>
      <div className="map-legend">
        <span>
          <i className="dot navy" />
          company
        </span>
        <span>
          <i className="dot red" />
          Defense
        </span>
        <span>
          <i className="dot gold" />
          Target
        </span>
        <span>
          <i className="dot gray" />
          Unverified
        </span>
      </div>
    </div>
  );
}
