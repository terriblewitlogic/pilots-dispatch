"use client";
import { useEffect, useRef, useState } from "react";
/** @param {{pins?: {lat:number,lon:number,label:string,color:string}[], points?: [number,number][], from?: import('../lib/dispatch').Airport, to?: import('../lib/dispatch').Airport, regions?: {box:[number,number,number,number],name:string,next?:boolean}[], fitKey?:string,pathLabel?:string}} props */
export default function OperationsMap({
  points = [],
  from,
  to,
  regions = [],
  fitKey = "",
  pathLabel = "Route overview",
  pins = [],
}) {
  const node = useRef(null),
    map = useRef(null),
    layers = useRef(null),
    [ready, setReady] = useState(false),
    [failed, setFailed] = useState(false);
  const fit = useRef(() => {});
  useEffect(() => {
    let disposed = false,
      observer;
    const init = () => {
      if (disposed || map.current) return;
      const L = window.L;
      map.current = L.map(node.current, { scrollWheelZoom: false }).setView(
        [30, -98],
        5,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18,
      }).addTo(map.current);
      layers.current = L.layerGroup().addTo(map.current);
      observer = new ResizeObserver(() => map.current?.invalidateSize());
      observer.observe(node.current);
      setReady(true);
    };
    const fail = () => setFailed(true);
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
      script.addEventListener("error", fail);
    }
    return () => {
      disposed = true;
      observer?.disconnect();
      script?.removeEventListener("load", init);
      script?.removeEventListener("error", fail);
      map.current?.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const L = window.L;
    layers.current.clearLayers();
    const bounds = [];
    const label = (text) => {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    };
    for (const p of pins) {
      L.circleMarker([p.lat, p.lon], {
        radius: 6,
        color: "#fff",
        weight: 2,
        fillColor: p.color,
        fillOpacity: 0.9,
      })
        .bindTooltip(label(p.label))
        .addTo(layers.current);
      bounds.push([p.lat, p.lon]);
    }
    if (points.length) {
      L.polyline(points, { color: "#af4531", weight: 3, opacity: 0.85 })
        .bindTooltip(label(pathLabel))
        .addTo(layers.current);
      bounds.push(...points);
    }
    for (const [a, color, title] of [
      [from, "#173d59", "Departure"],
      [to, "#af4531", "Destination"],
    ])
      if (a) {
        let lon = a.lon;
        if (points.length)
          lon +=
            360 *
            Math.round(
              (points[title === "Departure" ? 0 : points.length - 1][1] - lon) /
                360,
            );
        const p = [a.lat, lon];
        L.circleMarker(p, {
          radius: 7,
          color: "#fff",
          weight: 2,
          fillColor: color,
          fillOpacity: 1,
        })
          .bindTooltip(label(`${title} · ${a.code}`))
          .addTo(layers.current);
        bounds.push(p);
      }
    for (const r of regions) {
      const [south, west, north, east] = r.box;
      const corners = [
        [south, west],
        [north, east < west ? east + 360 : east],
      ];
      L.rectangle(corners, {
        color: r.next ? "#b48c4e" : "#af4531",
        weight: 2,
        fillOpacity: 0.12,
      })
        .bindTooltip(label(r.name))
        .addTo(layers.current);
      bounds.push(...corners);
    }
    fit.current = () => {
      if (bounds.length)
        map.current?.fitBounds(bounds, { padding: [35, 35], maxZoom: 10 });
    };
    fit.current();
  }, [ready, fitKey]);
  return (
    <div className="operations-map">
      <div
        className="map-canvas"
        ref={node}
        aria-label={
          regions.length
            ? "Event operating regions"
            : pins.length
              ? "Airport and station map"
              : "Selected flight route"
        }
      />
      <button className="map-reset" onClick={() => fit.current()}>
        Fit {regions.length ? "regions" : pins.length ? "area" : "route"}
      </button>
      {failed && (
        <p className="map-error">
          Map tiles unavailable. The details remain available below.
        </p>
      )}
      <div className="route-map-label">
        {regions.length ? "Game event region" : pathLabel}
      </div>
    </div>
  );
}
