import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet/dist/leaflet.css';

const DEFAULT_CENTER = [0, 0];
const DEFAULT_ZOOM = 3;

/**
 * Tactical map component built on Leaflet.
 * Renders tactical locations as markers, can render a color-coded tactical
 * heatmap overlay (casualties, enemy contact, risk, etc - see
 * server/analytics/engine.js) computed from the active simulation, and lets
 * the user click anywhere on Earth to pick an area of operations (AOO).
 *
 * @param {object} props
 * @param {Array} [props.locations] - Tactical locations to render as markers.
 * @param {object} [props.heatmap] - Analytics heatmap overlay.
 * @param {function} [props.onSelect] - Called with { latitude, longitude } on map click.
 * @param {object} [props.aoo] - Currently selected AOO ({ latitude, longitude }).
 * @param {number} [props.aooRadiusKm] - Radius of the AOO boundary circle, in km.
 */
export default function Map({ locations = [], heatmap = null, onSelect, aoo = null, aooRadiusKm = 5 }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const heatLayerRef = useRef(null);
  const aooLayerRef = useRef(null);
  const onSelectRef = useRef(onSelect);

  // Keep the latest click handler without re-initializing the map.
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Initialize the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    mapRef.current = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current);

    // Click anywhere on Earth to pick the area of operations.
    mapRef.current.on('click', (event) => {
      onSelectRef.current?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Draw the selected area of operations (centre marker + boundary circle).
  useEffect(() => {
    if (!mapRef.current) return;

    if (aooLayerRef.current) {
      aooLayerRef.current.remove();
      aooLayerRef.current = null;
    }

    if (aoo && Number.isFinite(aoo.latitude) && Number.isFinite(aoo.longitude)) {
      const center = [aoo.latitude, aoo.longitude];
      aooLayerRef.current = L.layerGroup([
        L.circleMarker(center, { radius: 5, color: '#2f81f7', fillOpacity: 1 }),
        L.circle(center, {
          radius: Math.max(aooRadiusKm, 0) * 1000,
          color: '#2f81f7',
          weight: 2,
          dashArray: '6 6',
          fillOpacity: 0.08,
        }),
      ]).addTo(mapRef.current);
    }
  }, [aoo, aooRadiusKm]);

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
