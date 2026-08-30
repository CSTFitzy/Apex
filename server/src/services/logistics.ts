import type pg from 'pg';
import { haversineDistance, type LatLon } from '../utils/geo.js';

export type SupplyType = 'Ammo' | 'Fuel' | 'Medical' | 'Rations' | 'Water';
export type DepotStatus = 'Operational' | 'Damaged' | 'Destroyed' | 'Captured';
export type SupplyLineStatus = 'SECURE' | 'THREATENED' | 'CRITICAL' | 'CUT';

export interface DepotInventory {
  supplyType: SupplyType;
  quantity: number;
  maxQuantity: number;
  priority: number;
}

export interface SupplyDepot {
  id: number;
  name: string;
  location: LatLon;
  totalCapacity: number;
  securityLevel: number;
  status: DepotStatus;
  inventory: DepotInventory[];
}

export interface ThreatZone {
  center: LatLon;
  radiusM: number;
  severity: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

export interface ResupplyRequestInput {
  unitId: string;
  unitName: string;
  location: LatLon;
  supplyType: SupplyType;
  quantity: number;
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'EMERGENCY';
  threatZones?: ThreatZone[];
}

export interface ConvoyRoute {
  id: string;
  depotId: number;
  depotName: string;
  waypoints: LatLon[];
  distanceM: number;
  etaMinutes: number;
  fuelCostLiters: number;
  riskLevel: SupplyLineStatus;
  progressPct: number;
}

export interface ResupplyPlan {
  requestId: string;
  status: 'Pending' | 'Planned' | 'InTransit';
  depot: SupplyDepot;
  route: ConvoyRoute;
  warnings: string[];
}

export interface SupplyForecastInput {
  unitId: string;
  unitName?: string;
  hours?: number;
  currentInventory: Partial<Record<SupplyType, number>>;
  consumptionRates: Partial<Record<SupplyType, number>>;
  combatIntensity?: number;
}

export interface SupplyForecast {
  unitId: string;
  unitName: string;
  generatedAt: string;
  projections: Array<{
    supplyType: SupplyType;
    currentQuantity: number;
    hourlyConsumption: number;
    depletionHours: number | null;
    projectedLevels: Array<{ hoursAhead: number; quantity: number }>;
    warning: string | null;
  }>;
  logisticsHealthPct: number;
}

export interface AllocationInput {
  availableSupplies: Partial<Record<SupplyType, number>>;
  transportCapacity: number;
  units: Array<{
    unitId: string;
    unitName: string;
    priority: number;
    inContact?: boolean;
    personnel: number;
    vehicleCount?: number;
    casualtyRatePct?: number;
    requested: Partial<Record<SupplyType, number>>;
  }>;
}

export interface AllocationResult {
  allocations: Array<{
    unitId: string;
    unitName: string;
    supplyType: SupplyType;
    requestedQuantity: number;
    allocatedQuantity: number;
    priorityScore: number;
    effectivenessPct: number;
  }>;
  unallocatedSupplies: Partial<Record<SupplyType, number>>;
  transportUtilizationPct: number;
}

const SUPPLY_TYPES: SupplyType[] = ['Ammo', 'Fuel', 'Medical', 'Rations', 'Water'];

export const sampleDepots: SupplyDepot[] = [
  {
    id: 1,
    name: 'Apex Main Logistics Base',
    location: { lat: -33.8688, lon: 151.2093 },
    totalCapacity: 120000,
    securityLevel: 92,
    status: 'Operational',
    inventory: [
      { supplyType: 'Ammo', quantity: 36000, maxQuantity: 50000, priority: 95 },
      { supplyType: 'Fuel', quantity: 42000, maxQuantity: 50000, priority: 90 },
      { supplyType: 'Medical', quantity: 12000, maxQuantity: 15000, priority: 85 },
      { supplyType: 'Rations', quantity: 22000, maxQuantity: 25000, priority: 70 },
      { supplyType: 'Water', quantity: 24000, maxQuantity: 25000, priority: 80 },
    ],
  },
  {
    id: 2,
    name: 'Forward Supply Point North',
    location: { lat: -33.835, lon: 151.245 },
    totalCapacity: 42000,
    securityLevel: 76,
    status: 'Operational',
    inventory: [
      { supplyType: 'Ammo', quantity: 14000, maxQuantity: 18000, priority: 90 },
      { supplyType: 'Fuel', quantity: 11000, maxQuantity: 15000, priority: 85 },
      { supplyType: 'Medical', quantity: 3500, maxQuantity: 5000, priority: 80 },
      { supplyType: 'Rations', quantity: 6000, maxQuantity: 8000, priority: 65 },
      { supplyType: 'Water', quantity: 7000, maxQuantity: 8000, priority: 75 },
    ],
  },
  {
    id: 3,
    name: 'Mobile Medical Cache',
    location: { lat: -33.895, lon: 151.175 },
    totalCapacity: 18000,
    securityLevel: 64,
    status: 'Operational',
    inventory: [
      { supplyType: 'Medical', quantity: 9000, maxQuantity: 10000, priority: 100 },
      { supplyType: 'Rations', quantity: 3000, maxQuantity: 5000, priority: 65 },
      { supplyType: 'Water', quantity: 3600, maxQuantity: 5000, priority: 75 },
    ],
  },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function assertLatLon(location: LatLon): void {
  if (
    typeof location?.lat !== 'number' ||
    typeof location?.lon !== 'number' ||
    location.lat < -90 ||
    location.lat > 90 ||
    location.lon < -180 ||
    location.lon > 180
  ) {
    throw new Error('A valid latitude/longitude is required');
  }
}

export async function listSupplyDepots(pool: pg.Pool): Promise<SupplyDepot[]> {
  try {
    const result = await pool.query(`
      SELECT
        d.id,
        d.name,
        ST_Y(d.location::geometry) AS latitude,
        ST_X(d.location::geometry) AS longitude,
        d.total_capacity,
        d.security_level,
        d.status,
        COALESCE(
          json_agg(
            json_build_object(
              'supplyType', i.supply_type,
              'quantity', i.quantity,
              'maxQuantity', i.max_quantity,
              'priority', i.priority
            )
            ORDER BY i.supply_type
          ) FILTER (WHERE i.id IS NOT NULL),
          '[]'::json
        ) AS inventory
      FROM supply_depots d
      LEFT JOIN depot_inventory i ON i.depot_id = d.id
      GROUP BY d.id
      ORDER BY d.name
    `);

    return result.rows.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      location: { lat: Number(row.latitude), lon: Number(row.longitude) },
      totalCapacity: Number(row.total_capacity),
      securityLevel: Number(row.security_level),
      status: row.status,
      inventory: row.inventory,
    }));
  } catch (error) {
    console.warn('Using in-memory supply depots because database query failed:', error);
    return sampleDepots;
  }
}

