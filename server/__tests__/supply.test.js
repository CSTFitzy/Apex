import { describe, it, expect } from 'vitest';
import {
  classifySupplyStatus,
  worstStatus,
  hoursToDepletion,
  effectiveConsumptionRate,
  forecastSupplyItem,
  forecastUnit,
  buildAlerts,
  recommendResupply,
  aggregateBySupplyType,
} from '../supply/forecast.js';
import {
  haversineDistanceKm,
  distanceToSegmentKm,
  terrainSpeed,
  planRoute,
  selectDepot,
  planResupplyRoutes,
} from '../supply/routing.js';
import { TTLCache } from '../db/cache.js';

describe('supply forecasting', () => {
  it('classifies supply status against the configured thresholds', () => {
    expect(classifySupplyStatus(100, 100)).toBe('full');
    expect(classifySupplyStatus(50, 100)).toBe('adequate');
    expect(classifySupplyStatus(20, 100)).toBe('low');
    expect(classifySupplyStatus(5, 100)).toBe('critical');
    expect(classifySupplyStatus(10, 0)).toBe('critical');
  });

  it('reduces a set of statuses to the worst one', () => {
    expect(worstStatus(['full', 'adequate', 'low'])).toBe('low');
    expect(worstStatus(['full', 'full'])).toBe('full');
    expect(worstStatus([])).toBe('full');
  });

  it('computes time to depletion', () => {
    expect(hoursToDepletion(100, 10)).toBe(10);
    expect(hoursToDepletion(0, 10)).toBe(0);
    expect(hoursToDepletion(100, 0)).toBeNull();
  });

  it('blends configured and observed consumption rates', () => {
    expect(effectiveConsumptionRate(10)).toBe(10);
    expect(effectiveConsumptionRate(10, 0, 24)).toBe(10);
    // 240 consumed over 24h = 10/h observed, matching the base rate.
    expect(effectiveConsumptionRate(10, 240, 24)).toBeCloseTo(10);
    // A hotter observed tempo dominates the forecast.
    expect(effectiveConsumptionRate(10, 480, 24)).toBeCloseTo(17);
  });

  it('forecasts a single supply line with a depletion timestamp', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const forecast = forecastSupplyItem(
      { supplyType: 'fuel', quantity: 100, capacity: 800, consumptionRate: 25 },
      now
    );

    expect(forecast.percentRemaining).toBe(12.5);
    expect(forecast.status).toBe('critical');
    expect(forecast.hoursToDepletion).toBe(4);
    expect(forecast.depletionAt).toBe('2026-01-01T04:00:00.000Z');
    expect(forecast.resupplyQuantity).toBe(700);
  });

  it('summarises a unit using its worst supply line', () => {
    const unit = forecastUnit({ id: 1, unit_id: 'A-1', name: 'Alpha' }, [
      { supplyType: 'fuel', quantity: 400, capacity: 800, consumptionRate: 40 },
      { supplyType: 'ammunition', quantity: 100, capacity: 5000, consumptionRate: 50 },
    ]);

    expect(unit.unitId).toBe('A-1');
    expect(unit.status).toBe('critical');
    expect(unit.hoursToFirstDepletion).toBe(2);
  });

  it('raises alerts for critical and imminently depleting supplies', () => {
    const units = [
      forecastUnit({ id: 1, unit_id: 'A-1', name: 'Alpha' }, [
        { supplyType: 'fuel', quantity: 40, capacity: 800, consumptionRate: 40 },
        { supplyType: 'rations', quantity: 240, capacity: 240, consumptionRate: 0 },
      ]),
    ];
    const alerts = buildAlerts(units);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      unitId: 'A-1',
      supplyType: 'fuel',
      severity: 'critical',
      status: 'critical',
    });
  });

  it('recommends prioritised resupply sized to capacity', () => {
    const units = [
      forecastUnit({ id: 1, unit_id: 'A-1', name: 'Alpha' }, [
        { supplyType: 'fuel', quantity: 40, capacity: 800, consumptionRate: 40 },
      ]),
      forecastUnit({ id: 2, unit_id: 'B-2', name: 'Bravo' }, [
        { supplyType: 'fuel', quantity: 700, capacity: 800, consumptionRate: 5 },
      ]),
    ];
    const recommendations = recommendResupply(units);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].priority).toBe('immediate');
    expect(recommendations[0].items).toEqual([
      { supplyType: 'fuel', quantity: 760, unitOfMeasure: 'liters' },
    ]);
  });

  it('aggregates totals per supply type across units', () => {
    const units = [
      forecastUnit({ id: 1, unit_id: 'A-1', name: 'Alpha' }, [
        { supplyType: 'fuel', quantity: 400, capacity: 800, consumptionRate: 40 },
      ]),
      forecastUnit({ id: 2, unit_id: 'B-2', name: 'Bravo' }, [
        { supplyType: 'fuel', quantity: 200, capacity: 800, consumptionRate: 10 },
      ]),
    ];
    const [fuel] = aggregateBySupplyType(units);

    expect(fuel.quantity).toBe(600);
    expect(fuel.capacity).toBe(1600);
    expect(fuel.percentRemaining).toBe(37.5);
    expect(fuel.status).toBe('adequate');
    expect(fuel.hoursToDepletion).toBe(12);
  });
});

