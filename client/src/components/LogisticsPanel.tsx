import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import type {
  AllocationResult,
  DatabaseOptimizationStatus,
  ResupplyPlan,
  SupplyDepot,
  SupplyForecast,
  TacticalUnit,
} from '../types';

interface Props {
  units: TacticalUnit[];
}

function pct(quantity: number, max: number) {
  return max <= 0 ? 0 : Math.round((quantity / max) * 100);
}

function km(meters: number) {
  return `${(meters / 1000).toFixed(1)} km`;
}

export default function LogisticsPanel({ units }: Props) {
  const [depots, setDepots] = useState<SupplyDepot[]>([]);
  const [forecast, setForecast] = useState<SupplyForecast | null>(null);
  const [allocation, setAllocation] = useState<AllocationResult | null>(null);
  const [resupply, setResupply] = useState<ResupplyPlan | null>(null);
  const [dbStatus, setDbStatus] = useState<DatabaseOptimizationStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedUnit = useMemo(
    () => units.find((unit) => unit.affiliation === 'friendly' && unit.status !== 'destroyed') ?? units[0],
    [units]
  );

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ data: depotData }, { data: statusData }] = await Promise.all([
        api.get<{ depots: SupplyDepot[] }>('/supply/depots'),
        api.get<DatabaseOptimizationStatus>('/database/optimization/status'),
      ]);
      setDepots(depotData.depots);
      setDbStatus(statusData);
    } catch (err) {
      setError('Unable to load logistics data from the server.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!selectedUnit) return;
    api
      .post<SupplyForecast>('/supply/forecast', {
        unitId: selectedUnit.id,
        unitName: selectedUnit.name,
        combatIntensity: selectedUnit.status === 'engaged' ? 1.8 : 1,
        currentInventory: {
          Ammo: Math.max(200, selectedUnit.strength * 18),
          Fuel: Math.max(150, selectedUnit.route.length * 180),
          Medical: Math.max(80, selectedUnit.strength * 3),
          Rations: selectedUnit.strength * 6,
          Water: selectedUnit.strength * 8,
        },
        consumptionRates: {
          Ammo: selectedUnit.status === 'engaged' ? 500 : 120,
          Fuel: selectedUnit.route.length > 0 ? 90 : 30,
          Medical: selectedUnit.status === 'engaged' ? 45 : 10,
          Rations: Math.max(1, selectedUnit.strength / 24),
          Water: Math.max(1, selectedUnit.strength / 18),
        },
      })
      .then(({ data }) => setForecast(data))
      .catch((err) => {
        setError('Unable to calculate logistics forecast.');
        console.error(err);
      });
  }, [selectedUnit]);

  const runAllocation = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<AllocationResult>('/supply/allocate', {
        availableSupplies: { Ammo: 9000, Fuel: 6000, Medical: 2200, Rations: 5000, Water: 6500 },
        transportCapacity: 11000,
        units: units
          .filter((unit) => unit.affiliation === 'friendly')
          .map((unit) => ({
            unitId: unit.id,
            unitName: unit.name,
            priority: unit.status === 'engaged' ? 90 : 60,
            inContact: unit.status === 'engaged',
            personnel: unit.strength,
            requested: {
              Ammo: unit.status === 'engaged' ? 2500 : 900,
              Fuel: unit.route.length > 0 ? 1400 : 400,
              Medical: unit.status === 'engaged' ? 800 : 250,
              Rations: unit.strength * 2,
              Water: unit.strength * 3,
            },
          })),
      });
      setAllocation(data);
    } catch (err) {
      setError('Unable to optimize resource allocation.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const requestResupply = async () => {
    if (!selectedUnit) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.post<ResupplyPlan>('/supply/request', {
        unitId: selectedUnit.id,
        unitName: selectedUnit.name,
        location: selectedUnit.position,
        supplyType: selectedUnit.status === 'engaged' ? 'Ammo' : 'Fuel',
        quantity: selectedUnit.status === 'engaged' ? 1200 : 700,
        priority: selectedUnit.status === 'engaged' ? 'EMERGENCY' : 'NORMAL',
      });
      setResupply(data);
    } catch (err) {
      setError('Unable to request resupply.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="logistics-panel">
      <h2>Supply Chain &amp; Logistics</h2>
      <p className="panel-subtitle">
        PostGIS depot coverage, Timescale-ready history, Redis-cached status, and Neo4j supply-chain model metadata.
      </p>

      {error && <p className="error-text">{error}</p>}
      {loading && <p className="hint-text">Updating logistics picture...</p>}

      <div className="terrain-actions">
        <button className="action-btn" onClick={refresh}>Refresh</button>
        <button className="action-btn secondary" onClick={requestResupply} disabled={!selectedUnit}>
          Request Resupply
        </button>
        <button className="action-btn secondary" onClick={runAllocation} disabled={units.length === 0}>
          Optimize Allocation
        </button>
      </div>

      <section className="logistics-section">
        <h3>Optimized Database Stack</h3>
        {dbStatus ? (
          <div className="logistics-grid">
            {[
              ['PostGIS', dbStatus.postgis],
              ['TimescaleDB', dbStatus.timescaledb],
              ['pgRouting', dbStatus.pgrouting],
              ['Neo4j', dbStatus.neo4jConfigured],
            ].map(([label, enabled]) => (
              <div key={String(label)} className={`logistics-chip ${enabled ? 'ready' : 'standby'}`}>
                {label}: {enabled ? 'Ready' : 'Standby'}
              </div>
            ))}
          </div>
        ) : (
          <p className="stats-empty">Database optimization status not loaded.</p>
        )}
      </section>

      <section className="logistics-section">
        <h3>Supply Depots</h3>
        {depots.map((depot) => (
          <div key={depot.id} className="doctrine-card depot-card">
            <h4>{depot.name}</h4>
            <p>Status: {depot.status} · Security: {depot.securityLevel}%</p>
            {depot.inventory.map((item) => (
              <div key={item.supplyType} className="inventory-row">
                <span>{item.supplyType}</span>
                <div className="inventory-bar">
                  <div style={{ width: `${pct(item.quantity, item.maxQuantity)}%` }} />
                </div>
                <span>{pct(item.quantity, item.maxQuantity)}%</span>
              </div>
            ))}
          </div>
        ))}
      </section>

      {forecast && (
        <section className="logistics-section">
          <h3>Forecast: {forecast.unitName}</h3>
          <p>Logistics health: <strong>{forecast.logisticsHealthPct}%</strong></p>
          <table>
            <thead>
              <tr><th>Supply</th><th>Rate/hr</th><th>Depletion</th><th>Warning</th></tr>
            </thead>
            <tbody>
              {forecast.projections.map((projection) => (
                <tr key={projection.supplyType}>
                  <td>{projection.supplyType}</td>
                  <td>{projection.hourlyConsumption}</td>
                  <td>{projection.depletionHours ?? 'Stable'}h</td>
                  <td>{projection.warning ?? 'OK'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {resupply && (
        <section className="logistics-section">
          <h3>Convoy Plan</h3>
          <p>{resupply.requestId} from {resupply.depot.name}</p>
          <ul>
            <li>Distance: {km(resupply.route.distanceM)}</li>
            <li>ETA: {resupply.route.etaMinutes} minutes</li>
            <li>Fuel cost: {resupply.route.fuelCostLiters} L</li>
            <li>Supply line risk: {resupply.route.riskLevel}</li>
          </ul>
          {resupply.warnings.map((warning) => <p key={warning} className="error-text">{warning}</p>)}
        </section>
      )}

      {allocation && (
        <section className="logistics-section">
          <h3>Resource Allocation</h3>
          <p>Transport utilization: {allocation.transportUtilizationPct}%</p>
          <table>
            <thead>
              <tr><th>Unit</th><th>Supply</th><th>Alloc.</th><th>Effect</th></tr>
            </thead>
            <tbody>
              {allocation.allocations.slice(0, 12).map((item) => (
                <tr key={`${item.unitId}-${item.supplyType}`}>
                  <td>{item.unitName}</td>
                  <td>{item.supplyType}</td>
                  <td>{item.allocatedQuantity}/{item.requestedQuantity}</td>
                  <td>{item.effectivenessPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
