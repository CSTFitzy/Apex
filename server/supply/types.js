/**
 * Supply chain domain constants.
 *
 * Shared by the forecasting engine, the route planner and the `/api/supply`
 * routes so that supply type names, thresholds and status labels stay
 * consistent across the backend (and, via the API payloads, the frontend).
 */

/** Canonical supply types tracked for every unit. */
export const SUPPLY_TYPES = ['ammunition', 'fuel', 'rations', 'medical'];

/** Human readable unit of measure per supply type. */
export const SUPPLY_UNITS = {
  ammunition: 'rounds',
  fuel: 'liters',
  rations: 'day-rations',
  medical: 'kits',
};

/**
 * Default per-unit capacity and hourly consumption rate, used when seeding a
 * new unit. Rates are expressed per hour of active operations.
 */
export const SUPPLY_DEFAULTS = {
  ammunition: { capacity: 5000, consumptionRate: 120 },
  fuel: { capacity: 800, consumptionRate: 35 },
  rations: { capacity: 240, consumptionRate: 6 },
  medical: { capacity: 60, consumptionRate: 1.5 },
};

/**
 * Supply status thresholds as a fraction of capacity (inclusive lower bound).
 * Anything below CRITICAL is also reported as `critical`.
 */
export const SUPPLY_THRESHOLDS = {
  critical: 0.15,
  low: 0.35,
  adequate: 0.85,
};

/** Ordered from worst to best, so an aggregate status can be reduced easily. */
export const SUPPLY_STATUS_ORDER = ['critical', 'low', 'adequate', 'full'];

/** True when `type` is one of the tracked supply types. */
export function isSupplyType(type) {
  return SUPPLY_TYPES.includes(type);
}
