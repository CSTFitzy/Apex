import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

const DEFAULT_CENTER = [0, 0];
const DEFAULT_ZOOM = 3;

/**
 * Tactical map component built on Leaflet.
 * Renders tactical locations as markers, live simulated units, and an
 * optional tactical heatmap layer (see VISUALIZATION.md / AnalyticsDashboard).
 */
export default function Map({ locations = [], units = [], heatmapPoints = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const unitMarkersRef = useRef([]);
  const heatLayerRef = useRef(null);

  // Initialize the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    mapRef.current = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current);

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers whenever the locations list changes.
  useEffect(() => {
    if (!mapRef.current) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = locations.map((location) => {
      const marker = L.marker([location.latitude, location.longitude]).addTo(mapRef.current);
      marker.bindPopup(`<strong>${location.name}</strong><br/>${location.description || ''}`);
      return marker;
    });
  }, [locations]);

  // Sync live simulated unit markers.
  useEffect(() => {
    if (!mapRef.current) return;

    unitMarkersRef.current.forEach((marker) => marker.remove());
    unitMarkersRef.current = units.map((unit) => {
      const color = unit.side === 'friendly' ? '#2f81f7' : '#f85149';
      const marker = L.circleMarker([unit.latitude, unit.longitude], {
        radius: 5,
        color,
        fillColor: color,
        fillOpacity: unit.status === 'destroyed' ? 0.2 : 0.9,
      }).addTo(mapRef.current);
      marker.bindPopup(`<strong>${unit.callsign}</strong><br/>${unit.type} — ${unit.status} (${unit.health}%)`);
      return marker;
    });
  }, [units]);

  // Sync the active tactical heatmap layer.
  useEffect(() => {
    if (!mapRef.current) return;

    if (heatLayerRef.current) {
      heatLayerRef.current.remove();
      heatLayerRef.current = null;
    }

    if (heatmapPoints && heatmapPoints.length > 0) {
      heatLayerRef.current = L.heatLayer(heatmapPoints, { radius: 30, blur: 20, maxZoom: 12 }).addTo(
        mapRef.current
      );
    }
  }, [heatmapPoints]);

  return <div ref={containerRef} className="tactical-map" data-testid="tactical-map" />;
}

