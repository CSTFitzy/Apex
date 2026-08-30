import { describe, expect, it } from 'vitest';
import { calculateDistanceKm, forecastConsumption, optimizeRoute } from '../services/logistics.js';

describe('logistics services', () => {
  const origin = { id: 1, latitude: 0, longitude: 0 };
  const destination = { id: 2, latitude: 0, longitude: 2 };

  it('calculates great-circle distances', () => {
    expect(calculateDistanceKm(origin, origin)).toBe(0);
    expect(calculateDistanceKm(origin, destination)).toBeCloseTo(222.39, 1);
  });

  it('orders waypoints using nearest-neighbour routing', () => {
    const route = optimizeRoute(origin, destination, [
      { id: 3, latitude: 0, longitude: 1.5 },
      { id: 4, latitude: 0, longitude: 0.5 },
    ], 60);
    expect(route.waypoints.map(({ id }) => id)).toEqual([4, 3]);
    expect(route.distanceKm).toBeCloseTo(222.39, 1);
    expect(route.estimatedDurationMinutes).toBe(223);
  });

  it('forecasts consumption and recommends reordering', () => {
    const forecast = forecastConsumption(
      { id: 1, resource_type: 'fuel', quantity: '100', reorder_point: '80' },
      [{ quantity: '20', consumed_at: new Date(Date.now() - 10 * 86400000).toISOString() }],
      7
    );
    expect(forecast.dailyConsumption).toBeCloseTo(2, 1);
    expect(forecast.projectedQuantity).toBeCloseTo(86, 0);
    expect(forecast.reorderRecommended).toBe(false);
  });

  it('rejects an invalid route speed', () => {
    expect(() => optimizeRoute(origin, destination, [], 0)).toThrow('speedKmh must be a positive number');
  });
});
