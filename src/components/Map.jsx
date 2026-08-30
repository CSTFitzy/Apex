import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [0, 0];
const DEFAULT_ZOOM = 3;

/**
 * Tactical map component built on Leaflet.
 * Renders tactical locations as markers, and can render a color-coded
 * tactical heatmap overlay (casualties, enemy contact, risk, etc - see
 * server/analytics/engine.js) computed from the active simulation.
 */
export default function Map({ locations = [], heatmap = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
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

  // Render/update the active tactical heatmap overlay, if any.
  useEffect(() => {
    if (!mapRef.current) return;

    if (heatLayerRef.current) {
      heatLayerRef.current.remove();
      heatLayerRef.current = null;
    }

    if (heatmap?.cells?.length) {
      const points = heatmap.cells.map((cell) => [cell.lat, cell.lng, cell.intensity]);
      heatLayerRef.current = L.heatLayer(points, { radius: 30, blur: 20, max: heatmap.cells[0].intensity || 1 });
      heatLayerRef.current.addTo(mapRef.current);
    }
  }, [heatmap]);

  return <div ref={containerRef} className="tactical-map" data-testid="tactical-map" />;
}
