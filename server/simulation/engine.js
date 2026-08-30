/**
 * Live tactical simulation engine.
 *
 * Maintains an in-memory population of simulated friendly/hostile units,
 * moves them over time, and generates combat engagement events. This
 * powers the real-time KPI dashboard, Battle Damage Assessment (BDA)
 * tables, and tactical heatmaps without requiring any external data feed.
 *
 * The engine is intentionally self-contained (no DB persistence) so it can
 * run standalone in any environment, matching the analytics module's
 * stateless-server / in-memory design.
 */
import { logger } from '../utils/logger.js';

const SIDES = ['friendly', 'hostile'];
const UNIT_TYPES = ['infantry', 'armor', 'artillery', 'air', 'naval'];
const DAMAGE_TYPES = ['destroyed', 'damaged', 'suppressed'];
const CONFIDENCE_LEVELS = ['confirmed', 'probable', 'possible'];

const DEFAULT_UNIT_COUNT = 24;
const DEFAULT_AREA = {
  minLat: 48.0,
  maxLat: 50.5,
  minLon: 35.0,
  maxLon: 38.5,
};
const MAX_EVENTS = 500;

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function createUnit(id, area) {
  const side = randomChoice(SIDES);
  return {
    id,
    callsign: `${side === 'friendly' ? 'BLUE' : 'RED'}-${String(id).padStart(3, '0')}`,
    side,
    type: randomChoice(UNIT_TYPES),
    latitude: randomBetween(area.minLat, area.maxLat),
    longitude: randomBetween(area.minLon, area.maxLon),
    health: 100,
    status: 'active',
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * SimulationEngine drives a tactical scenario forward in fixed ticks,
 * updating unit positions/health and emitting engagement (BDA) events.
 */
export class SimulationEngine {
  constructor({ unitCount = DEFAULT_UNIT_COUNT, area = DEFAULT_AREA } = {}) {
    this.area = area;
    this.units = new Map();
    this.events = [];
    this.tickCount = 0;
    this.startedAt = new Date().toISOString();
    this.listeners = new Set();
    this.timer = null;

    for (let i = 1; i <= unitCount; i += 1) {
      const unit = createUnit(i, area);
      this.units.set(unit.id, unit);
    }
  }

  /** Register a callback invoked with `{ units, events }` after every tick. */
  onTick(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Start advancing the simulation on a fixed interval (ms). */
  start(intervalMs = 2000) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    logger.info('Simulation engine started', { intervalMs, units: this.units.size });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Advance the simulation by one tick: move units, roll for engagements. */
  tick() {
    this.tickCount += 1;
    const tickEvents = [];

    for (const unit of this.units.values()) {
      if (unit.status === 'destroyed') continue;

      // Random walk movement.
      unit.latitude = clamp(unit.latitude + randomBetween(-0.03, 0.03), this.area.minLat, this.area.maxLat);
      unit.longitude = clamp(unit.longitude + randomBetween(-0.03, 0.03), this.area.minLon, this.area.maxLon);
      unit.lastUpdated = new Date().toISOString();

      // Small chance of a combat engagement each tick.
      if (Math.random() < 0.08) {
        const event = this.generateEngagement(unit);
        if (event) tickEvents.push(event);
      }
    }

    if (tickEvents.length > 0) {
      this.events.push(...tickEvents);
      if (this.events.length > MAX_EVENTS) {
        this.events.splice(0, this.events.length - MAX_EVENTS);
      }
    }

    const payload = { units: this.getUnits(), events: tickEvents, tick: this.tickCount };
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch (err) {
        logger.error('Simulation tick listener failed', { error: err.message });
      }
    }
  }

  generateEngagement(sourceUnit) {
    const opposingSide = sourceUnit.side === 'friendly' ? 'hostile' : 'friendly';
    const targets = [...this.units.values()].filter(
      (u) => u.side === opposingSide && u.status !== 'destroyed'
    );
    if (targets.length === 0) return null;

    const target = randomChoice(targets);
    const damageType = randomChoice(DAMAGE_TYPES);
    const damage = damageType === 'destroyed' ? 100 : Math.round(randomBetween(10, 60));
    target.health = Math.max(0, target.health - damage);
    if (target.health <= 0 || damageType === 'destroyed') {
      target.health = 0;
      target.status = 'destroyed';
    } else if (damageType === 'suppressed') {
      target.status = 'suppressed';
    } else {
      target.status = 'damaged';
    }

    return {
      id: `evt-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      timestamp: new Date().toISOString(),
      sourceUnitId: sourceUnit.id,
      sourceCallsign: sourceUnit.callsign,
      sourceSide: sourceUnit.side,
      targetUnitId: target.id,
      targetCallsign: target.callsign,
      targetSide: target.side,
      targetType: target.type,
      damageType,
      damage,
      confidence: randomChoice(CONFIDENCE_LEVELS),
      latitude: target.latitude,
      longitude: target.longitude,
    };
  }

  getUnits() {
    return [...this.units.values()];
  }

  getEvents(limit = MAX_EVENTS) {
    return this.events.slice(-limit);
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Singleton instance shared across the server process.
export const simulationEngine = new SimulationEngine();
