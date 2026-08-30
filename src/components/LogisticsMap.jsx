import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [0, 0];
const DEFAULT_ZOOM = 3;

/** Marker/route colours per supply status. */
const STATUS_COLORS = {
  critical: '#f85149',
  low: '#d29922',
  adequate: '#2f81f7',
  full: '#3fb950',
};

/** Route colours by resupply priority. */
const PRIORITY_COLORS = {
  immediate: '#f85149',
  urgent: '#d29922',
  routine: '#3fb950',
};

/**
 * Logistics map: plots supply depots, planned resupply routes and unit supply
 * status overlays on a Leaflet map. Rendered alongside the tactical map so
 * logistics can be assessed without leaving the dashboard.
 */
export default function LogisticsMap({ depots = [], units = [], routes = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;

    mapRef.current = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current);
    layerRef.current = L.layerGroup().addTo(mapRef.current);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    const bounds = [];

    for (const depot of depots) {
      if (depot.latitude === null || depot.longitude === null) continue;
      const position = [Number(depot.latitude), Number(depot.longitude)];
      bounds.push(position);
      const stock = Object.entries(depot.stock || {})
        .map(([type, quantity]) => `${type}: ${quantity}`)
        .join('<br/>');
      L.circleMarker(position, {
        radius: 9,
        color: '#8b949e',
        fillColor: '#161b22',
        fillOpacity: 0.9,
        weight: 3,
      })
        .bindPopup(`<strong>${depot.name}</strong><br/>${depot.status}<br/>${stock}`)
        .addTo(layer);
    }

    for (const unit of units) {
      if (unit.latitude === null || unit.longitude === null) continue;
      const position = [Number(unit.latitude), Number(unit.longitude)];
      bounds.push(position);
      const color = STATUS_COLORS[unit.status] || STATUS_COLORS.full;
      const detail = (unit.supplies || [])
        .map((supply) => `${supply.supplyType}: ${supply.percentRemaining}%`)
        .join('<br/>');
      L.circleMarker(position, {
        radius: 7,
        color,
        fillColor: color,
        fillOpacity: 0.7,
        weight: 2,
      })
        .bindPopup(`<strong>${unit.name}</strong><br/>${unit.status}<br/>${detail}`)
        .addTo(layer);
    }

    for (const plan of routes) {
      const waypoints = plan.route?.waypoints || [];
      if (waypoints.length < 2) continue;
      const latlngs = waypoints.map((point) => [Number(point.latitude), Number(point.longitude)]);
      latlngs.forEach((position) => bounds.push(position));
      L.polyline(latlngs, {
        color: PRIORITY_COLORS[plan.priority] || '#2f81f7',
        weight: 3,
        opacity: 0.8,
        dashArray: plan.arrivesBeforeDepletion ? null : '6 6',
      })
        .bindPopup(
          `<strong>${plan.depot?.name || 'Depot'} → ${plan.unitName}</strong><br/>` +
            `${plan.route.distanceKm} km · ${plan.route.travelHours ?? '—'} h · ` +
            `risk ${plan.route.risk}`
        )
        .addTo(layer);
    }

    if (bounds.length > 0) {
      map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 12 });
    }
  }, [depots, units, routes]);

  return (
    <div className="logistics-map-wrapper">
      <div ref={containerRef} className="logistics-map" data-testid="logistics-map" />
      <ul className="logistics-legend">
        {Object.entries(STATUS_COLORS).map(([status, color]) => (
          <li key={status}>
            <span className="logistics-legend-swatch" style={{ background: color }} />
            {status}
          </li>
        ))}
      </ul>
    </div>
  );
}
