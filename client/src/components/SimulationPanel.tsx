import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CounterPlanResult,
  LatLon,
  SimulationEvent,
  TacticalSimEvent,
  TacticalUnit,
} from '../types';

interface Props {
  aoCenter: LatLon | null;
  units: TacticalUnit[];
  onUnitsChange: (units: TacticalUnit[]) => void;
  counterPlan: CounterPlanResult | null;
  /** Forwards combat events so the comms subsystem can raise automatic radio traffic. */
  onTacticalEvent?: (event: TacticalSimEvent) => void;
}

const TICK_MS = 1000;
const STEP_DEG = 0.0015; // per-tick movement step (~150m) for real-time simulation

function distanceDeg(a: LatLon, b: LatLon): number {
  return Math.hypot(a.lat - b.lat, a.lon - b.lon);
}

function moveToward(from: LatLon, to: LatLon, step: number): LatLon {
  const d = distanceDeg(from, to);
  if (d <= step || d === 0) return to;
  const ratio = step / d;
  return { lat: from.lat + (to.lat - from.lat) * ratio, lon: from.lon + (to.lon - from.lon) * ratio };
}

function buildDefaultUnits(center: LatLon): TacticalUnit[] {
  const friendlyStart = { lat: center.lat - 0.03, lon: center.lon - 0.03 };
  const enemyStart = { lat: center.lat + 0.03, lon: center.lon + 0.03 };
  return [
    {
      id: 'friendly-1',
      name: 'Alpha Company (Blocking Position)',
      affiliation: 'friendly',
      sidc: 'SFGPUCI----D', // Friendly Ground Infantry
      position: friendlyStart,
      route: [friendlyStart, center],
      status: 'active',
      strength: 100,
    },
    {
      id: 'enemy-1',
      name: 'Enemy Mechanized Company (Suspected)',
      affiliation: 'hostile',
      sidc: 'SHGPUCA----D', // Hostile Ground Armor/Mechanized
      position: enemyStart,
      route: [enemyStart, center],
      status: 'active',
      strength: 90,
    },
  ];
}

