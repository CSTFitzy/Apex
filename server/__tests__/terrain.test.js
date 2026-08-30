import { describe, it, expect } from 'vitest';
import {
  buildSampleGrid,
  gridSpacingMeters,
  computeSlopeStats,
  classifyTerrain,
  assessMobility,
  identifyKeyTerrain,
  identifyObstacles,
  analyzeTerrain,
  assessWeatherImpact,
  summarizeWeather,
  buildTerrainWeatherReport,
} from '../terrain/analysis.js';

/** Build grid samples with a supplied elevation function. */
function samplesWith(elevationFn, { lat = 50, lon = 10, radiusKm = 5, size = 3 } = {}) {
  return buildSampleGrid(lat, lon, radiusKm, size).map((point) => ({
    ...point,
    elevation: elevationFn(point),
  }));
}

describe('terrain sampling', () => {
  it('builds a square grid centred on the picked point', () => {
    const grid = buildSampleGrid(50, 10, 5, 3);
    expect(grid).toHaveLength(9);
    const center = grid.find((point) => point.row === 1 && point.col === 1);
    expect(center.latitude).toBeCloseTo(50, 6);
    expect(center.longitude).toBeCloseTo(10, 6);
    expect(grid[0].latitude).toBeLessThan(50);
    expect(grid[8].latitude).toBeGreaterThan(50);
  });

  it('keeps sampled coordinates within valid bounds near the poles and dateline', () => {
    const grid = buildSampleGrid(89.99, 179.99, 100, 3);
    grid.forEach((point) => {
      expect(point.latitude).toBeGreaterThanOrEqual(-90);
      expect(point.latitude).toBeLessThanOrEqual(90);
      expect(point.longitude).toBeGreaterThanOrEqual(-180);
      expect(point.longitude).toBeLessThanOrEqual(180);
    });
  });

  it('computes the spacing between adjacent samples', () => {
    expect(gridSpacingMeters(5, 3)).toBe(5000);
    expect(gridSpacingMeters(10, 5)).toBe(5000);
  });
});

describe('slope statistics', () => {
  it('reports zero slope for perfectly flat ground', () => {
    const stats = computeSlopeStats(
      [
        [100, 100],
        [100, 100],
      ],
      1000
    );
    expect(stats).toEqual({ meanSlopeDeg: 0, maxSlopeDeg: 0, steepFraction: 0 });
  });

  it('computes slope angles from elevation differences', () => {
    const stats = computeSlopeStats(
      [
        [0, 100],
        [0, 100],
      ],
      100
    );
    expect(stats.maxSlopeDeg).toBeCloseTo(45, 1);
    expect(stats.steepFraction).toBeGreaterThan(0);
  });

  it('ignores samples with missing elevation data', () => {
    const stats = computeSlopeStats(
      [
        [NaN, NaN],
        [NaN, NaN],
      ],
      100
    );
    expect(stats.meanSlopeDeg).toBe(0);
  });
});

describe('terrain classification', () => {
  it('classifies terrain by relief and slope', () => {
    expect(classifyTerrain({ minElevation: 0, maxElevation: 0, meanSlopeDeg: 0 })).toBe('water');
    expect(classifyTerrain({ minElevation: 10, maxElevation: 30, meanSlopeDeg: 1 })).toBe('flat');
    expect(classifyTerrain({ minElevation: 10, maxElevation: 150, meanSlopeDeg: 5 })).toBe('rolling');
    expect(classifyTerrain({ minElevation: 10, maxElevation: 300, meanSlopeDeg: 11 })).toBe('hilly');
    expect(classifyTerrain({ minElevation: 100, maxElevation: 900, meanSlopeDeg: 25 })).toBe('mountainous');
  });

  it('maps terrain type onto a mobility rating', () => {
    expect(assessMobility('flat', { steepFraction: 0 }).rating).toBe('unrestricted');
    expect(assessMobility('hilly', { steepFraction: 0.2 }).rating).toBe('restricted');
    expect(assessMobility('mountainous', { steepFraction: 0.5 }).rating).toBe('severely-restricted');
    expect(assessMobility('water', { steepFraction: 0 }).rating).toBe('severely-restricted');
  });

  it('lists obstacles derived from the elevation profile', () => {
    const obstacles = identifyObstacles({
      terrainType: 'mountainous',
      minElevation: -2,
      slope: { maxSlopeDeg: 35 },
    });
    expect(obstacles.join(' ')).toMatch(/Water bodies/);
    expect(obstacles.join(' ')).toMatch(/Escarpments/);
    expect(identifyObstacles({ terrainType: 'flat', minElevation: 50, slope: { maxSlopeDeg: 2 } })).toEqual([
      'No significant natural obstacles detected from elevation data',
    ]);
  });
});

