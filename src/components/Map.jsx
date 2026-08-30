import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.heat';
import 'leaflet-draw';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import ms from 'milsymbol';
import { sidcForUnit } from './UnitSymbols.jsx';

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
export default function Map({
  locations = [],
  heatmap = null,
  onSelect,
  aoo = null,
  aooRadiusKm = 5,
  units = [],
  markups = [],
  layers = [],
  activeTool = 'select',
  activeLayerId = 'terrain',
  markupStyle = { color: '#f2cc60', weight: 3 },
  selectedUnitId,
  onUnitPlace,
  onSelectUnit,
  onMoveUnit,
  onCreateMarkup,
  onDraftChange,
  finishDrawingSignal = 0,
  coaOverlays = [],
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const unitMarkersRef = useRef([]);
  const markupLayersRef = useRef([]);
  const heatLayerRef = useRef(null);
  const aooLayerRef = useRef(null);
  const coaLayersRef = useRef([]);
  const onSelectRef = useRef(onSelect);
  const tacticalHandlersRef = useRef({ activeTool, activeLayerId, markupStyle, onUnitPlace, onCreateMarkup });
  const draftRef = useRef([]);

  // Keep the latest click handler without re-initializing the map.
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    tacticalHandlersRef.current = { activeTool, activeLayerId, markupStyle, onUnitPlace, onCreateMarkup };
  }, [activeTool, activeLayerId, markupStyle, onUnitPlace, onCreateMarkup]);

  // Initialize the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    mapRef.current = L.map(containerRef.current).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current);

    mapRef.current.on('click', (event) => {
      const { activeTool, activeLayerId, markupStyle, onUnitPlace, onCreateMarkup } = tacticalHandlersRef.current;
      const point = { latitude: event.latlng.lat, longitude: event.latlng.lng };

      if (activeTool === 'unit') {
        onUnitPlace?.(point);
        return;
      }

      if (activeTool === 'point' || activeTool === 'text') {
        const label = activeTool === 'text' ? window.prompt('Label text') || 'Annotation' : 'Waypoint';
        onCreateMarkup?.({
          type: activeTool,
          layerId: activeLayerId,
          label,
          style: markupStyle,
          geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
        });
        return;
      }

      if (activeTool === 'circle') {
        onCreateMarkup?.({
          type: 'circle',
          layerId: activeLayerId,
          label: 'Range ring',
          style: markupStyle,
          radiusMeters: 1000,
          geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] },
        });
        return;
      }

      if (activeTool === 'line' || activeTool === 'polygon' || activeTool === 'sketch') {
        draftRef.current = [...draftRef.current, point];
        onDraftChange?.(draftRef.current.length);
        return;
      }

      onSelectRef.current?.(point);
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    map.finishActiveDrawing = () => {
      const { activeTool, activeLayerId, markupStyle, onCreateMarkup } = tacticalHandlersRef.current;
      const points = draftRef.current;
      const minPoints = activeTool === 'polygon' ? 3 : 2;
      if (!['line', 'polygon', 'sketch'].includes(activeTool) || points.length < minPoints) return false;
      const coordinates = points.map((point) => [point.longitude, point.latitude]);
      onCreateMarkup?.({
        type: activeTool,
        layerId: activeLayerId,
        label: activeTool === 'polygon' ? 'Boundary' : activeTool === 'sketch' ? 'Sketch' : 'Phase line',
        style: markupStyle,
        geometry:
          activeTool === 'polygon'
            ? { type: 'Polygon', coordinates: [[...coordinates, coordinates[0]]] }
            : { type: 'LineString', coordinates },
      });
      draftRef.current = [];
      onDraftChange?.(0);
      return true;
    };
  }, [onCreateMarkup, onDraftChange]);

  useEffect(() => {
    if (finishDrawingSignal > 0) {
      mapRef.current?.finishActiveDrawing?.();
    }
  }, [finishDrawingSignal]);

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

  useEffect(() => {
    if (!mapRef.current) return;

    unitMarkersRef.current.forEach((marker) => marker.remove());
    unitMarkersRef.current = units.map((unit) => {
      let html = `<span class="unit-symbol-fallback unit-${unit.affiliation}">${String(unit.type || 'unit')
        .slice(0, 3)
        .toUpperCase()}</span>`;
      try {
        html = new ms.Symbol(sidcForUnit(unit.type, unit.affiliation), {
          size: unit.hierarchy === 'platoon' ? 42 : unit.hierarchy === 'individual' ? 26 : 34,
        }).asSVG();
      } catch {
        // Use the fallback marker HTML above.
      }

      const marker = L.marker([unit.position.latitude, unit.position.longitude], {
        draggable: true,
        icon: L.divIcon({
          className: `unit-map-icon ${selectedUnitId === unit.id ? 'unit-selected' : ''}`,
          html,
          iconSize: [46, 46],
          iconAnchor: [23, 23],
        }),
      }).addTo(mapRef.current);
      const popup = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = unit.name;
      const details = document.createElement('div');
      details.textContent = `${unit.affiliation} ${unit.hierarchy} · ${unit.readiness}`;
      popup.append(title, details);
      marker.bindPopup(popup);
      marker.on('click', (event) => {
        L.DomEvent.stopPropagation(event);
        onSelectUnit?.(unit.id);
      });
      marker.on('dblclick', (event) => {
        L.DomEvent.stopPropagation(event);
        onSelectUnit?.(unit.id);
        marker.openPopup();
      });
      marker.on('dragend', () => {
        const latlng = marker.getLatLng();
        onMoveUnit?.(unit.id, { latitude: latlng.lat, longitude: latlng.lng });
      });
      return marker;
    });
  }, [onMoveUnit, onSelectUnit, selectedUnitId, units]);

  useEffect(() => {
    if (!mapRef.current) return;
    const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id));

    markupLayersRef.current.forEach((layer) => layer.remove());
    markupLayersRef.current = markups
      .filter((markup) => visibleLayerIds.has(markup.layerId))
      .map((markup) => {
        const style = {
          color: markup.style?.color || '#f2cc60',
          weight: markup.style?.weight || 3,
          dashArray: markup.style?.dashArray,
        };
        const geometry = markup.geometry || {};
        let layer = null;

        if (markup.type === 'circle' && geometry.type === 'Point') {
          layer = L.circle([geometry.coordinates[1], geometry.coordinates[0]], {
            ...style,
            radius: markup.radiusMeters || 1000,
            fillOpacity: 0.08,
          });
        } else if (geometry.type === 'Point') {
          const latLng = [geometry.coordinates[1], geometry.coordinates[0]];
          layer =
            markup.type === 'text'
              ? L.marker(latLng, {
                  icon: L.divIcon({
                    className: 'markup-text-label',
                    html: `<span>${String(markup.label || 'Annotation').replace(/[<>&"]/g, '')}</span>`,
                  }),
                })
              : L.circleMarker(latLng, { ...style, radius: 6, fillOpacity: 0.8 });
        } else if (geometry.type === 'LineString') {
          layer = L.polyline(
            geometry.coordinates.map(([lng, lat]) => [lat, lng]),
            style
          );
        } else if (geometry.type === 'Polygon') {
          layer = L.polygon(
            geometry.coordinates[0].map(([lng, lat]) => [lat, lng]),
            { ...style, fillOpacity: 0.12 }
          );
        }

        if (layer) {
          layer.addTo(mapRef.current);
          if (markup.label) layer.bindTooltip(markup.label);
        }
        return layer;
      })
      .filter(Boolean);
  }, [layers, markups]);

  useEffect(() => {
    if (!mapRef.current) return;

    coaLayersRef.current.forEach((layer) => layer.remove());
    coaLayersRef.current = coaOverlays
      .filter((coa) => coa.visible !== false)
      .flatMap((coa) => {
        const color = coa.visualization?.color || '#f85149';
        const layersToAdd = [];

        (coa.visualization?.paths || []).forEach((path) => {
          const points = (path.points || [])
            .filter((point) => Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude)))
            .map((point) => [point.latitude, point.longitude]);
          if (points.length > 1) {
            const line = L.polyline(points, { color: path.color || color, weight: 4, dashArray: '8 6' }).addTo(mapRef.current);
            line.bindTooltip(`${coa.name || coa.title}: ${path.unitName || 'enemy movement'}`);
            layersToAdd.push(line);
          }
        });

        (coa.visualization?.phaseLines || []).forEach((phaseLine) => {
          const points = (phaseLine.points || [])
            .filter((point) => Number.isFinite(Number(point?.latitude)) && Number.isFinite(Number(point?.longitude)))
            .map((point) => [point.latitude, point.longitude]);
          if (points.length > 1) {
            const line = L.polyline(points, { color, weight: 2, opacity: 0.8 }).addTo(mapRef.current);
            line.bindTooltip(phaseLine.label || 'Phase line');
            layersToAdd.push(line);
          }
        });

        (coa.visualization?.objectives || []).forEach((objective) => {
          const position = objective.position;
          if (Number.isFinite(Number(position?.latitude)) && Number.isFinite(Number(position?.longitude))) {
            const marker = L.circleMarker([position.latitude, position.longitude], {
              radius: 8,
              color,
              fillColor: color,
              fillOpacity: 0.75,
            }).addTo(mapRef.current);
            marker.bindTooltip(objective.label || 'Objective');
            layersToAdd.push(marker);
          }
        });

        return layersToAdd;
      });
  }, [coaOverlays]);

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
