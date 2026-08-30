import type { AreaOfOperations, DrawMode, LosObserver } from '../types';
import { formatDistance, visibilityStats } from '../utils/geometry';

const MODE_INSTRUCTIONS: Record<DrawMode, string> = {
  none: 'Pan and zoom freely. Map clicks set the two-point line-of-sight observer/target.',
  rectangle: 'Click and drag on the map to draw a rectangular operating area.',
  circle: 'Click the AO centre and drag outward to set the radius.',
  polygon: 'Click each boundary vertex, then double-click or press Enter to close the AO (Esc cancels).',
  los: 'Click your observer position and drag outward to expand the visibility circle (eye height 1.5 m AGL).',
};

const MODE_LABELS: Record<DrawMode, string> = {
  none: 'Navigate',
  rectangle: 'AO Rectangle',
  circle: 'AO Circle',
  polygon: 'AO Freehand Polygon',
  los: 'Line of Sight',
};

interface ToolsProps {
  drawMode: DrawMode;
  onDrawModeChange: (mode: DrawMode) => void;
  hasAO: boolean;
  onClearAO: () => void;
  observerCount: number;
  onClearObservers: () => void;
}

/** Floating drawing-tools palette rendered over the tactical map. */
export function DrawingToolsPanel({
  drawMode,
  onDrawModeChange,
  hasAO,
  onClearAO,
  observerCount,
  onClearObservers,
}: ToolsProps) {
  const toggle = (mode: DrawMode) => onDrawModeChange(drawMode === mode ? 'none' : mode);

  return (
    <div className="map-tools-panel">
      <h3>Drawing Tools</h3>
      <div className="tool-group">
        <span className="tool-group-label">Operating Area</span>
        <div className="tool-buttons">
          <button
            className={`tool-btn ${drawMode === 'rectangle' ? 'active' : ''}`}
            onClick={() => toggle('rectangle')}
            title="Click and drag to draw a rectangular AO"
          >
            ▭ Rectangle
          </button>
          <button
            className={`tool-btn ${drawMode === 'circle' ? 'active' : ''}`}
            onClick={() => toggle('circle')}
            title="Click the centre and drag to set the radius"
          >
            ◯ Circle
          </button>
          <button
            className={`tool-btn ${drawMode === 'polygon' ? 'active' : ''}`}
            onClick={() => toggle('polygon')}
            title="Click each vertex, double-click or press Enter to finish"
          >
            ⬠ Freehand
          </button>
          <button className="tool-btn danger" onClick={onClearAO} disabled={!hasAO} title="Remove the current AO">
            ✕ Clear AO
          </button>
        </div>
      </div>

      <div className="tool-group">
        <span className="tool-group-label">Line of Sight</span>
        <div className="tool-buttons">
          <button
            className={`tool-btn ${drawMode === 'los' ? 'active' : ''}`}
            onClick={() => toggle('los')}
            title="Click an observer position and drag to expand the visibility circle"
          >
            ◉ LOS Circle
          </button>
          <button
            className="tool-btn danger"
            onClick={onClearObservers}
            disabled={observerCount === 0}
            title="Remove all observers"
          >
            ✕ Clear LOS
          </button>
        </div>
      </div>

      <p className="tool-status">
        <strong>{MODE_LABELS[drawMode]}</strong>
        <br />
        {MODE_INSTRUCTIONS[drawMode]}
      </p>
    </div>
  );
}

interface StatsProps {
  ao: AreaOfOperations | null;
  observers: LosObserver[];
}

/** Floating results panel summarising the current AO and LOS analyses. */
export function AnalysisStatsPanel({ ao, observers }: StatsProps) {
  return (
    <div className="map-stats-panel">
      <h3>Operational Picture</h3>

      <div className="stats-block">
        <h4>Operating Area</h4>
        {ao ? (
          <ul>
            <li>Shape: {ao.shape}</li>
            <li>Area: {ao.areaKm2.toFixed(2)} km²</li>
            <li>Perimeter: {ao.perimeterKm.toFixed(2)} km</li>
            <li>
              Centre: {ao.center.lat.toFixed(4)}, {ao.center.lon.toFixed(4)}
            </li>
            <li>
              Bounds: N {ao.bounds.north.toFixed(4)} / S {ao.bounds.south.toFixed(4)} / E{' '}
              {ao.bounds.east.toFixed(4)} / W {ao.bounds.west.toFixed(4)}
            </li>
            {ao.circle && <li>Radius: {formatDistance(ao.circle.radiusM)}</li>}
          </ul>
        ) : (
          <p className="stats-empty">No AO defined. Draw one to scope weather and terrain analysis.</p>
        )}
      </div>

      <div className="stats-block">
        <h4>Line of Sight ({observers.length})</h4>
        {observers.length === 0 ? (
          <p className="stats-empty">No observers placed. Use the LOS Circle tool.</p>
        ) : (
          observers.map((observer, idx) => {
            const stats = observer.viewshed ? visibilityStats(observer.viewshed) : null;
            return (
              <ul key={observer.id} className="los-stats">
                <li>
                  <strong>Observer {idx + 1}</strong> — {observer.position.lat.toFixed(4)},{' '}
                  {observer.position.lon.toFixed(4)}
                </li>
                <li>Eye height: {observer.observerHeightM.toFixed(1)} m AGL</li>
                <li>Radius: {formatDistance(observer.radiusM)}</li>
                {observer.loading && <li>Computing visibility…</li>}
                {observer.error && <li className="error-text">{observer.error}</li>}
                {stats && (
                  <>
                    <li>
                      Terrain samples: <span className="visible-count">{stats.visibleSamples} visible</span> /{' '}
                      <span className="blocked-count">{stats.blockedSamples} blocked</span> of{' '}
                      {stats.totalSamples}
                    </li>
                    <li>Visible area: {stats.visibleAreaPct.toFixed(1)}%</li>
                  </>
                )}
              </ul>
            );
          })
        )}
      </div>
    </div>
  );
}
