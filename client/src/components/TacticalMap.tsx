import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Circle,
  CircleMarker,
  LayersControl,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import ms from 'milsymbol';
import type {
  AreaOfOperations,
  DrawMode,
  HeatmapCell,
  LatLon,
  LosObserver,
  SpotHeight,
  TacticalUnit,
  UnitPrediction,
  ViewshedResult,
} from '../types';
import {
  buildAO,
  circleVertices,
  formatDistance,
  haversineDistance,
  rectangleVertices,
  viewshedWedges,
} from '../utils/geometry';

// Fix default marker icon paths (Vite bundling breaks Leaflet's default asset resolution)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const AO_COLOR = '#3b82f6';
const VISIBLE_COLOR = '#00ff88';
const BLOCKED_COLOR = '#ff4444';
const PREDICTION_COLOR = '#9b59b6';
const COMMS_COLOR = '#00d1ff';
/** Minimum interval (ms) between live radius updates while dragging a LOS circle. */
const DRAG_THROTTLE_MS = 80;

interface Props {
  center: LatLon;
  ao: AreaOfOperations | null;
  drawMode: DrawMode;
  onAOChange: (ao: AreaOfOperations | null) => void;
  onDrawModeChange: (mode: DrawMode) => void;
  observers: LosObserver[];
  onLosDraft: (position: LatLon, radiusM: number) => void;
  onLosCommit: (position: LatLon, radiusM: number) => void;
  spotHeights: SpotHeight[];
  losPoints: LatLon[];
  onMapClick: (point: LatLon) => void;
  units: TacticalUnit[];
  viewshed: ViewshedResult | null;
  /** AI-forecast future positions for hostile units, rendered as confidence halos. */
  predictions?: UnitPrediction[];
  /** Active tactical heatmap grid cells (casualty/contact/risk/etc.), rendered as a color overlay. */
  heatmapCells?: HeatmapCell[];
  /** Stations currently transmitting on a radio net, with their signal coverage. */
  transmitters?: CommsTransmitter[];
}

/** A station transmitting on a radio net, rendered as a coverage circle on the map. */
export interface CommsTransmitter {
  unitId: string;
  callsign: string;
  position: LatLon;
  /** Estimated usable radio coverage radius in metres. */
  coverageM: number;
  color: string;
  channelName: string;
}

function unitIcon(unit: TacticalUnit): L.DivIcon {
  const symbol = new ms.Symbol(unit.sidc, {
    size: 28,
    fill: true,
    infoFields: false,
  });
  return L.divIcon({
    html: symbol.asSVG(),
    className: 'nato-symbol-icon',
    iconSize: [symbol.getSize().width, symbol.getSize().height],
    iconAnchor: [symbol.getAnchor().x, symbol.getAnchor().y],
  });
}

const toLatLon = (latlng: L.LatLng): LatLon => ({ lat: latlng.lat, lon: latlng.lng });

/** Maps a 0-255 heatmap intensity to a blue (low) -> red (high) color, matching the legend used in the Analytics panel. */
function heatmapColor(intensity: number): string {
  const pct = Math.max(0, Math.min(255, intensity)) / 255;
  const hue = (1 - pct) * 220; // 220 (blue) -> 0 (red)
  return `hsl(${hue}, 90%, 50%)`;
}

/** Green/red visibility disc rendered from a ray-cast viewshed. */
function ViewshedOverlay({ viewshed }: { viewshed: ViewshedResult }) {
  const wedges = viewshedWedges(viewshed);
  return (
    <>
      {wedges.map((wedge, idx) => (
        <Polygon
          key={`wedge-${idx}`}
          positions={wedge.positions}
          pathOptions={{
            color: wedge.visible ? VISIBLE_COLOR : BLOCKED_COLOR,
            fillColor: wedge.visible ? VISIBLE_COLOR : BLOCKED_COLOR,
            fillOpacity: wedge.visible ? 0.35 : 0.3,
            weight: 0,
            interactive: false,
          }}
        />
      ))}
      <Circle
        center={[viewshed.origin.lat, viewshed.origin.lon]}
        radius={viewshed.radius}
        pathOptions={{ color: '#ffffff', weight: 1, fill: false, opacity: 0.6, interactive: false }}
      />
    </>
  );
}

/**
 * Mouse/keyboard handling for the drawing tools. Rectangle and circle AOs (and
 * the line-of-sight circle) are drawn by dragging, polygons by clicking each
 * vertex and finishing with a double-click or the Enter key. Map dragging is
 * suspended only while a drag-based tool is active, so normal pan/zoom keeps
 * working in every other mode.
 */