export default function SimulationPanel({
  aoCenter,
  units,
  onUnitsChange,
  counterPlan,
  onTacticalEvent,
}: Props) {
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<SimulationEvent[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unitsRef = useRef(units);
  unitsRef.current = units;

  const log = useCallback((message: string) => {
    setEvents((prev) => [{ timestamp: Date.now(), message }, ...prev].slice(0, 50));
  }, []);

  const initializeUnits = () => {
    if (!aoCenter) return;
    const defaults = buildDefaultUnits(aoCenter);
    onUnitsChange(defaults);
    setEvents([]);
    log('Simulation initialized: friendly and enemy forces deployed to start positions.');
  };

  const eventSinkRef = useRef(onTacticalEvent);
  eventSinkRef.current = onTacticalEvent;

  const tick = useCallback(() => {
    const current = unitsRef.current;
    if (current.length === 0) return;

    const next = current.map((unit) => {
      if (unit.status !== 'active' || unit.route.length === 0) return unit;
      const target = unit.route[unit.route.length - 1];
      const position = moveToward(unit.position, target, STEP_DEG);
      return { ...unit, position };
    });

    // Check for engagements: friendly vs hostile units within contact range
    const contactRangeDeg = 0.01;
    let engagementOccurred = false;
    for (const friendly of next.filter((u) => u.affiliation === 'friendly' && u.status === 'active')) {
      for (const hostile of next.filter((u) => u.affiliation === 'hostile' && u.status === 'active')) {
        if (distanceDeg(friendly.position, hostile.position) < contactRangeDeg) {
          engagementOccurred = true;
          const friendlyIdx = next.indexOf(friendly);
          const hostileIdx = next.indexOf(hostile);
          const friendlyDamage = Math.round(5 + Math.random() * 10);
          const hostileDamage = Math.round(5 + Math.random() * 10);
          next[friendlyIdx] = {
            ...friendly,
            status: 'engaged',
            strength: Math.max(0, friendly.strength - friendlyDamage),
          };
          next[hostileIdx] = {
            ...hostile,
            status: 'engaged',
            strength: Math.max(0, hostile.strength - hostileDamage),
          };
          if (next[friendlyIdx].strength === 0) next[friendlyIdx].status = 'destroyed';
          if (next[hostileIdx].strength === 0) next[hostileIdx].status = 'destroyed';

          eventSinkRef.current?.({
            kind: 'CONTACT',
            unitId: hostile.id,
            unitName: hostile.name,
            affiliation: hostile.affiliation,
            position: hostile.position,
            detail: `${friendly.name} in contact with ${hostile.name}.`,
          });
          eventSinkRef.current?.({
            kind: 'CASUALTY',
            unitId: friendly.id,
            unitName: friendly.name,
            affiliation: friendly.affiliation,
            position: friendly.position,
            casualties: friendlyDamage,
            detail: `${friendly.name} sustained ${friendlyDamage} casualties.`,
          });
          if (next[friendlyIdx].status === 'destroyed') {
            eventSinkRef.current?.({
              kind: 'DESTROYED',
              unitId: friendly.id,
              unitName: friendly.name,
              affiliation: friendly.affiliation,
              position: friendly.position,
              detail: `${friendly.name} is combat ineffective.`,
            });
          }

          const tactic = counterPlan?.matchedDoctrine[0]?.tactics[0];
          log(
            `CONTACT: ${friendly.name} engaged ${hostile.name}. ` +
              `${hostile.name} suffered ${hostileDamage} casualties, ${friendly.name} suffered ${friendlyDamage} casualties.` +
              (tactic ? ` Enemy is executing doctrine: "${tactic}".` : '')
          );
        }
      }
    }

    if (!engagementOccurred) {
      const movingUnits = next.filter((u) => u.status === 'active');
      if (movingUnits.length > 0 && Math.random() < 0.2) {
        const unit = movingUnits[Math.floor(Math.random() * movingUnits.length)];
        if (unit.affiliation === 'hostile') {
          const action = counterPlan?.matchedDoctrine[0]?.tactics[
            Math.floor(Math.random() * (counterPlan?.matchedDoctrine[0]?.tactics.length || 1))
          ];
          log(`${unit.name} continues to advance.${action ? ` Assessed intent: ${action}` : ''}`);
          eventSinkRef.current?.({
            kind: 'ADVANCE',
            unitId: unit.id,
            unitName: unit.name,
            affiliation: unit.affiliation,
            position: unit.position,
            detail: `${unit.name} continues to advance.`,
          });
        }
      }
    }

    onUnitsChange(next);
  }, [counterPlan, log, onUnitsChange]);

  const togglePlay = () => {
    if (running) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      setRunning(false);
      log('Simulation paused.');
    } else {
      if (units.length === 0) initializeUnits();
      tickRef.current = setInterval(tick, TICK_MS);
      setRunning(true);
      log('Simulation started.');
    }
  };

  useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  return (
    <div className="simulation-panel">
      <h2>Real-Time Tactical Simulation</h2>
      <p className="panel-subtitle">NATO APP-6D symbology, real-time movement &amp; engagement resolution</p>

      <div className="terrain-actions">
        <button className="action-btn" onClick={initializeUnits} disabled={!aoCenter}>
          Deploy Forces to AO
        </button>
        <button className="action-btn play-btn" onClick={togglePlay} disabled={units.length === 0}>
          {running ? '⏸ Pause' : '▶ Play'}
        </button>
      </div>
      {!aoCenter && <p className="hint-text">Define an operational area first to deploy forces.</p>}

      <div className="unit-status-list">
        <h3>Unit Status</h3>
        <table>
          <thead>
            <tr>
              <th>Unit</th>
              <th>Affiliation</th>
              <th>Status</th>
              <th>Strength</th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.id} className={`affiliation-${u.affiliation}`}>
                <td>{u.name}</td>
                <td>{u.affiliation}</td>
                <td>{u.status}</td>
                <td>{u.strength}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="narration-log">
        <h3>Narration &amp; Enemy Action Log</h3>
        <ul>
          {events.map((e, i) => (
            <li key={i}>
              <span className="event-time">{new Date(e.timestamp).toLocaleTimeString()}</span> {e.message}
            </li>
          ))}
          {events.length === 0 && <li>No events yet. Press Play to begin simulation.</li>}
        </ul>
      </div>
    </div>
  );
}
