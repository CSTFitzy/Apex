/**
 * Supply consumption forecasting engine.
 *
 * Given a unit's current stock levels and observed consumption rates, this
 * module predicts time-to-depletion per supply type, classifies supply status,
 * raises alerts on critical levels and recommends resupply actions.
 *
 * All functions here are pure so they can be unit tested without a database.
 */
import {
  SUPPLY_STATUS_ORDER,
  SUPPLY_THRESHOLDS,
  SUPPLY_UNITS,
} from './types.js';

/** Fraction of capacity that a resupply should top a unit back up to. */
const RESUPPLY_TARGET_FRACTION = 1;

/** Depletion horizons (hours) used to prioritise resupply recommendations. */
export const RESUPPLY_HORIZONS = {
  immediate: 6,
  urgent: 24,
  routine: 72,
};

/**
 * Classify a stock level as critical / low / adequate / full.
 * @param {number} quantity - Current quantity on hand.
 * @param {number} capacity - Maximum quantity the unit can carry.
 * @returns {'critical'|'low'|'adequate'|'full'}
 */
export function classifySupplyStatus(quantity, capacity) {
  const ratio = capacity > 0 ? Number(quantity) / Number(capacity) : 0;
  if (!Number.isFinite(ratio) || ratio < SUPPLY_THRESHOLDS.critical) return 'critical';
  if (ratio < SUPPLY_THRESHOLDS.low) return 'low';
  if (ratio < SUPPLY_THRESHOLDS.adequate) return 'adequate';
  return 'full';
}

/**
 * Reduce a list of statuses to the worst one present.
 * @param {string[]} statuses
 */
export function worstStatus(statuses) {
  let worst = 'full';
  for (const status of statuses) {
    if (SUPPLY_STATUS_ORDER.indexOf(status) < SUPPLY_STATUS_ORDER.indexOf(worst)) {
      worst = status;
    }
  }
  return worst;
}

/**
 * Hours until a stock level reaches zero at the given hourly burn rate.
 * Returns `null` when nothing is being consumed (i.e. never depletes).
 */
export function hoursToDepletion(quantity, consumptionRate) {
  const qty = Number(quantity);
  const rate = Number(consumptionRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  return qty / rate;
}

/**
 * Blend the configured (planned) consumption rate with the rate actually
 * observed in recent consumption events. Observed data is weighted more
 * heavily so forecasts track the real tempo of operations.
 *
 * @param {number} baseRate - Configured rate in units/hour.
 * @param {number} observedQuantity - Total consumed over the observation window.
 * @param {number} windowHours - Length of the observation window in hours.
 */
export function effectiveConsumptionRate(baseRate, observedQuantity = 0, windowHours = 0) {
  const base = Number.isFinite(Number(baseRate)) ? Math.max(Number(baseRate), 0) : 0;
  if (!windowHours || windowHours <= 0 || !Number.isFinite(Number(observedQuantity))) {
    return base;
  }
  const observedRate = Math.max(Number(observedQuantity), 0) / windowHours;
  if (observedRate <= 0) return base;
  return base * 0.3 + observedRate * 0.7;
}

/**
 * Build a forecast for a single supply line item.
 *
 * @param {object} item
 * @param {string} item.supplyType
 * @param {number} item.quantity
 * @param {number} item.capacity
 * @param {number} item.consumptionRate - Configured units/hour.
 * @param {number} [item.observedQuantity] - Consumed during the window.
 * @param {number} [item.windowHours] - Observation window length in hours.
 * @param {Date|string} [now] - Reference time (defaults to now).
 */
export function forecastSupplyItem(item, now = new Date()) {
  const reference = now instanceof Date ? now : new Date(now);
  const quantity = Number(item.quantity) || 0;
  const capacity = Number(item.capacity) || 0;
  const rate = effectiveConsumptionRate(
    item.consumptionRate,
    item.observedQuantity,
    item.windowHours
  );
  const hours = hoursToDepletion(quantity, rate);
  const status = classifySupplyStatus(quantity, capacity);

  return {
    supplyType: item.supplyType,
    unitOfMeasure: SUPPLY_UNITS[item.supplyType] || 'units',
    quantity,
    capacity,
    percentRemaining: capacity > 0 ? Math.round((quantity / capacity) * 1000) / 10 : 0,
    consumptionRate: Math.round(rate * 100) / 100,
    status,
    hoursToDepletion: hours === null ? null : Math.round(hours * 10) / 10,
    depletionAt:
      hours === null ? null : new Date(reference.getTime() + hours * 3600 * 1000).toISOString(),
    resupplyQuantity: Math.max(
      Math.round((capacity * RESUPPLY_TARGET_FRACTION - quantity) * 10) / 10,
      0
    ),
  };
}

/**
 * Forecast every supply line for a unit and summarise the unit's readiness.
 *
 * @param {object} unit - Unit record (id, unitId, name, latitude, longitude).
 * @param {Array} items - Supply line items for that unit.
 * @param {Date} [now]
 */
export function forecastUnit(unit, items = [], now = new Date()) {
  const supplies = items.map((item) => forecastSupplyItem(item, now));
  const depletionTimes = supplies
    .map((supply) => supply.hoursToDepletion)
    .filter((hours) => hours !== null);

  return {
    unitId: unit.unit_id ?? unit.unitId ?? unit.id,
    id: unit.id,
    name: unit.name,
    callsign: unit.callsign ?? null,
    latitude: unit.latitude ?? null,
    longitude: unit.longitude ?? null,
    status: worstStatus(supplies.map((supply) => supply.status)),
    hoursToFirstDepletion: depletionTimes.length > 0 ? Math.min(...depletionTimes) : null,
    supplies,
  };
}

/**
 * Raise alerts for units whose supplies are critical/low or that will run dry
 * within the routine resupply horizon.
 *
 * @param {Array} unitForecasts - Output of {@link forecastUnit}.
 */
export function buildAlerts(unitForecasts = []) {
  const alerts = [];

  for (const unit of unitForecasts) {
    for (const supply of unit.supplies) {
      const depletingSoon =
        supply.hoursToDepletion !== null && supply.hoursToDepletion <= RESUPPLY_HORIZONS.urgent;

      if (supply.status !== 'critical' && supply.status !== 'low' && !depletingSoon) continue;

      const severity =
        supply.status === 'critical' ||
        (supply.hoursToDepletion !== null &&
          supply.hoursToDepletion <= RESUPPLY_HORIZONS.immediate)
          ? 'critical'
          : 'warning';

      alerts.push({
        unitId: unit.unitId,
        unitName: unit.name,
        supplyType: supply.supplyType,
        status: supply.status,
        severity,
        percentRemaining: supply.percentRemaining,
        hoursToDepletion: supply.hoursToDepletion,
        message:
          `${unit.name} ${supply.supplyType} at ${supply.percentRemaining}%` +
          (supply.hoursToDepletion === null
            ? ' (no consumption recorded)'
            : ` — depletion in ${supply.hoursToDepletion}h`),
      });
    }
  }

  // Most urgent first: critical severity, then soonest depletion.
  return alerts.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    const aHours = a.hoursToDepletion ?? Number.POSITIVE_INFINITY;
    const bHours = b.hoursToDepletion ?? Number.POSITIVE_INFINITY;
    return aHours - bHours;
  });
}

