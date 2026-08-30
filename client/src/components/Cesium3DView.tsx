import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import ms from 'milsymbol';
import type { AreaOfOperations, LatLon, LosObserver, TacticalUnit } from '../types';
import { viewshedWedges } from '../utils/geometry';

interface Props {
  center: LatLon;
  ao: AreaOfOperations | null;
  observers: LosObserver[];
  units: TacticalUnit[];
}

type CameraPreset = 'orbit' | 'top-down' | 'follow' | 'first-person';

/** Ion token is optional - the view still works (flat ellipsoid terrain + OSM imagery) without one. */
const CESIUM_ION_TOKEN = (import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined)?.trim();
const VISIBLE_COLOR = Cesium.Color.fromCssColorString('#00ff88').withAlpha(0.45);
const BLOCKED_COLOR = Cesium.Color.fromCssColorString('#ff4444').withAlpha(0.4);

/** Renders a NATO APP-6D symbol (via milsymbol) to an SVG data URL usable as a Cesium billboard image. */
function unitBillboardImage(unit: TacticalUnit): string {
  const symbol = new ms.Symbol(unit.sidc, { size: 28, fill: true, infoFields: false });
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(symbol.asSVG())))}`;
}

/**
 * Cesium-based 3D globe/terrain view - the counterpart to the 2D Leaflet map.
 * Renders the same AO, LOS viewsheds, and NATO unit symbology in 3D, with
 * camera presets (orbit, top-down, follow-unit, first-person) and a
 * day/night lighting toggle. Falls back to flat ellipsoid terrain and OSM
 * imagery when no Cesium Ion token is configured.
 */
export default function Cesium3DView({ center, ao, observers, units }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [ready, setReady] = useState(false);
  const [preset, setPreset] = useState<CameraPreset>('orbit');
  const [selectedUnitId, setSelectedUnitId] = useState<string>('');
  const [nightMode, setNightMode] = useState(false);
  const [fps, setFps] = useState(0);

  // Initialise the viewer once on mount.
  useEffect(() => {
    if (!containerRef.current) return;
    let cancelled = false;
    let viewer: Cesium.Viewer | null = null;

    async function init() {
      if (CESIUM_ION_TOKEN) {
        Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;
      }

      let terrain: Cesium.Terrain | undefined;
      if (CESIUM_ION_TOKEN) {
        try {
          terrain = Cesium.Terrain.fromWorldTerrain({ requestVertexNormals: true });
        } catch (err) {
          console.warn('Falling back to flat terrain - Cesium World Terrain unavailable.', err);
        }
      }
      if (cancelled || !containerRef.current) return;

      viewer = new Cesium.Viewer(containerRef.current, {
        terrain,
        baseLayer: Cesium.ImageryLayer.fromProviderAsync(
          Promise.resolve(
            new Cesium.UrlTemplateImageryProvider({
              url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
              subdomains: ['a', 'b', 'c'],
              credit: 'OpenStreetMap contributors',
            })
          ),
          {}
        ),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        infoBox: false,
        selectionIndicator: false,
        timeline: true,
        animation: true,
      });
      viewer.scene.globe.enableLighting = true;
      viewer.scene.globe.depthTestAgainstTerrain = true;
      viewerRef.current = viewer;
      setReady(true);
    }

    init();

    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      setReady(false);
    };
    // Viewer is created once; center/ao/units are handled by their own effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // FPS indicator (debug performance readout).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    let frames = 0;
    let lastSample = performance.now();
    const listener = () => {
      frames += 1;
      const now = performance.now();
      if (now - lastSample >= 1000) {
        setFps(frames);
        frames = 0;
        lastSample = now;
      }
    };
    viewer.scene.postRender.addEventListener(listener);
    return () => {
      viewer.scene.postRender.removeEventListener(listener);
    };
  }, [ready]);

  // Day/night toggle - drives the simulation clock so lighting/shadows respond immediately.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const time = nightMode
      ? Cesium.JulianDate.fromDate(new Date(new Date().setUTCHours(2, 0, 0, 0)))
      : Cesium.JulianDate.fromDate(new Date(new Date().setUTCHours(12, 0, 0, 0)));
    viewer.clock.currentTime = time;
    viewer.scene.globe.enableLighting = true;
  }, [nightMode, ready]);

  // Operating area outline.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    viewer.entities.removeById('ao-outline');
    if (ao) {
      viewer.entities.add({
        id: 'ao-outline',
        polygon: {
          hierarchy: Cesium.Cartesian3.fromDegreesArray(ao.vertices.flatMap((v) => [v.lon, v.lat])),
          material: Cesium.Color.fromCssColorString('#3b82f6').withAlpha(0.15),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#3b82f6'),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    }
    return () => {
      viewerRef.current?.entities.removeById('ao-outline');
    };
  }, [ao, ready]);

  // NATO unit symbology, positioned/clamped onto the 3D terrain.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const currentIds = new Set(units.map((u) => `unit-${u.id}`));
    for (const entity of [...viewer.entities.values]) {
      if (entity.id.toString().startsWith('unit-') && !currentIds.has(entity.id.toString())) {
        viewer.entities.remove(entity);
      }
    }
    for (const unit of units) {
      const id = `unit-${unit.id}`;
      const position = Cesium.Cartesian3.fromDegrees(unit.position.lon, unit.position.lat);
      const existing = viewer.entities.getById(id);
      if (existing) {
        existing.position = new Cesium.ConstantPositionProperty(position);
      } else {
        viewer.entities.add({
          id,
          position,
          billboard: {
            image: unitBillboardImage(unit),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          },
          label: {
            text: `${unit.name} (${unit.status})`,
            font: '12px sans-serif',
            pixelOffset: new Cesium.Cartesian2(0, -34),
            fillColor: unit.affiliation === 'hostile' ? Cesium.Color.RED : Cesium.Color.CYAN,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
      }
    }
  }, [units, ready]);

  // 3D line-of-sight visualisation - reuses the same viewshed wedges as the 2D map.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const prefix = 'los-';
    for (const entity of [...viewer.entities.values]) {
      if (entity.id.toString().startsWith(prefix)) viewer.entities.remove(entity);
    }
    observers.forEach((observer: LosObserver, obsIdx: number) => {
      if (!observer.viewshed) return;
      const wedges = viewshedWedges(observer.viewshed);
      wedges.forEach((wedge, wedgeIdx) => {
        viewer.entities.add({
          id: `${prefix}${obsIdx}-${wedgeIdx}`,
          polygon: {
            hierarchy: Cesium.Cartesian3.fromDegreesArray(wedge.positions.flatMap(([lat, lon]) => [lon, lat])),
            material: wedge.visible ? VISIBLE_COLOR : BLOCKED_COLOR,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          },
        });
      });
    });
  }, [observers, ready]);

  // Camera presets.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !ready) return;
    const selectedUnit = units.find((u) => u.id === selectedUnitId) ?? null;

    if (preset === 'orbit') {
      viewer.trackedEntity = undefined;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 8000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
        duration: 1.2,
      });
    } else if (preset === 'top-down') {
      viewer.trackedEntity = undefined;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(center.lon, center.lat, 15000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
        duration: 1.2,
      });
    } else if (preset === 'follow' && selectedUnit) {
      const entity = viewer.entities.getById(`unit-${selectedUnit.id}`);
      viewer.trackedEntity = entity;
    } else if (preset === 'first-person' && selectedUnit) {
      viewer.trackedEntity = undefined;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(selectedUnit.position.lon, selectedUnit.position.lat, 1.5),
        orientation: { heading: 0, pitch: 0, roll: 0 },
        duration: 1.0,
      });
    }
  }, [preset, selectedUnitId, units, center, ready]);

  return (
    <div className="cesium-view-wrapper">
      <div ref={containerRef} className="cesium-container" />
      <div className="cesium-controls-panel">
        <h3>3D Camera Controls</h3>
        <div className="tool-buttons">
          <button className={`tool-btn ${preset === 'orbit' ? 'active' : ''}`} onClick={() => setPreset('orbit')}>
            🌐 Orbit
          </button>
          <button className={`tool-btn ${preset === 'top-down' ? 'active' : ''}`} onClick={() => setPreset('top-down')}>
            ⬇ Tactical Top-Down
          </button>
          <button
            className={`tool-btn ${preset === 'follow' ? 'active' : ''}`}
            onClick={() => setPreset('follow')}
            disabled={!selectedUnitId}
          >
            🎯 Follow Unit
          </button>
          <button
            className={`tool-btn ${preset === 'first-person' ? 'active' : ''}`}
            onClick={() => setPreset('first-person')}
            disabled={!selectedUnitId}
          >
            👁 First-Person
          </button>
        </div>
        <select value={selectedUnitId} onChange={(e) => setSelectedUnitId(e.target.value)}>
          <option value="">Select unit...</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="night-toggle">
          <input type="checkbox" checked={nightMode} onChange={(e) => setNightMode(e.target.checked)} />
          Night / low-light
        </label>
        <p className="tool-status">
          Drag to orbit, scroll to zoom, right-drag to tilt.
          <br />
          FPS: {fps}
        </p>
      </div>
    </div>
  );
}