describe('key terrain', () => {
  it('identifies dominating high ground and low ground', () => {
    const samples = [
      { latitude: 1, longitude: 1, elevation: 500 },
      { latitude: 2, longitude: 2, elevation: 100 },
      { latitude: 3, longitude: 3, elevation: 250 },
    ];
    const key = identifyKeyTerrain(samples, 1);
    expect(key.highGround[0].elevation).toBe(500);
    expect(key.lowGround[0].elevation).toBe(100);
  });

  it('returns empty features when no elevation data is available', () => {
    expect(identifyKeyTerrain([{ latitude: 1, longitude: 1, elevation: NaN }])).toEqual({
      highGround: [],
      lowGround: [],
    });
  });
});

describe('AOO analysis', () => {
  it('summarises a flat area of operations', () => {
    const analysis = analyzeTerrain({
      latitude: 50,
      longitude: 10,
      radiusKm: 5,
      samples: samplesWith(() => 120),
    });

    expect(analysis.terrainType).toBe('flat');
    expect(analysis.elevation).toEqual({ min: 120, max: 120, mean: 120, relief: 0 });
    expect(analysis.mobility.rating).toBe('unrestricted');
    expect(analysis.sampleCount).toBe(9);
  });

  it('detects severely restricted mountainous terrain', () => {
    const analysis = analyzeTerrain({
      latitude: 50,
      longitude: 10,
      radiusKm: 5,
      samples: samplesWith((point) => 500 + point.row * 1500),
    });

    expect(analysis.terrainType).toBe('mountainous');
    expect(analysis.elevation.relief).toBe(3000);
    expect(analysis.mobility.rating).toBe('severely-restricted');
  });
});

describe('weather summary', () => {
  const forecast = {
    timezone: 'Europe/Berlin',
    hourly: {
      time: ['2026-08-30T00:00'],
      temperature_2m: [-3],
      precipitation: [1.2],
      windspeed_10m: [45],
      winddirection_10m: [270],
    },
    daily: {
      time: ['2026-08-30', '2026-08-31'],
      temperature_2m_max: [2, 4],
      temperature_2m_min: [-5, -2],
      precipitation_sum: [20, 15],
    },
  };

  it('extracts current conditions and the daily forecast', () => {
    const summary = summarizeWeather(forecast);
    expect(summary.current.temperatureC).toBe(-3);
    expect(summary.current.windSpeedKph).toBe(45);
    expect(summary.forecast).toHaveLength(2);
    expect(summary.timezone).toBe('Europe/Berlin');
  });

  it('returns null when no forecast data is available', () => {
    expect(summarizeWeather(null)).toBeNull();
    expect(summarizeWeather({})).toBeNull();
  });

  it('derives operational impact statements', () => {
    const impacts = assessWeatherImpact(
      { temperatureC: -3, precipitationMm: 1.2, windSpeedKph: 45 },
      [{ precipitationMm: 20 }, { precipitationMm: 15 }]
    );
    expect(impacts.join(' ')).toMatch(/High winds/);
    expect(impacts.join(' ')).toMatch(/Active precipitation/);
    expect(impacts.join(' ')).toMatch(/Sustained rainfall/);
    expect(impacts.join(' ')).toMatch(/Sub-zero/);
  });

  it('reports no constraints for benign weather', () => {
    expect(assessWeatherImpact({ temperatureC: 18, precipitationMm: 0, windSpeedKph: 5 }, [])).toEqual([
      'No significant weather constraints on operations.',
    ]);
  });
});

describe('terrain & weather report', () => {
  const terrain = analyzeTerrain({
    latitude: 50,
    longitude: 10,
    radiusKm: 5,
    samples: samplesWith((point) => 200 + point.row * 200),
  });

  it('renders every report section as plain text', () => {
    const report = buildTerrainWeatherReport({
      terrain,
      weather: summarizeWeather({
        hourly: { time: ['t'], temperature_2m: [10], precipitation: [0], windspeed_10m: [8], winddirection_10m: [90] },
        daily: { time: ['2026-08-30'], temperature_2m_max: [15], temperature_2m_min: [5], precipitation_sum: [0] },
      }),
      name: 'OBJ FALCON',
      generatedAt: '2026-08-30T07:00:00.000Z',
    });

    expect(report).toContain('APEX TERRAIN & WEATHER ANALYSIS');
    expect(report).toContain('AREA OF OPERATIONS: OBJ FALCON');
    expect(report).toContain('1. TERRAIN');
    expect(report).toContain('2. KEY TERRAIN');
    expect(report).toContain('3. OBSTACLES');
    expect(report).toContain('4. WEATHER');
    expect(report).toContain('5. OPERATIONAL IMPACT');
    expect(report).toContain('2026-08-30T07:00:00.000Z');
  });

  it('notes when weather data is unavailable', () => {
    const report = buildTerrainWeatherReport({ terrain, weather: null });
    expect(report).toContain('Weather data unavailable');
    expect(report).toContain('AREA OF OPERATIONS: UNNAMED');
  });
});