function riskFromThreatZones(waypoints: LatLon[], threatZones: ThreatZone[] = []): SupplyLineStatus {
  if (threatZones.length === 0) return 'SECURE';

  let risk: SupplyLineStatus = 'SECURE';
  for (const waypoint of waypoints) {
    for (const threat of threatZones) {
      assertLatLon(threat.center);
      const distance = haversineDistance(waypoint, threat.center);
      if (distance <= Math.min(threat.radiusM, 2000) || threat.severity === 'CRITICAL') return 'CRITICAL';
      if (distance <= Math.min(threat.radiusM + 3000, 5000) || threat.severity === 'HIGH') risk = 'THREATENED';
    }
  }
  return risk;
}

export function calculateConvoyRoute(
  depot: SupplyDepot,
  destination: LatLon,
  threatZones: ThreatZone[] = []
): ConvoyRoute {
  assertLatLon(depot.location);
  assertLatLon(destination);

  const midpoint: LatLon = {
    lat: (depot.location.lat + destination.lat) / 2,
    lon: (depot.location.lon + destination.lon) / 2,
  };
  const waypoints = [depot.location, midpoint, destination];
  const distanceM = Math.round(
    haversineDistance(depot.location, midpoint) + haversineDistance(midpoint, destination)
  );
  const riskLevel = riskFromThreatZones(waypoints, threatZones);
  const riskMultiplier = riskLevel === 'CRITICAL' ? 1.7 : riskLevel === 'THREATENED' ? 1.3 : 1;
  const terrainMultiplier = 1.15;
  const etaMinutes = Math.ceil((distanceM / 1000 / 38) * 60 * riskMultiplier * terrainMultiplier);

  return {
    id: `route-${depot.id}-${Date.now()}`,
    depotId: depot.id,
    depotName: depot.name,
    waypoints,
    distanceM,
    etaMinutes,
    fuelCostLiters: Math.round((distanceM / 1000) * 2.8 * riskMultiplier * 10) / 10,
    riskLevel,
    progressPct: 0,
  };
}

