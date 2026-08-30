import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeKPIs,
  computeBDA,
  computeHeatmap,
  computeAllHeatmaps,
  HEATMAP_TYPES,
  EVENT_TYPES,
} from '../analytics/engine.js';
import { recordEvent, getRecentEvents, clearEvents } from '../analytics/store.js';

const now = Date.now();

const units = [
  {
    id: 'f1',
    side: 'friendly',
    type: 'infantry',
    strength: 80,
    maxStrength: 100,
    readiness: 70,
    morale: 60,
    status: 'active',
    position: { lat: 10, lng: 20 },
    supplyLevel: 30,
    commsStatus: 'degraded',
  },
  {
    id: 'f2',
    side: 'friendly',
    type: 'armor',
    strength: 0,
    maxStrength: 50,
    readiness: 0,
    morale: 10,
    status: 'destroyed',
    position: { lat: 10.02, lng: 20.02 },
  },
  {
    id: 'e1',
    side: 'enemy',
    type: 'infantry',
    strength: 40,
    maxStrength: 100,
    position: { lat: 10.05, lng: 20.05 },
  },
];

const events = [
  { id: 'ev1', type: EVENT_TYPES.CASUALTY, unitId: 'f1', severity: 5, timestamp: now - 1000, position: { lat: 10, lng: 20 } },
  { id: 'ev2', type: EVENT_TYPES.CASUALTY, unitId: 'f1', severity: 10, timestamp: now, position: { lat: 10, lng: 20 } },
  { id: 'ev3', type: EVENT_TYPES.ENEMY_CONTACT, unitId: 'f1', severity: 1, timestamp: now, position: { lat: 10.01, lng: 20.01 } },
  { id: 'ev4', type: EVENT_TYPES.UNIT_DESTROYED, unitId: 'f2', severity: 1, timestamp: now, position: { lat: 10.02, lng: 20.02 } },
];

describe('analytics engine', () => {
  it('computes headline KPIs from units and events', () => {
    const kpis = computeKPIs(units, events);

    expect(kpis.friendlyStrength).toBe(80);
    expect(kpis.enemyStrength).toBe(40);
    expect(kpis.friendlyReadiness).toBeCloseTo(35, 0); // avg of 70 and 0
    expect(kpis.combatEffectiveness).toBeGreaterThan(0);
    expect(kpis.casualtyRate).toBeGreaterThan(0);
    expect(['increasing', 'decreasing', 'stable']).toContain(kpis.casualtyTrend);
    expect(kpis.missionProgress).toBeGreaterThanOrEqual(0);
  });

  it('handles empty units/events without throwing', () => {
    const kpis = computeKPIs([], []);
    expect(kpis.friendlyStrength).toBe(0);
    expect(kpis.combatEffectiveness).toBe(0);
    expect(kpis.casualtyTrend).toBe('stable');
  });

  it('computes per-unit BDA with severity classification and totals', () => {
    const bda = computeBDA(units, events);

    const f1 = bda.units.find((u) => u.unitId === 'f1');
    expect(f1.casualties).toBe(20);
    expect(f1.lossPercent).toBe(20);
    expect(f1.severity).toBe('moderate');

    const f2 = bda.units.find((u) => u.unitId === 'f2');
    expect(f2.status).toBe('destroyed');
    expect(f2.lossPercent).toBe(100);
    expect(f2.severity).toBe('critical');

    expect(bda.summary.unitsDestroyed).toBe(1);
    expect(bda.summary.friendlyDamage).toBe(70);
    expect(bda.summary.enemyDamage).toBe(60);
  });

  it('computes a single spatial heatmap grid', () => {
    const heatmap = computeHeatmap(units, events, HEATMAP_TYPES.CASUALTY, { cellSize: 1 });
    expect(heatmap.type).toBe(HEATMAP_TYPES.CASUALTY);
    expect(heatmap.cells.length).toBeGreaterThan(0);
    expect(heatmap.cells[0]).toHaveProperty('intensity');
  });

  it('rejects unknown heatmap types', () => {
    expect(() => computeHeatmap(units, events, 'not-a-real-type')).toThrow();
  });

  it('computes all 7 supported heatmap types', () => {
    const heatmaps = computeAllHeatmaps(units, events);
    expect(Object.keys(heatmaps).sort()).toEqual(Object.values(HEATMAP_TYPES).sort());
    expect(Object.keys(heatmaps)).toHaveLength(7);
  });

  it('computes supply vulnerability and comms blackout heatmaps from unit state', () => {
    const supply = computeHeatmap(units, events, HEATMAP_TYPES.SUPPLY_VULNERABILITY);
    expect(supply.cells.length).toBeGreaterThan(0);

    const comms = computeHeatmap(units, events, HEATMAP_TYPES.COMMS_BLACKOUT);
    expect(comms.cells.length).toBeGreaterThan(0);
  });
});

describe('analytics event store', () => {
  beforeEach(() => clearEvents());

  it('buffers recorded events and returns them in order', () => {
    recordEvent({ id: '1', type: EVENT_TYPES.CASUALTY });
    recordEvent({ id: '2', type: EVENT_TYPES.ENEMY_CONTACT });

    const recent = getRecentEvents();
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe('1');
    expect(recent[1].id).toBe('2');
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i += 1) {
      recordEvent({ id: String(i), type: EVENT_TYPES.CASUALTY });
    }
    expect(getRecentEvents(2)).toHaveLength(2);
  });
});
