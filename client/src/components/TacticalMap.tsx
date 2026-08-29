import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, LayersControl, FeatureGroup, Marker, Polyline, Popup, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';
import 'leaflet-draw';
import ms from 'milsymbol';
import type { AOBounds, LatLon, SpotHeight, TacticalUnit, ViewshedResult } from '../types';

// Fix default marker icon paths (Vite bundling breaks Leaflet's default asset resolution)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface Props {
  center: LatLon;
  aoBounds: AOBounds | null;
  onAOChange: (bounds: AOBounds | null) => void;
  spotHeights: SpotHeight[];
  losPoints: LatLon[];
  onMapClick: (point: LatLon) => void;
  units: TacticalUnit[];
  viewshed: ViewshedResult | null;
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

function AODrawControl({ onAOChange }: { onAOChange: (bounds: AOBounds | null) => void }) {
  const map = useMap();
  const featureGroupRef = useRef<L.FeatureGroup | null>(null);
  const drawControlRef = useRef<L.Control.Draw | null>(null);

  useEffect(() => {
    if (!featureGroupRef.current) return;
    const drawnItems = featureGroupRef.current;

    const drawControl = new L.Control.Draw({
      draw: {
        polygon: { showArea: true, allowIntersection: false },
        rectangle: {} as L.DrawOptions.RectangleOptions,
        polyline: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: {
        featureGroup: drawnItems,
      },
    });
    drawControlRef.current = drawControl;
    map.addControl(drawControl);

    const updateBounds = () => {
      const layers = drawnItems.getLayers();
      if (layers.length === 0) {
        onAOChange(null);
        return;
      }
      const bounds = drawnItems.getBounds();
      onAOChange({
        north: bounds.getNorth(),
        south: bounds.getSouth(),
        east: bounds.getEast(),
        west: bounds.getWest(),
      });
    };

    const handleCreated = (e: L.LeafletEvent) => {
      drawnItems.clearLayers();
      drawnItems.addLayer((e as L.DrawEvents.Created).layer);
      updateBounds();
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, updateBounds);
    map.on(L.Draw.Event.DELETED, updateBounds);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, updateBounds);
      map.off(L.Draw.Event.DELETED, updateBounds);
      map.removeControl(drawControl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return <FeatureGroup ref={featureGroupRef} />;
}

function ClickHandler({ onMapClick }: { onMapClick: (point: LatLon) => void }) {
  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lon: e.latlng.lng });
    },
  });
  return null;
}

export default function TacticalMap({
  center,
  onAOChange,
  spotHeights,
  losPoints,
  onMapClick,
  units,
  viewshed,
}: Props) {
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

      <AODrawControl onAOChange={onAOChange} />
      <ClickHandler onMapClick={onMapClick} />

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

      {viewshed &&
        viewshed.sectors.map((sector, idx) => (
          <Polyline
            key={`vs-${idx}`}
            positions={[
              [viewshed.origin.lat, viewshed.origin.lon],
              [sector.endPoint.lat, sector.endPoint.lon],
            ]}
            color={sector.visible ? '#00ff88' : '#ff4444'}
            weight={2}
            opacity={0.6}
          />
        ))}

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
    </MapContainer>
  );
}