/**
 * Recommend resupply actions for units that will deplete within the routine
 * horizon, sized to top the unit back up to capacity.
 *
 * @param {Array} unitForecasts - Output of {@link forecastUnit}.
 */
export function recommendResupply(unitForecasts = []) {
  const recommendations = [];

  for (const unit of unitForecasts) {
    const needed = unit.supplies.filter(
      (supply) =>
        supply.resupplyQuantity > 0 &&
        (supply.status === 'critical' ||
          supply.status === 'low' ||
          (supply.hoursToDepletion !== null &&
            supply.hoursToDepletion <= RESUPPLY_HORIZONS.routine))
    );
    if (needed.length === 0) continue;

    const soonest = needed
      .map((supply) => supply.hoursToDepletion)
      .filter((hours) => hours !== null);
    const hours = soonest.length > 0 ? Math.min(...soonest) : null;

    let priority = 'routine';
    if (hours !== null && hours <= RESUPPLY_HORIZONS.immediate) priority = 'immediate';
    else if (hours !== null && hours <= RESUPPLY_HORIZONS.urgent) priority = 'urgent';

    recommendations.push({
      unitId: unit.unitId,
      unitName: unit.name,
      latitude: unit.latitude,
      longitude: unit.longitude,
      priority,
      hoursToFirstDepletion: hours,
      items: needed.map((supply) => ({
        supplyType: supply.supplyType,
        quantity: supply.resupplyQuantity,
        unitOfMeasure: supply.unitOfMeasure,
      })),
    });
  }

  const priorityOrder = { immediate: 0, urgent: 1, routine: 2 };
  return recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
}

/**
 * Aggregate totals per supply type across every unit, for the summary display.
 * @param {Array} unitForecasts
 */
export function aggregateBySupplyType(unitForecasts = []) {
  const totals = new Map();

  for (const unit of unitForecasts) {
    for (const supply of unit.supplies) {
      const entry = totals.get(supply.supplyType) || {
        supplyType: supply.supplyType,
        unitOfMeasure: supply.unitOfMeasure,
        quantity: 0,
        capacity: 0,
        consumptionRate: 0,
        units: 0,
      };
      entry.quantity += supply.quantity;
      entry.capacity += supply.capacity;
      entry.consumptionRate += supply.consumptionRate;
      entry.units += 1;
      totals.set(supply.supplyType, entry);
    }
  }

  return [...totals.values()].map((entry) => ({
    ...entry,
    quantity: Math.round(entry.quantity * 10) / 10,
    capacity: Math.round(entry.capacity * 10) / 10,
    consumptionRate: Math.round(entry.consumptionRate * 100) / 100,
    percentRemaining:
      entry.capacity > 0 ? Math.round((entry.quantity / entry.capacity) * 1000) / 10 : 0,
    status: classifySupplyStatus(entry.quantity, entry.capacity),
    hoursToDepletion: (() => {
      const hours = hoursToDepletion(entry.quantity, entry.consumptionRate);
      return hours === null ? null : Math.round(hours * 10) / 10;
    })(),
  }));
}
