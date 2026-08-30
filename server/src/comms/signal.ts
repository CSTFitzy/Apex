import type { LatLon, VoiceQuality } from './types.js';

/**
 * Radio propagation / link-quality model.
 *
 * Produces a 1-5 bar signal strength and a voice quality band for a radio link
 * between two units, taking into account distance, terrain obstruction,
 * weather, altitude difference and co-channel interference.
 */

export interface LinkConditions {
  from: LatLon;
  to: LatLon;
  /** Metres above sea level, if known. */
  fromAltitudeM?: number;
  toAltitudeM?: number;
  /** Fraction (0-1) of the terrain profile that blocks line of sight. */
  terrainObstruction?: number;
  /** Simulated radio frequency in MHz - lower frequencies carry further. */
  frequencyMHz?: number;
  /** Number of other channels transmitting on an overlapping frequency. */
  overlappingChannels?: number;
  weather?: { precipitationMm?: number; windSpeedKph?: number; humidityPct?: number };
}

export interface LinkQuality {
  /** 0-5 bars, matching the UI strength indicator. */
  bars: number;
  quality: VoiceQuality;
  /** Estimated signal-to-noise ratio in dB. */
  snrDb: number;
  distanceKm: number;
  /** Amount of synthetic static (0-1) the client should mix into the audio. */
  staticLevel: number;
  /** Probability (0-1) that a nearby hostile could intercept the transmission. */
  interceptRisk: number;
  factors: string[];
}

const EARTH_RADIUS_M = 6371000;

export function distanceMetres(a: LatLon, b: LatLon): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function qualityFor(snrDb: number): VoiceQuality {
  if (snrDb >= 25) return 'EXCELLENT';
  if (snrDb >= 18) return 'GOOD';
  if (snrDb >= 11) return 'FAIR';
  if (snrDb >= 4) return 'POOR';
  return 'LOST';
}

/**
 * Evaluates a radio link. The model starts from a nominal 34 dB SNR and applies
 * free-space style path loss plus terrain/weather/interference penalties.
 */
export function evaluateLink(conditions: LinkConditions): LinkQuality {
  const factors: string[] = [];
  const distanceM = distanceMetres(conditions.from, conditions.to);
  const distanceKm = distanceM / 1000;
  const frequencyMHz = conditions.frequencyMHz ?? 40;

  let snrDb = 34;

  // Path loss: logarithmic with distance, worse at higher frequencies.
  const pathLoss = 8 * Math.log10(Math.max(0.1, distanceKm) / 0.1) * (frequencyMHz / 40) ** 0.35;
  snrDb -= pathLoss;
  if (distanceKm > 5) factors.push(`Range ${distanceKm.toFixed(1)} km reduces signal margin`);

  // Terrain obstruction from the line-of-sight analysis.
  const obstruction = Math.min(1, Math.max(0, conditions.terrainObstruction ?? 0));
  if (obstruction > 0) {
    snrDb -= obstruction * 22;
    if (obstruction > 0.3) factors.push('Terrain masking between stations');
  }

  // Altitude advantage: height above the other station improves the link.
  if (conditions.fromAltitudeM !== undefined && conditions.toAltitudeM !== undefined) {
    const delta = Math.abs(conditions.fromAltitudeM - conditions.toAltitudeM);
    const gain = Math.min(6, Math.sqrt(delta) / 4);
    snrDb += gain;
    if (gain > 2) factors.push('Altitude separation improves line of sight');
  }

  // Weather attenuation.
  const precipitation = conditions.weather?.precipitationMm ?? 0;
  const humidity = conditions.weather?.humidityPct ?? 0;
  if (precipitation > 0) {
    snrDb -= Math.min(8, precipitation * 1.4);
    if (precipitation > 2) factors.push('Precipitation attenuating transmission');
  }
  if (humidity > 85) {
    snrDb -= 2;
    factors.push('High humidity increasing absorption');
  }

  // Co-channel interference.
  const overlapping = conditions.overlappingChannels ?? 0;
  if (overlapping > 0) {
    snrDb -= overlapping * 3.5;
    factors.push(`${overlapping} overlapping transmission(s) on adjacent frequencies`);
  }

  snrDb = Math.max(0, Math.min(40, snrDb));
  const quality = qualityFor(snrDb);
  const bars = quality === 'LOST' ? 0 : Math.max(1, Math.min(5, Math.ceil(snrDb / 7)));
  const staticLevel = Math.max(0, Math.min(1, 1 - snrDb / 32));

  // Closer stations are easier to intercept; a clear path helps the interceptor.
  const interceptRisk = Math.max(0, Math.min(1, (1 - obstruction) * Math.exp(-distanceKm / 12)));

  if (factors.length === 0) factors.push('Clear propagation path');

  return {
    bars,
    quality,
    snrDb: Number(snrDb.toFixed(1)),
    distanceKm: Number(distanceKm.toFixed(2)),
    staticLevel: Number(staticLevel.toFixed(2)),
    interceptRisk: Number(interceptRisk.toFixed(2)),
    factors,
  };
}

/**
 * Worst-case link quality from one station to a set of peers - used to render a
 * single channel-level signal indicator.
 */
export function evaluateChannelLink(
  from: LatLon,
  peers: Array<{ unitId: string; position: LatLon; altitudeM?: number }>,
  base: Omit<LinkConditions, 'from' | 'to'>
): LinkQuality & { peerId: string | null } {
  if (peers.length === 0) {
    return {
      bars: 5,
      quality: 'EXCELLENT',
      snrDb: 34,
      distanceKm: 0,
      staticLevel: 0.05,
      interceptRisk: 0,
      factors: ['No remote stations on this net'],
      peerId: null,
    };
  }

  let worst: (LinkQuality & { peerId: string | null }) | null = null;
  for (const peer of peers) {
    const link = evaluateLink({ ...base, from, to: peer.position, toAltitudeM: peer.altitudeM });
    if (!worst || link.snrDb < worst.snrDb) {
      worst = { ...link, peerId: peer.unitId };
    }
  }
  return worst!;
}