function chooseDepot(depots: SupplyDepot[], request: ResupplyRequestInput): SupplyDepot | null {
  return depots
    .filter(
      (depot) =>
        depot.status === 'Operational' &&
        depot.inventory.some(
          (item) => item.supplyType === request.supplyType && item.quantity >= request.quantity
        )
    )
    .sort((a, b) => haversineDistance(a.location, request.location) - haversineDistance(b.location, request.location))[0] ?? null;
}

export async function createResupplyPlan(pool: pg.Pool, request: ResupplyRequestInput): Promise<ResupplyPlan> {
  if (!request.unitId || !request.unitName || !request.supplyType || request.quantity <= 0) {
    throw new Error('unitId, unitName, supplyType, and positive quantity are required');
  }
  assertLatLon(request.location);

  const depots = await listSupplyDepots(pool);
  const depot = chooseDepot(depots, request);
  if (!depot) {
    throw new Error(`No operational depot can satisfy ${request.quantity} ${request.supplyType}`);
  }

  const route = calculateConvoyRoute(depot, request.location, request.threatZones);
  let requestId = `REQ-${Date.now()}`;

  try {
    const result = await pool.query(
      `
        INSERT INTO supply_requests (unit_id, unit_name, supply_type, quantity, priority, status, location)
        VALUES ($1, $2, $3, $4, $5, 'Planned', ST_SetSRID(ST_MakePoint($6, $7), 4326))
        RETURNING id
      `,
      [
        request.unitId,
        request.unitName,
        request.supplyType,
        Math.round(request.quantity),
        request.priority ?? 'NORMAL',
        request.location.lon,
        request.location.lat,
      ]
    );
    requestId = `REQ-${result.rows[0].id}`;
    await pool.query(
      `
        INSERT INTO convoys (request_id, depot_id, status, route, distance_m, eta_minutes, fuel_cost_liters)
        VALUES ($1, $2, 'Planned', ST_SetSRID(ST_MakeLine(ARRAY[
          ST_MakePoint($3, $4),
          ST_MakePoint($5, $6),
          ST_MakePoint($7, $8)
        ]), 4326), $9, $10, $11)
      `,
      [
        result.rows[0].id,
        depot.id,
        route.waypoints[0].lon,
        route.waypoints[0].lat,
        route.waypoints[1].lon,
        route.waypoints[1].lat,
        route.waypoints[2].lon,
        route.waypoints[2].lat,
        route.distanceM,
        route.etaMinutes,
        route.fuelCostLiters,
      ]
    );
  } catch (error) {
    console.warn('Resupply plan was generated without database persistence:', error);
  }

  return {
    requestId,
    status: 'Planned',
    depot,
    route,
    warnings: route.riskLevel === 'SECURE' ? [] : [`Route is ${route.riskLevel}; assign escort or choose an alternate path.`],
  };
}

