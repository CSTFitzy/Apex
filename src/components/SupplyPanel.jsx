import React, { useMemo, useState } from 'react';
import AnalysisChart from './AnalysisChart.jsx';
import api from '../utils/api.js';

const SUPPLY_COLORS = {
  ammunition: '#f97316',
  fuel: '#2f81f7',
  rations: '#22c55e',
  medical: '#e879f9',
};

const CHART_HOURS = 12;

/** Human-friendly rendering of a time-to-depletion value in hours. */
function formatHours(hours) {
  if (hours === null || hours === undefined) return 'stable';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} d`;
}

/**
 * Bucket recent consumption events into hourly totals per supply type so they
 * can be plotted as consumption rate lines.
 */
function buildConsumptionSeries(events) {
  const now = Date.now();
  const buckets = new Map();
  const labels = [];

  for (let i = CHART_HOURS - 1; i >= 0; i -= 1) {
    const bucketTime = new Date(now - i * 3600 * 1000);
    bucketTime.setMinutes(0, 0, 0);
    labels.push(`${String(bucketTime.getHours()).padStart(2, '0')}:00`);
    buckets.set(bucketTime.getTime(), {});
  }

  const bucketKeys = [...buckets.keys()];
  for (const event of events) {
    const occurred = new Date(event.occurred_at).getTime();
    const key = bucketKeys.find((start) => occurred >= start && occurred < start + 3600 * 1000);
    if (key === undefined) continue;
    const bucket = buckets.get(key);
    bucket[event.supply_type] = (bucket[event.supply_type] || 0) + Number(event.quantity);
  }

  const types = [...new Set(events.map((event) => event.supply_type))];
  const datasets = types.map((type) => ({
    label: type,
    data: bucketKeys.map((key) => buckets.get(key)[type] || 0),
    borderColor: SUPPLY_COLORS[type] || '#8b949e',
  }));

  return { labels, datasets };
}

/** Coloured status pill (critical / low / adequate / full). */
function StatusBadge({ status }) {
  return <span className={`supply-badge supply-badge-${status}`}>{status}</span>;
}

/** Horizontal fill bar showing remaining percentage of capacity. */
function SupplyBar({ supply }) {
  return (
    <div className="supply-bar-row">
      <span className="supply-bar-label">{supply.supplyType}</span>
      <div className="supply-bar" role="meter" aria-valuenow={supply.percentRemaining}>
        <div
          className={`supply-bar-fill supply-bar-fill-${supply.status}`}
          style={{ width: `${Math.min(Math.max(supply.percentRemaining, 0), 100)}%` }}
        />
      </div>
      <span className="supply-bar-value">
        {supply.percentRemaining}% · {formatHours(supply.hoursToDepletion)}
      </span>
    </div>
  );
}

/**
 * Supply panel: real-time stock levels (per unit and aggregate), status
 * indicators, consumption rate graphs, a depletion forecast timeline,
 * resupply alerts and a supply transfer form.
 */
export default function SupplyPanel({
  status,
  forecast,
  consumption = [],
  loading = false,
  error = null,
  onRefresh,
}) {
  const [transfer, setTransfer] = useState({
    fromUnitId: '',
    toUnitId: '',
    supplyType: 'ammunition',
    quantity: '',
  });
  const [transferState, setTransferState] = useState({ pending: false, message: null, failed: false });

  const units = status?.units || [];
  const aggregate = status?.aggregate || [];
  const alerts = status?.alerts || [];
  const recommendations = forecast?.recommendations || [];

  const chart = useMemo(() => buildConsumptionSeries(consumption), [consumption]);

  const timeline = useMemo(
    () =>
      [...units]
        .filter((unit) => unit.hoursToFirstDepletion !== null)
        .sort((a, b) => a.hoursToFirstDepletion - b.hoursToFirstDepletion)
        .slice(0, 8),
    [units]
  );

  const handleTransfer = async (event) => {
    event.preventDefault();
    setTransferState({ pending: true, message: null, failed: false });
    try {
      await api.transferSupply({
        fromUnitId: transfer.fromUnitId,
        toUnitId: transfer.toUnitId,
        supplyType: transfer.supplyType,
        quantity: Number(transfer.quantity),
      });
      setTransferState({ pending: false, message: 'Transfer recorded', failed: false });
      setTransfer((previous) => ({ ...previous, quantity: '' }));
      onRefresh?.();
    } catch (err) {
      setTransferState({ pending: false, message: err.message, failed: true });
    }
  };

  const updateTransfer = (field) => (event) =>
    setTransfer((previous) => ({ ...previous, [field]: event.target.value }));

  return (
    <div className="supply-panel">
      <header className="supply-panel-header">
        <h3>Supply</h3>
        {status && <StatusBadge status={status.overallStatus} />}
        <button type="button" onClick={onRefresh} disabled={loading}>
          Refresh
        </button>
      </header>

      {loading && !status && <p>Loading supply status...</p>}
      {error && <p className="supply-panel-error">{error}</p>}

      {alerts.length > 0 && (
        <section className="supply-alerts">
          <h4>Resupply alerts</h4>
          <ul>
            {alerts.slice(0, 6).map((alert) => (
              <li
                key={`${alert.unitId}-${alert.supplyType}`}
                className={`supply-alert supply-alert-${alert.severity}`}
              >
                {alert.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      {aggregate.length > 0 && (
        <section className="supply-aggregate">
          <h4>Aggregate levels</h4>
          {aggregate.map((entry) => (
            <SupplyBar key={entry.supplyType} supply={entry} />
          ))}
        </section>
      )}

      {chart.datasets.length > 0 && (
        <section className="supply-consumption">
          <AnalysisChart
            title={`Consumption (last ${CHART_HOURS}h)`}
            labels={chart.labels}
            datasets={chart.datasets}
          />
        </section>
      )}

      {timeline.length > 0 && (
        <section className="supply-timeline">
          <h4>Depletion forecast</h4>
          <ul>
            {timeline.map((unit) => (
              <li key={unit.unitId}>
                <span className="supply-timeline-unit">{unit.name}</span>
                <StatusBadge status={unit.status} />
                <span className="supply-timeline-eta">
                  {formatHours(unit.hoursToFirstDepletion)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recommendations.length > 0 && (
        <section className="supply-recommendations">
          <h4>Recommended resupply</h4>
          <ul>
            {recommendations.slice(0, 5).map((recommendation) => (
              <li key={recommendation.unitId}>
                <strong>{recommendation.unitName}</strong> ({recommendation.priority}):{' '}
                {recommendation.items
                  .map((item) => `${item.quantity} ${item.unitOfMeasure} ${item.supplyType}`)
                  .join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {units.length > 0 && (
        <section className="supply-units">
          <h4>By unit</h4>
          {units.map((unit) => (
            <article key={unit.unitId} className="supply-unit">
              <header>
                <strong>{unit.name}</strong>
                {unit.callsign && <span className="supply-unit-callsign"> {unit.callsign}</span>}
                <StatusBadge status={unit.status} />
              </header>
              {unit.supplies.map((supply) => (
                <SupplyBar key={supply.supplyType} supply={supply} />
              ))}
            </article>
          ))}
        </section>
      )}

      <section className="supply-transfer">
        <h4>Transfer supplies</h4>
        <form onSubmit={handleTransfer}>
          <label>
            From
            <select value={transfer.fromUnitId} onChange={updateTransfer('fromUnitId')} required>
              <option value="">Select unit</option>
              {units.map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            To
            <select value={transfer.toUnitId} onChange={updateTransfer('toUnitId')} required>
              <option value="">Select unit</option>
              {units.map((unit) => (
                <option key={unit.unitId} value={unit.unitId}>
                  {unit.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select value={transfer.supplyType} onChange={updateTransfer('supplyType')}>
              {(status?.supplyTypes || Object.keys(SUPPLY_COLORS)).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity
            <input
              type="number"
              min="1"
              step="any"
              value={transfer.quantity}
              onChange={updateTransfer('quantity')}
              required
            />
          </label>
          <button type="submit" disabled={transferState.pending}>
            {transferState.pending ? 'Transferring...' : 'Transfer'}
          </button>
        </form>
        {transferState.message && (
          <p className={transferState.failed ? 'supply-panel-error' : 'supply-panel-success'}>
            {transferState.message}
          </p>
        )}
      </section>
    </div>
  );
}