function DrawInteractions({
  mode,
  onAOComplete,
  onLosDraft,
  onLosCommit,
  onMapClick,
}: {
  mode: DrawMode;
  onAOComplete: (ao: AreaOfOperations) => void;
  onLosDraft: (position: LatLon, radiusM: number) => void;
  onLosCommit: (position: LatLon, radiusM: number) => void;
  onMapClick: (point: LatLon) => void;
}) {
  const map = useMap();
  // The drag origin is mirrored in a ref so the Leaflet handlers always see the
  // current value, even when several pointer events arrive in one React batch.
  const dragStartRef = useRef<LatLon | null>(null);
  const [dragStart, setDragStart] = useState<LatLon | null>(null);
  const [dragCurrent, setDragCurrent] = useState<LatLon | null>(null);
  const [polygonPoints, setPolygonPoints] = useState<LatLon[]>([]);
  const [cursor, setCursor] = useState<LatLon | null>(null);
  const lastDraftAt = useRef(0);

  const dragMode = mode === 'rectangle' || mode === 'circle' || mode === 'los';

  useEffect(() => {
    const container = map.getContainer();
    container.style.cursor = mode === 'none' ? '' : 'crosshair';
    if (dragMode) map.dragging.disable();
    else map.dragging.enable();
    if (mode === 'polygon') map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    return () => {
      container.style.cursor = '';
      map.dragging.enable();
      map.doubleClickZoom.enable();
    };
  }, [map, mode, dragMode]);

  // Discard any in-progress drawing when the active tool changes
  useEffect(() => {
    dragStartRef.current = null;
    setDragStart(null);
    setDragCurrent(null);
    setPolygonPoints([]);
    setCursor(null);
  }, [mode]);

  const finishPolygon = (points: LatLon[]) => {
    if (points.length < 3) return;
    onAOComplete(buildAO('polygon', points));
    setPolygonPoints([]);
    setCursor(null);
  };

  useEffect(() => {
    if (mode !== 'polygon') return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Enter') finishPolygon(polygonPoints);
      if (event.key === 'Escape') setPolygonPoints([]);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, polygonPoints]);

  useMapEvents({
    mousedown(e) {
      if (!dragMode) return;
      dragStartRef.current = toLatLon(e.latlng);
      setDragStart(dragStartRef.current);
      setDragCurrent(dragStartRef.current);
    },
    mousemove(e) {
      const point = toLatLon(e.latlng);
      if (mode === 'polygon') {
        setCursor(point);
        return;
      }
      const start = dragStartRef.current;
      if (!dragMode || !start) return;
      setDragCurrent(point);
      if (mode === 'los') {
        const now = Date.now();
        if (now - lastDraftAt.current >= DRAG_THROTTLE_MS) {
          lastDraftAt.current = now;
          onLosDraft(start, haversineDistance(start, point));
        }
      }
    },
    mouseup(e) {
      const start = dragStartRef.current;
      if (!dragMode || !start) return;
      const end = toLatLon(e.latlng);
      const radius = haversineDistance(start, end);
      if (radius > 1) {
        if (mode === 'rectangle') {
          onAOComplete(buildAO('rectangle', rectangleVertices(start, end)));
        } else if (mode === 'circle') {
          onAOComplete(
            buildAO('circle', circleVertices(start, radius), {
              center: start,
              radiusM: radius,
            })
          );
        } else if (mode === 'los') {
          onLosCommit(start, radius);
        }
      }
      dragStartRef.current = null;
      setDragStart(null);
      setDragCurrent(null);
    },
    click(e) {
      if (mode === 'polygon') {
        setPolygonPoints((prev) => [...prev, toLatLon(e.latlng)]);
        return;
      }
      if (mode === 'none') onMapClick(toLatLon(e.latlng));
    },
    dblclick() {
      if (mode === 'polygon') finishPolygon(polygonPoints);
    },
  });

  const draftRadius = dragStart && dragCurrent ? haversineDistance(dragStart, dragCurrent) : 0;

  return (
    <>
      {mode === 'rectangle' && dragStart && dragCurrent && (
        <Polygon
          positions={rectangleVertices(dragStart, dragCurrent).map((p) => [p.lat, p.lon])}
          pathOptions={{
            color: AO_COLOR,
            weight: 2,
            dashArray: '6 4',
            fillOpacity: 0.1,
            interactive: false,
          }}
        />
      )}
      {mode === 'circle' && dragStart && draftRadius > 0 && (
        <Circle
          center={[dragStart.lat, dragStart.lon]}
          radius={draftRadius}
          pathOptions={{
            color: AO_COLOR,
            weight: 2,
            dashArray: '6 4',
            fillOpacity: 0.1,
            interactive: false,
          }}
        />
      )}
      {mode === 'los' && dragStart && (
        <>
          <Circle
            center={[dragStart.lat, dragStart.lon]}
            radius={Math.max(draftRadius, 1)}
            pathOptions={{
              color: '#ffffff',
              weight: 2,
              dashArray: '4 4',
              fillOpacity: 0.05,
              interactive: false,
            }}
          >
            <Tooltip permanent direction="top">{`Radius ${formatDistance(draftRadius)}`}</Tooltip>
          </Circle>
          <CircleMarker
            center={[dragStart.lat, dragStart.lon]}
            radius={5}
            pathOptions={{ color: '#ffffff', fillColor: '#ffcc00', fillOpacity: 1 }}
          />
        </>
      )}
      {mode === 'polygon' && polygonPoints.length > 0 && (
        <>
          <Polyline
            positions={[...polygonPoints, ...(cursor ? [cursor] : [])].map((p) => [p.lat, p.lon])}
            pathOptions={{ color: AO_COLOR, weight: 2, dashArray: '6 4', interactive: false }}
          />
          {polygonPoints.map((p, idx) => (
            <CircleMarker
              key={`draft-vertex-${idx}`}
              center={[p.lat, p.lon]}
              radius={4}
              pathOptions={{ color: AO_COLOR, fillColor: AO_COLOR, fillOpacity: 1 }}
            />
          ))}
        </>
      )}
    </>
  );
}

