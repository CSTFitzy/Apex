import React, { useState } from 'react';
import api from '../utils/api.js';

/**
 * Area of Operations panel.
 *
 * Shows the AOO picked on the tactical map, lets the operator name it and
 * set its radius, runs the backend terrain & weather analysis, and renders
 * (and downloads) the resulting report.
 *
 * @param {object} props
 * @param {object|null} props.aoo - { latitude, longitude } picked on the map.
 * @param {number} props.radiusKm - Current AOO radius in kilometres.
 * @param {function} props.onRadiusChange - Called with the new radius.
 */
export default function AOOPanel({ aoo, radiusKm, onRadiusChange }) {
  const [name, setName] = useState('');
  const [analysis, setAnalysis] = useState(null);
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runAnalysis = async () => {
    if (!aoo) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.analyzeTerrain(aoo.latitude, aoo.longitude, radiusKm);
      setAnalysis(data);
      const { body } = await api.getTerrainReport(aoo.latitude, aoo.longitude, radiusKm, name);
      setReport(body);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadReport = () => {
    const blob = new Blob([report], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(name || 'aoo').replace(/\s+/g, '-').toLowerCase()}-terrain-weather-report.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!aoo) {
    return (
      <div className="aoo-panel">
        <h3>Area of Operations</h3>
        <p>Click anywhere on the map to select an area of operations.</p>
      </div>
    );
  }

  const terrain = analysis?.terrain;

  return (
    <div className="aoo-panel">
      <h3>Area of Operations</h3>
      <p>
        Centre: {aoo.latitude.toFixed(5)}, {aoo.longitude.toFixed(5)}
      </p>

      <label>
        Name
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. OBJ FALCON" />
      </label>

      <label>
        Radius (km)
        <input
          type="number"
          min="1"
          max="200"
          value={radiusKm}
          onChange={(event) => onRadiusChange(Number(event.target.value))}
        />
      </label>

      <button type="button" onClick={runAnalysis} disabled={loading}>
        {loading ? 'Analyzing...' : 'Analyze terrain & weather'}
      </button>

      {error && <p className="aoo-panel-error">{error}</p>}

      {terrain && (
        <ul className="aoo-summary">
          <li>Terrain: {terrain.terrainType}</li>
          <li>
            Elevation: {terrain.elevation.min}–{terrain.elevation.max} m (relief {terrain.elevation.relief} m)
          </li>
          <li>
            Slope: mean {terrain.slope.meanSlopeDeg}°, max {terrain.slope.maxSlopeDeg}°
          </li>
          <li>Mobility: {terrain.mobility.rating}</li>
          {analysis.weather && (
            <li>
              Weather: {analysis.weather.current.temperatureC}°C, wind{' '}
              {analysis.weather.current.windSpeedKph} km/h
            </li>
          )}
        </ul>
      )}

      {report && (
        <>
          <button type="button" onClick={downloadReport}>
            Download report
          </button>
          <pre className="aoo-report">{report}</pre>
        </>
      )}
    </div>
  );
}