describe('logistics routing', () => {
  it('measures great-circle distance', () => {
    const distance = haversineDistanceKm(
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 }
    );
    expect(distance).toBeGreaterThan(111);
    expect(distance).toBeLessThan(112);
  });

  it('measures distance from a point to a route leg', () => {
    const distance = distanceToSegmentKm(
      { latitude: 0.1, longitude: 0.5 },
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 }
    );
    expect(distance).toBeGreaterThan(11);
    expect(distance).toBeLessThan(12);
  });

  it('uses terrain-specific convoy speeds', () => {
    expect(terrainSpeed('road')).toBe(60);
    expect(terrainSpeed('mountain')).toBe(12);
    expect(terrainSpeed('unknown-terrain')).toBe(terrainSpeed('open'));
  });

  it('plans a direct route and estimates travel time', () => {
    const route = planRoute({
      from: { latitude: 0, longitude: 0 },
      to: { latitude: 0, longitude: 1 },
      terrain: 'road',
    });

    expect(route.waypoints).toHaveLength(2);
    expect(route.detours).toBe(0);
    expect(route.risk).toBe('low');
    expect(route.travelHours).toBeCloseTo(route.distanceKm / 60, 2);
  });

  it('detours around enemy contact areas', () => {
    const threats = [{ latitude: 0, longitude: 0.5, radiusKm: 20, name: 'Contact Area 1' }];
    const direct = planRoute({
      from: { latitude: 0, longitude: 0 },
      to: { latitude: 0, longitude: 1 },
      terrain: 'road',
    });
    const avoided = planRoute({
      from: { latitude: 0, longitude: 0 },
      to: { latitude: 0, longitude: 1 },
      terrain: 'road',
      threats,
    });

    expect(avoided.detours).toBe(1);
    expect(avoided.avoidedThreats[0].name).toBe('Contact Area 1');
    expect(avoided.distanceKm).toBeGreaterThan(direct.distanceKm);
    expect(avoided.risk).toBe('moderate');
    for (let i = 1; i < avoided.waypoints.length; i += 1) {
      expect(
        distanceToSegmentKm(threats[0], avoided.waypoints[i - 1], avoided.waypoints[i])
      ).toBeGreaterThanOrEqual(20);
    }
  });

  it('selects the closest depot that stocks the requested supplies', () => {
    const depots = [
      { id: 1, name: 'Near', latitude: 0, longitude: 0.1, stock: { fuel: 0 } },
      { id: 2, name: 'Far', latitude: 0, longitude: 0.5, stock: { fuel: 5000 } },
    ];
    const destination = { latitude: 0, longitude: 0 };

    expect(selectDepot(destination, depots, ['fuel']).id).toBe(2);
    expect(selectDepot(destination, depots, []).id).toBe(1);
    expect(selectDepot(destination, [])).toBeNull();
  });

  it('plans resupply routes and flags convoys arriving after depletion', () => {
    const recommendations = [
      {
        unitId: 'A-1',
        unitName: 'Alpha',
        latitude: 0,
        longitude: 0,
        priority: 'immediate',
        hoursToFirstDepletion: 0.5,
        items: [{ supplyType: 'fuel', quantity: 700, unitOfMeasure: 'liters' }],
      },
    ];
    const depots = [{ id: 1, name: 'FSB Anvil', latitude: 0, longitude: 1, stock: { fuel: 9000 } }];

    const [plan] = planResupplyRoutes(recommendations, depots, { terrain: 'road' });

    expect(plan.depot).toEqual({ id: 1, name: 'FSB Anvil' });
    expect(plan.route.travelHours).toBeGreaterThan(1);
    expect(plan.arrivesBeforeDepletion).toBe(false);
  });
});

describe('TTL cache', () => {
  it('returns cached values until they expire', async () => {
    const cache = new TTLCache({ ttlMs: 50 });
    let calls = 0;
    const loader = async () => {
      calls += 1;
      return calls;
    };

    expect(await cache.getOrSet('units', loader)).toBe(1);
    expect(await cache.getOrSet('units', loader)).toBe(1);
    expect(calls).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(await cache.getOrSet('units', loader)).toBe(2);
  });

  it('evicts the least recently used entry when full', () => {
    const cache = new TTLCache({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);

    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('clears all entries', () => {
    const cache = new TTLCache();
    cache.set('a', 1);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.stats().size).toBe(0);
  });
});
