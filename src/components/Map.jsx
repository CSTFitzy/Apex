import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [0, 0];
const DEFAULT_ZOOM = 3;

/**
 * Tactical map component built on Leaflet.
 * Renders tactical locations as markers and can be extended with heatmaps,
 * MIL-STD-2525C symbology, or a Mapbox/Cesium backend as described in
 * VISUALIZATION.md.
 */
export default function Map({ locations = [] }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);

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

  return <div ref={containerRef} className="tactical-map" data-testid="tactical-map" />;
}
