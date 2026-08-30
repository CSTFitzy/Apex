import { describe, it, expect } from 'vitest';
import { computeKpis, computeBda, summarizeBda, computeHeatmaps, computeHeatmap, HEATMAP_TYPES } from '../analytics/tactical.js';

const units = [
  { id: 1, side: 'friendly', type: 'infantry', latitude: 10, longitude: 20, health: 100, status: 'active' },
  { id: 2, side: 'friendly', type: 'armor', latitude: 11, longitude: 21, health: 0, status: 'destroyed' },
  { id: 3, side: 'hostile', type: 'infantry', latitude: 12, longitude: 22, health: 40, status: 'damaged' },
  { id: 4, side: 'hostile', type: 'artillery', latitude: 13, longitude: 23, health: 0, status: 'destroyed' },
];

const events = [
  {
    id: 'evt-1',
    timestamp: '2024-01-01T00:00:00.000Z',
    sourceUnitId: 1,
    sourceCallsign: 'BLUE-001',
    sourceSide: 'friendly',
    targetUnitId: 4,
    targetCallsign: 'RED-004',
    targetSide: 'hostile',
    targetType: 'artillery',
    damageType: 'destroyed',
    damage: 100,
    confidence: 'confirmed',
    latitude: 13,
    longitude: 23,
  },
  {
    id: 'evt-2',
    timestamp: '2024-01-01T00:01:00.000Z',
    sourceUnitId: 3,
    sourceCallsign: 'RED-003',
    sourceSide: 'hostile',
    targetUnitId: 2,
    targetCallsign: 'BLUE-002',
    targetSide: 'friendly',
    targetType: 'armor',
    damageType: 'destroyed',
    damage: 100,
    confidence: 'confirmed',
    latitude: 11,
    longitude: 21,
  },
];

describe('computeKpis', () => {
  it('summarizes friendly/hostile strength and losses', () => {
    const kpis = computeKpis({ units, events });
    expect(kpis.unitsTotal).toBe(4);
    expect(kpis.friendlyUnits).toBe(2);
    expect(kpis.hostileUnits).toBe(2);
    expect(kpis.friendlyLosses).toBe(1);
    expect(kpis.hostileLosses).toBe(1);
    expect(kpis.killRatio).toBe(1);
    expect(kpis.engagementsTotal).toBe(2);
    expect(kpis.engagementsDestroyed).toBe(2);
    expect(kpis.operationalReadiness).toBe(50);
  });

  it('handles an empty simulation state', () => {
    const kpis = computeKpis({});
    expect(kpis.unitsTotal).toBe(0);
    expect(kpis.killRatio).toBe(0);
    expect(kpis.operationalReadiness).toBe(0);
  });
});

describe('computeBda / summarizeBda', () => {
  it('returns BDA rows newest-first', () => {
    const bda = computeBda({ events });
    expect(bda).toHaveLength(2);
    expect(bda[0].id).toBe('evt-2');
    expect(bda[1].id).toBe('evt-1');
  });

  it('summarizes counts by damage type and confidence', () => {
    const summary = summarizeBda(computeBda({ events }));
    expect(summary.total).toBe(2);
    expect(summary.byDamageType.destroyed).toBe(2);
    expect(summary.byConfidence.confirmed).toBe(2);
  });
});

describe('computeHeatmaps', () => {
  it('produces all 7 tactical heatmap layers', () => {
    const heatmaps = computeHeatmaps({ units, events });
    expect(HEATMAP_TYPES).toHaveLength(7);
    for (const type of HEATMAP_TYPES) {
      expect(Array.isArray(heatmaps[type])).toBe(true);
    }
    expect(heatmaps['friendly-units']).toHaveLength(2);
    expect(heatmaps['hostile-units']).toHaveLength(2);
    expect(heatmaps.destroyed).toHaveLength(2);
  });

  it('computeHeatmap returns null for unknown types', () => {
    expect(computeHeatmap('not-a-real-type', { units, events })).toBeNull();
    expect(computeHeatmap('destroyed', { units, events })).toHaveLength(2);
  });
});
