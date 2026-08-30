import React, { useCallback, useEffect, useRef, useState } from 'react';

const BASE_LAT = 34.05;
const BASE_LNG = -118.25;

function jitter(value, amount = 0.03) {
  return value + (Math.random() - 0.5) * amount;
}

function seedUnits() {
  return [
    { id: 'f-1', side: 'friendly', type: 'infantry', name: '1st Platoon', strength: 100, maxStrength: 100, readiness: 90, morale: 85, status: 'active', supplyLevel: 90, commsStatus: 'normal', position: { lat: jitter(BASE_LAT), lng: jitter(BASE_LNG) } },
    { id: 'f-2', side: 'friendly', type: 'armor', name: '2nd Armor', strength: 60, maxStrength: 60, readiness: 85, morale: 80, status: 'active', supplyLevel: 70, commsStatus: 'normal', position: { lat: jitter(BASE_LAT), lng: jitter(BASE_LNG) } },
    { id: 'f-3', side: 'friendly', type: 'support', name: 'Fire Support', strength: 30, maxStrength: 30, readiness: 95, morale: 90, status: 'active', supplyLevel: 80, commsStatus: 'normal', position: { lat: jitter(BASE_LAT), lng: jitter(BASE_LNG) } },
    { id: 'e-1', side: 'enemy', type: 'infantry', name: 'Hostile Element A', strength: 80, maxStrength: 80, status: 'active', position: { lat: jitter(BASE_LAT, 0.06), lng: jitter(BASE_LNG, 0.06) } },
    { id: 'e-2', side: 'enemy', type: 'armor', name: 'Hostile Element B', strength: 40, maxStrength: 40, status: 'active', position: { lat: jitter(BASE_LAT, 0.06), lng: jitter(BASE_LNG, 0.06) } },
  ];
}

const EVENT_LABELS = {
  casualty: 'Casualty Report',
  enemy_contact: 'Enemy Contact',
  unit_destroyed: 'Unit Destroyed',
};

/**
 * Simulates an active tactical operation: maintains a small friendly/enemy
 * unit roster and emits structured tactical events (casualty reports, enemy
 * contact, unit destroyed) that are streamed to the backend analytics engine
 * via the `onEvent` callback, and reflects current unit state via
 * `onUnitsChange` so other panels (Analytics, Map) can consume it live.
 */
export default function SimulationPanel({ onEvent, onUnitsChange }) {
  const [units, setUnits] = useState(seedUnits);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState([]);
  const unitsRef = useRef(units);
  unitsRef.current = units;

  useEffect(() => {
    onUnitsChange?.(units);
  }, [units, onUnitsChange]);

  const emitEvent = useCallback(
    (event) => {
      const enriched = { ...event, timestamp: new Date().toISOString() };
      setLog((prev) => [enriched, ...prev].slice(0, 50));
      onEvent?.(enriched);
    },
    [onEvent]
  );

  const applyCasualty = useCallback(
    (unitId, severity) => {
      setUnits((prev) =>
        prev.map((unit) => {
          if (unit.id !== unitId || unit.status === 'destroyed') return unit;
          const strength = Math.max(0, unit.strength - severity);
          const destroyed = strength <= 0;
          return {
            ...unit,
            strength,
            status: destroyed ? 'destroyed' : unit.status,
            readiness: unit.readiness != null ? Math.max(0, unit.readiness - severity) : unit.readiness,
            morale: unit.morale != null ? Math.max(0, unit.morale - severity / 2) : unit.morale,
          };
        })
      );
    },
    []
  );

  const reportCasualty = useCallback(
    (unit) => {
      const severity = 5 + Math.floor(Math.random() * 10);
      applyCasualty(unit.id, severity);
      emitEvent({
        type: 'casualty',
        unitId: unit.id,
        side: unit.side,
        severity,
        position: unit.position,
        details: `${unit.name} took ${severity} casualties`,
      });
    },
    [applyCasualty, emitEvent]
  );

  const reportEnemyContact = useCallback(
    (unit) => {
      emitEvent({
        type: 'enemy_contact',
        unitId: unit.id,
        side: unit.side,
        severity: 1,
        position: unit.position,
        details: `${unit.name} made contact with hostile forces`,
      });
    },
    [emitEvent]
  );

  const reportUnitDestroyed = useCallback(
    (unit) => {
      setUnits((prev) => prev.map((u) => (u.id === unit.id ? { ...u, strength: 0, status: 'destroyed' } : u)));
      emitEvent({
        type: 'unit_destroyed',
        unitId: unit.id,
        side: unit.side,
        severity: 1,
        position: unit.position,
        details: `${unit.name} was destroyed`,
      });
    },
    [emitEvent]
  );

  // Autoplay: every 3s while running, generate a random casualty or contact
  // event against a random active unit to simulate a live operation.
  useEffect(() => {
    if (!running) return undefined;

    const interval = setInterval(() => {
      const active = unitsRef.current.filter((u) => u.status !== 'destroyed');
      if (active.length === 0) return;
      const unit = active[Math.floor(Math.random() * active.length)];
      if (Math.random() < 0.7) {
        reportCasualty(unit);
      } else {
        reportEnemyContact(unit);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [running, reportCasualty, reportEnemyContact]);

  const reset = () => {
    setRunning(false);
    setUnits(seedUnits());
    setLog([]);
  };

  return (
    <div className="simulation-panel">
      <div className="simulation-panel-header">
        <h3>Simulation</h3>
        <div className="simulation-panel-controls">
          <button onClick={() => setRunning((r) => !r)}>{running ? 'Pause' : 'Start'}</button>
          <button className="link-button" onClick={reset}>Reset</button>
        </div>
      </div>

      <table className="simulation-unit-table">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Side</th>
            <th>Strength</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit) => (
            <tr key={unit.id} className={unit.status === 'destroyed' ? 'unit-destroyed' : ''}>
              <td>{unit.name}</td>
              <td>{unit.side}</td>
              <td>{unit.strength}/{unit.maxStrength}</td>
              <td>{unit.status}</td>
              <td className="simulation-unit-actions">
                <button disabled={unit.status === 'destroyed'} onClick={() => reportCasualty(unit)}>
                  Casualty
                </button>
                <button disabled={unit.status === 'destroyed'} onClick={() => reportEnemyContact(unit)}>
                  Contact
                </button>
                <button disabled={unit.status === 'destroyed'} onClick={() => reportUnitDestroyed(unit)}>
                  Destroyed
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="simulation-event-log">
        <h4>Event Log</h4>
        <ul>
          {log.map((event, index) => (
            <li key={index}>
              <strong>{EVENT_LABELS[event.type] || event.type}</strong> — {event.details}
            </li>
          ))}
          {log.length === 0 && <li>No events yet. Start the simulation or report an event.</li>}
        </ul>
      </div>
    </div>
  );
}
