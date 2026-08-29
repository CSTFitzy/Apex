import { useState } from 'react';
import api from '../api/client';
import type { AOBounds, LatLon, LosResult, SpotHeight, TerrainReport, ViewshedResult } from '../types';

interface Props {
  aoBounds: AOBounds | null;
  spotHeights: SpotHeight[];
  onSpotHeightsChange: (spotHeights: SpotHeight[]) => void;
  losPoints: LatLon[];
  onClearLosPoints: () => void;
  onViewshedChange: (viewshed: ViewshedResult | null) => void;
  onTerrainSummary: (summary: string) => void;
}

export default function TerrainPanel({
  aoBounds,
  spotHeights,
  onSpotHeightsChange,
  losPoints,
  onClearLosPoints,
  onViewshedChange,
  onTerrainSummary,
}: Props) {
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [losResult, setLosResult] = useState<LosResult | null>(null);
  const [report, setReport] = useState<TerrainReport | null>(null);

  const runSpotHeights = async () => {
    if (!aoBounds) return setError('Draw an operational area on the map first.');
    setLoading('spot-heights');
    setError(null);
    try {
      const { data } = await api.get('/terrain/spot-heights', { params: aoBounds });
      onSpotHeightsChange(data.spotHeights);
    } catch (err) {
      console.error(err);
      setError('Failed to identify spot heights. The elevation data source may be unreachable.');
    } finally {
      setLoading(null);
    }
  };

  const runLOS = async () => {
    if (losPoints.length !== 2) return setError('Click two points on the map to select an observer and a target.');
    setLoading('los');
    setError(null);
    try {
      const { data } = await api.post<LosResult>('/terrain/los', {
        from: losPoints[0],
        to: losPoints[1],
      });
      setLosResult(data);
    } catch (err) {
      console.error(err);
      setError('Failed to compute line of sight.');
    } finally {
      setLoading(null);
    }
  };

  const runViewshed = async (origin: LatLon) => {
    setLoading('viewshed');
    setError(null);
    try {
      const { data } = await api.post<ViewshedResult>('/terrain/viewshed', {
        origin,
        radius: 5000,
        rays: 36,
      });
      onViewshedChange(data);
    } catch (err) {
      console.error(err);
      setError('Failed to compute viewshed.');
    } finally {
      setLoading(null);
    }
  };

  const runReport = async () => {
    if (!aoBounds) return setError('Draw an operational area on the map first.');
    setLoading('report');
    setError(null);
    try {
      const { data } = await api.post<TerrainReport>('/terrain/report', { bbox: aoBounds });
      setReport(data);
      onSpotHeightsChange(data.spotHeights);
      onTerrainSummary(data.summary);
    } catch (err) {
      console.error(err);
      setError('Failed to generate terrain report.');
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="terrain-panel">
      <h2>Terrain Analysis Engine</h2>
      <p className="panel-subtitle">SRTM/Copernicus elevation data (free, ~30-90m resolution)</p>
      {error && <p className="error-text">{error}</p>}

      <div className="terrain-actions">
        <button className="action-btn" onClick={runSpotHeights} disabled={loading !== null}>
          {loading === 'spot-heights' ? 'Analyzing...' : 'Identify Spot Heights'}
        </button>
        <button className="action-btn" onClick={runReport} disabled={loading !== null}>
          {loading === 'report' ? 'Generating...' : 'Generate Full Terrain Report'}
        </button>
      </div>

      <div className="terrain-tool">
        <h3>Line-of-Sight Tool</h3>
        <p>Click two points on the map: first = observer, second = target.</p>
        <p>
          Observer: {losPoints[0] ? `${losPoints[0].lat.toFixed(4)}, ${losPoints[0].lon.toFixed(4)}` : '—'}
          <br />
          Target: {losPoints[1] ? `${losPoints[1].lat.toFixed(4)}, ${losPoints[1].lon.toFixed(4)}` : '—'}
        </p>
        <div className="terrain-actions">
          <button className="action-btn" onClick={runLOS} disabled={loading !== null || losPoints.length !== 2}>
            {loading === 'los' ? 'Computing...' : 'Check Line of Sight'}
          </button>
          <button className="action-btn secondary" onClick={onClearLosPoints}>
            Clear Points
          </button>
          {losPoints[0] && (
            <button className="action-btn" onClick={() => runViewshed(losPoints[0])} disabled={loading !== null}>
              {loading === 'viewshed' ? 'Computing...' : '360° Viewshed from Observer'}
            </button>
          )}
        </div>
        {losResult && (
          <p className={losResult.visible ? 'los-visible' : 'los-obstructed'}>
            {losResult.visible
              ? `LOS CLEAR - target is visible (distance ${(losResult.distance / 1000).toFixed(2)}km)`
              : `LOS OBSTRUCTED at ${losResult.obstructedAt?.lat.toFixed(4)}, ${losResult.obstructedAt?.lon.toFixed(4)}`}
          </p>
        )}
      </div>

      {spotHeights.length > 0 && (
        <div className="spot-height-list">
          <h3>Spot Heights ({spotHeights.length})</h3>
          <table>
            <thead>
              <tr>
                <th>Elevation</th>
                <th>Prominence</th>
                <th>Observes</th>
              </tr>
            </thead>
            <tbody>
              {spotHeights.map((sh, idx) => (
                <tr key={idx}>
                  <td>{Math.round(sh.elevation)}m</td>
                  <td>{Math.round(sh.prominence)}m</td>
                  <td>
                    {sh.observableSpotHeights !== undefined
                      ? `${sh.observableSpotHeights}/${sh.totalComparedSpotHeights}`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <div className="terrain-report">
          <h3>Terrain Report Summary</h3>
          <p>{report.summary}</p>
        </div>
      )}
    </div>
  );
}
