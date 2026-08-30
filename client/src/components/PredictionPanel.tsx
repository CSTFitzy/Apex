import type { TacticalUnit, UnitPrediction } from '../types';

interface Props {
  units: TacticalUnit[];
  predictions: UnitPrediction[];
  loading: boolean;
  error: string | null;
}

const trendColor: Record<string, string> = {
  INCREASING: '#e74c3c',
  STABLE: '#f1c40f',
  DECREASING: '#2ecc71',
};

/**
 * "AI Predictions" tab: displays the TensorFlow.js movement/threat model
 * output (computed by the shared `usePredictions` hook) for every active
 * hostile unit - multi-step-ahead trajectory forecasts, threat escalation,
 * casualty/engagement estimates, and tactical recommendations.
 */
export default function PredictionPanel({ units, predictions, loading, error }: Props) {
  const hostileCount = units.filter((u) => u.affiliation === 'hostile' && u.status !== 'destroyed').length;

  return (
    <div className="prediction-panel">
      <h2>AI Enemy Prediction (TensorFlow.js)</h2>
      <p className="panel-subtitle">
        On-device LSTM movement forecasting and threat-escalation modelling - no server round-trip required.
      </p>

      {units.length === 0 && <p className="hint-text">Deploy forces in the Simulation tab to generate predictions.</p>}
      {units.length > 0 && hostileCount === 0 && (
        <p className="hint-text">No active hostile units to predict.</p>
      )}
      {loading && predictions.length === 0 && (
        <p className="hint-text">Preparing on-device AI models (one-time, a few seconds)...</p>
      )}
      {loading && predictions.length > 0 && <p className="hint-text">Refreshing predictions...</p>}
      {error && <p className="error-text">{error}</p>}

      {predictions.map((p) => (
        <div key={p.unitId} className="doctrine-card prediction-card">
          <h4>{p.unitName}</h4>

          <div className="prediction-block">
            <strong>Predicted Movement</strong>
            {p.trajectory.points.length === 0 ? (
              <p className="stats-empty">Insufficient movement history yet.</p>
            ) : (
              <ul>
                {p.trajectory.points.map((pt) => (
                  <li key={pt.minutesAhead}>
                    +{pt.minutesAhead} min: {pt.position.lat.toFixed(4)}, {pt.position.lon.toFixed(4)} —{' '}
                    <span className="confidence-badge">{pt.confidencePct}% confidence</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="prediction-block">
            <strong>Threat Escalation Forecast</strong>
            <ul>
              {p.threatForecasts.map((f) => (
                <li key={f.hoursAhead}>
                  Next {f.hoursAhead}h:{' '}
                  <span style={{ color: trendColor[f.trend], fontWeight: 600 }}>{f.trend}</span> (
                  {f.predictedLevel}, {f.confidencePct}% confidence)
                </li>
              ))}
            </ul>
          </div>

          <div className="prediction-block">
            <strong>Engagement &amp; Casualty Forecast</strong>
            <ul>
              <li>Engagement probability (next 30 min): {p.engagementProbabilityPct}%</li>
              <li>Predicted friendly casualty rate if engaged: {p.casualtyForecastPct}%</li>
            </ul>
          </div>

          <div className="prediction-block">
            <strong>Tactical Recommendations</strong>
            <ul>
              {p.recommendations.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