export default function TacticalMap({
  center,
  ao,
  drawMode,
  onAOChange,
  onDrawModeChange,
  observers,
  onLosDraft,
  onLosCommit,
  spotHeights,
  losPoints,
  onMapClick,
  units,
  viewshed,
  predictions = [],
  heatmapCells = [],
  transmitters = [],
}: Props) {
  const handleAOComplete = (nextAO: AreaOfOperations) => {
    onAOChange(nextAO);
    onDrawModeChange('none');
  };

  return (
    <MapContainer
      center={[center.lat, center.lon]}
      zoom={11}
      style={{ height: '100%', width: '100%' }}
    >
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Standard (OSM)">
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap contributors'
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Topographical">
          <TileLayer
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            attribution='Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap'
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satellite (Esri)">
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            attribution="Tiles &copy; Esri"
          />
        </LayersControl.BaseLayer>
        <LayersControl.Overlay name="Military Grid Overlay">
          <TileLayer
            url="https://stamen-tiles.a.ssl.fastly.net/toner-lines/{z}/{x}/{y}.png"
            attribution="Stamen Design"
            opacity={0.5}
          />
        </LayersControl.Overlay>
      </LayersControl>

      <DrawInteractions
        mode={drawMode}
        onAOComplete={handleAOComplete}
        onLosDraft={onLosDraft}
        onLosCommit={onLosCommit}
        onMapClick={onMapClick}
      />

      {ao && (
        <Polygon
          positions={ao.vertices.map((p) => [p.lat, p.lon])}
          pathOptions={{ color: AO_COLOR, weight: 3, fillColor: AO_COLOR, fillOpacity: 0.08 }}
        >
          <Tooltip sticky>
            {`AO (${ao.shape}) - ${ao.areaKm2.toFixed(2)} km2, perimeter ${ao.perimeterKm.toFixed(2)} km`}
          </Tooltip>
        </Polygon>
      )}

      {observers.map((observer) => (
        <Fragment key={observer.id}>
          {observer.viewshed ? (
            <ViewshedOverlay viewshed={observer.viewshed} />
          ) : (
            <Circle
              center={[observer.position.lat, observer.position.lon]}
              radius={Math.max(observer.radiusM, 1)}
              pathOptions={{ color: '#ffffff', weight: 2, dashArray: '4 4', fillOpacity: 0.05 }}
            />
          )}
          <CircleMarker
            center={[observer.position.lat, observer.position.lon]}
            radius={5}
            pathOptions={{ color: '#ffffff', fillColor: '#ffcc00', fillOpacity: 1 }}
          >
            <Popup>
              <strong>Observer</strong>
              <br />
              {observer.position.lat.toFixed(5)}, {observer.position.lon.toFixed(5)}
              <br />Eye height: {observer.observerHeightM}m AGL
              <br />Radius: {formatDistance(observer.radiusM)}
              {observer.loading && (
                <>
                  <br />Calculating visibility...
                </>
              )}
            </Popup>
          </CircleMarker>
        </Fragment>
      ))}

      {spotHeights.map((sh, idx) => (
        <Marker
          key={`spot-${idx}`}
          position={[sh.lat, sh.lon]}
          icon={L.divIcon({
            className: 'spot-height-icon',
            html: `<div class="spot-height-marker">▲<span>${Math.round(sh.elevation)}m</span></div>`,
            iconSize: [40, 24],
            iconAnchor: [20, 12],
          })}
        >
          <Popup>
            <strong>Spot Height</strong>
            <br />Elevation: {Math.round(sh.elevation)}m
            <br />Prominence: {Math.round(sh.prominence)}m
            {sh.observableSpotHeights !== undefined && (
              <>
                <br />Observes {sh.observableSpotHeights}/{sh.totalComparedSpotHeights} compared spot heights
              </>
            )}
          </Popup>
        </Marker>
      ))}

      {losPoints.length === 2 && (
        <Polyline positions={losPoints.map((p) => [p.lat, p.lon])} color="#ffcc00" weight={3} />
      )}
      {losPoints.map((p, idx) => (
        <Marker key={`los-${idx}`} position={[p.lat, p.lon]}>
          <Popup>{idx === 0 ? 'Observer' : 'Target'}</Popup>
        </Marker>
      ))}

      {viewshed && <ViewshedOverlay viewshed={viewshed} />}

      {units.map((unit) => (
        <Marker key={unit.id} position={[unit.position.lat, unit.position.lon]} icon={unitIcon(unit)}>
          <Popup>
            <strong>{unit.name}</strong>
            <br />Affiliation: {unit.affiliation}
            <br />Status: {unit.status}
            <br />Strength: {unit.strength}
          </Popup>
        </Marker>
      ))}

      {heatmapCells.map((cell, idx) => (
        <Circle
          key={`heatmap-${idx}`}
          center={[cell.lat, cell.lon]}
          radius={200 + (cell.intensity / 255) * 300}
          pathOptions={{
            color: heatmapColor(cell.intensity),
            weight: 0,
            fillColor: heatmapColor(cell.intensity),
            fillOpacity: 0.15 + (cell.intensity / 255) * 0.35,
            interactive: false,
          }}
        />
      ))}

      {/* Communications overlay: signal coverage and an active-transmission marker. */}
      {transmitters.map((tx) => (
        <Fragment key={`tx-${tx.unitId}`}>
          <Circle
            center={[tx.position.lat, tx.position.lon]}
            radius={tx.coverageM}
            pathOptions={{
              color: tx.color,
              weight: 1,
              dashArray: '6 6',
              fillColor: tx.color,
              fillOpacity: 0.06,
              interactive: false,
            }}
          />
          <CircleMarker
            center={[tx.position.lat, tx.position.lon]}
            radius={7}
            pathOptions={{ color: COMMS_COLOR, fillColor: tx.color, fillOpacity: 0.85 }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              {`📡 ${tx.callsign} transmitting — ${tx.channelName}`}
            </Tooltip>
          </CircleMarker>
        </Fragment>
      ))}

      {predictions.map((prediction) =>
        prediction.trajectory.points.map((pt) => (
          <Fragment key={`predicted-${prediction.unitId}-${pt.minutesAhead}`}>
            <Circle
              center={[pt.position.lat, pt.position.lon]}
              // Lower-confidence predictions get a larger, hazier halo.
              radius={Math.max(150, (100 - pt.confidencePct) * 60)}
              pathOptions={{
                color: PREDICTION_COLOR,
                weight: 1,
                dashArray: '4 4',
                fillColor: PREDICTION_COLOR,
                fillOpacity: 0.12,
                interactive: false,
              }}
            />
            <CircleMarker
              center={[pt.position.lat, pt.position.lon]}
              radius={4}
              pathOptions={{ color: PREDICTION_COLOR, fillColor: PREDICTION_COLOR, fillOpacity: 0.9 }}
            >
              <Tooltip>
                {`${prediction.unitName} - predicted +${pt.minutesAhead} min (${pt.confidencePct}% confidence)`}
              </Tooltip>
            </CircleMarker>
          </Fragment>
        ))
      )}
    </MapContainer>
  );
}