export function forecastSupply(input: SupplyForecastInput): SupplyForecast {
  if (!input.unitId) throw new Error('unitId is required');
  const hours = clamp(input.hours ?? 8, 1, 48);
  const combatIntensity = clamp(input.combatIntensity ?? 1, 0.25, 3);

  const projections = SUPPLY_TYPES.map((supplyType) => {
    const currentQuantity = Math.max(0, input.currentInventory[supplyType] ?? 0);
    const baseConsumption = Math.max(0, input.consumptionRates[supplyType] ?? 0);
    const variableSupplies: SupplyType[] = ['Ammo', 'Fuel', 'Medical'];
    const hourlyConsumption = variableSupplies.includes(supplyType)
      ? baseConsumption * combatIntensity
      : baseConsumption;
    const depletionHours = hourlyConsumption > 0 ? currentQuantity / hourlyConsumption : null;
    const projectedLevels = [1, 2, 4, 8, 24]
      .filter((h) => h <= hours || h <= 8)
      .map((hoursAhead) => ({
        hoursAhead,
        quantity: Math.max(0, Math.round(currentQuantity - hourlyConsumption * hoursAhead)),
      }));

    let warning: string | null = null;
    if (depletionHours !== null && depletionHours <= 2) warning = `${supplyType} will deplete within 2 hours.`;
    else if (depletionHours !== null && depletionHours <= 8) warning = `${supplyType} needs resupply within 8 hours.`;

    return {
      supplyType,
      currentQuantity,
      hourlyConsumption: Math.round(hourlyConsumption * 10) / 10,
      depletionHours: depletionHours === null ? null : Math.round(depletionHours * 10) / 10,
      projectedLevels,
      warning,
    };
  });

  const healthy = projections.filter((p) => p.depletionHours === null || p.depletionHours >= 8).length;
  const logisticsHealthPct = Math.round((healthy / projections.length) * 100);

  return {
    unitId: input.unitId,
    unitName: input.unitName ?? input.unitId,
    generatedAt: new Date().toISOString(),
    projections,
    logisticsHealthPct,
  };
}

export function allocateResources(input: AllocationInput): AllocationResult {
  const remaining: Partial<Record<SupplyType, number>> = {};
  SUPPLY_TYPES.forEach((type) => {
    remaining[type] = Math.max(0, input.availableSupplies[type] ?? 0);
  });

  let remainingTransport = Math.max(0, input.transportCapacity);
  const allocations: AllocationResult['allocations'] = [];
  const unitScores = input.units
    .map((unit) => ({
      ...unit,
      score:
        unit.priority +
        (unit.inContact ? 30 : 0) +
        (unit.casualtyRatePct ?? 0) * 0.7 +
        Math.min(unit.personnel / 20, 20),
    }))
    .sort((a, b) => b.score - a.score);

  for (const unit of unitScores) {
    for (const supplyType of SUPPLY_TYPES) {
      const requestedQuantity = Math.max(0, unit.requested[supplyType] ?? 0);
      if (requestedQuantity === 0) continue;
      const available = remaining[supplyType] ?? 0;
      const allocatedQuantity = Math.min(requestedQuantity, available, remainingTransport);
      remaining[supplyType] = available - allocatedQuantity;
      remainingTransport -= allocatedQuantity;
      allocations.push({
        unitId: unit.unitId,
        unitName: unit.unitName,
        supplyType,
        requestedQuantity,
        allocatedQuantity,
        priorityScore: Math.round(unit.score * 10) / 10,
        effectivenessPct: requestedQuantity === 0 ? 100 : Math.round((allocatedQuantity / requestedQuantity) * 100),
      });
    }
  }

  return {
    allocations,
    unallocatedSupplies: remaining,
    transportUtilizationPct:
      input.transportCapacity <= 0
        ? 0
        : Math.round(((input.transportCapacity - remainingTransport) / input.transportCapacity) * 100),
  };
}

export function buildSupplyLines(depots: SupplyDepot[], units: Array<{ id: string; position: LatLon }>): Array<{
  depotId: number;
  unitId: string;
  status: SupplyLineStatus;
  waypoints: LatLon[];
  distanceM: number;
}> {
  return units
    .map((unit) => {
      const depot = depots
        .filter((candidate) => candidate.status === 'Operational')
        .sort((a, b) => haversineDistance(a.location, unit.position) - haversineDistance(b.location, unit.position))[0];
      if (!depot) return null;
      const distanceM = Math.round(haversineDistance(depot.location, unit.position));
      const status: SupplyLineStatus =
        distanceM > 25000 ? 'THREATENED' : depot.securityLevel < 50 ? 'CRITICAL' : 'SECURE';
      return { depotId: depot.id, unitId: unit.id, status, waypoints: [depot.location, unit.position], distanceM };
    })
    .filter((line): line is NonNullable<typeof line> => line !== null);
}
