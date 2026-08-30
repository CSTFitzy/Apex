/**
 * Terrain analysis for an area of operations (AOO).
 *
 * Pure, dependency-free helpers: an elevation grid sampled around a centre
 * point is turned into slope statistics, a terrain classification, key
 * terrain features, and a plain-text tactical report. Network access lives
 * in server/terrain/elevation.js so this module stays easy to unit test.
 */

const EARTH_RADIUS_KM = 6371;

/** Clamp a latitude to the valid range. */
function clampLatitude(lat) {
  return Math.max(-90, Math.min(90, lat));
}

/** Wrap a longitude into the -180..180 range. */
function wrapLongitude(lon) {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Round to a fixed number of decimals. */
function round(value, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Build a square sample grid of coordinates centred on (lat, lon).
 * @param {number} lat - Centre latitude.
 * @param {number} lon - Centre longitude.
 * @param {number} radiusKm - Half-width of the AOO box in kilometres.
 * @param {number} size - Number of samples per side (>= 2).
 * @returns {Array<{ latitude: number, longitude: number, row: number, col: number }>}
 */
export function buildSampleGrid(lat, lon, radiusKm, size = 7) {
  const steps = Math.max(2, Math.floor(size));
  const latSpanDeg = (radiusKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lonSpanDeg = latSpanDeg / cosLat;

  const points = [];
  for (let row = 0; row < steps; row += 1) {
    for (let col = 0; col < steps; col += 1) {
      const rowFraction = (row / (steps - 1)) * 2 - 1;
      const colFraction = (col / (steps - 1)) * 2 - 1;
      points.push({
        latitude: clampLatitude(lat + rowFraction * latSpanDeg),
        longitude: wrapLongitude(lon + colFraction * lonSpanDeg),
        row,
        col,
      });
    }
  }
  return points;
}

/** Spacing in metres between adjacent grid samples. */
export function gridSpacingMeters(radiusKm, size = 7) {
  const steps = Math.max(2, Math.floor(size));
  return (radiusKm * 2 * 1000) / (steps - 1);
}

/**
 * Compute slope statistics (in degrees) from an elevation grid.
 * @param {number[][]} grid - Rows of elevation values in metres.
 * @param {number} spacingMeters - Distance between adjacent samples.
 */
export function computeSlopeStats(grid, spacingMeters) {
  const slopes = [];
  for (let row = 0; row < grid.length; row += 1) {
    for (let col = 0; col < grid[row].length; col += 1) {
      const current = grid[row][col];
      if (!Number.isFinite(current)) continue;

      const right = grid[row][col + 1];
      const below = grid[row + 1]?.[col];
      const deltas = [];
      if (Number.isFinite(right)) deltas.push(Math.abs(right - current));
      if (Number.isFinite(below)) deltas.push(Math.abs(below - current));
      if (deltas.length === 0) continue;

      const rise = Math.max(...deltas);
      slopes.push((Math.atan2(rise, spacingMeters) * 180) / Math.PI);
    }
  }

  if (slopes.length === 0) {
    return { meanSlopeDeg: 0, maxSlopeDeg: 0, steepFraction: 0 };
  }

  const sum = slopes.reduce((acc, value) => acc + value, 0);
  const steep = slopes.filter((value) => value >= 15).length;
  return {
    meanSlopeDeg: round(sum / slopes.length, 2),
    maxSlopeDeg: round(Math.max(...slopes), 2),
    steepFraction: round(steep / slopes.length, 3),
  };
}

/**
 * Classify terrain from elevation relief and slope.
 * Returns one of: water, flat, rolling, hilly, mountainous.
 */
export function classifyTerrain({ minElevation, maxElevation, meanSlopeDeg }) {
  if (maxElevation <= 0) return 'water';
  const relief = maxElevation - minElevation;
  if (meanSlopeDeg >= 20 || relief >= 600) return 'mountainous';
  if (meanSlopeDeg >= 10 || relief >= 250) return 'hilly';
  if (meanSlopeDeg >= 4 || relief >= 60) return 'rolling';
  return 'flat';
}

/**
 * Assess cross-country mobility for the classified terrain.
 * Returns { rating, notes } where rating is unrestricted/restricted/severely-restricted.
 */
export function assessMobility(terrainType, slopeStats) {
  if (terrainType === 'water') {
    return {
      rating: 'severely-restricted',
      notes: 'Predominantly water; ground movement requires crossing means or bridging assets.',
    };
  }
  if (terrainType === 'mountainous' || slopeStats.steepFraction >= 0.4) {
    return {
      rating: 'severely-restricted',
      notes: 'Steep gradients canalise movement onto existing roads, tracks and valley floors.',
    };
  }
  if (terrainType === 'hilly' || slopeStats.steepFraction >= 0.15) {
    return {
      rating: 'restricted',
      notes: 'Broken ground slows mounted movement; expect reduced march rates and dead ground.',
    };
  }
  return {
    rating: 'unrestricted',
    notes: 'Open, trafficable ground supports cross-country manoeuvre by wheeled and tracked forces.',
  };
}

/**
 * Identify key terrain: the highest sample points (dominating ground) and the
 * lowest points (likely water courses / covered approaches).
 * @param {Array<{ latitude: number, longitude: number, elevation: number }>} samples
 */
export function identifyKeyTerrain(samples, limit = 3) {
  const valid = samples.filter((sample) => Number.isFinite(sample.elevation));
  if (valid.length === 0) return { highGround: [], lowGround: [] };

  const sorted = [...valid].sort((a, b) => b.elevation - a.elevation);
  const toFeature = (sample, kind) => ({
    kind,
    latitude: round(sample.latitude, 5),
    longitude: round(sample.longitude, 5),
    elevation: round(sample.elevation, 1),
  });

  return {
    highGround: sorted.slice(0, limit).map((sample) => toFeature(sample, 'high-ground')),
    lowGround: sorted
      .slice(-limit)
      .reverse()
      .map((sample) => toFeature(sample, 'low-ground')),
  };
}

/** Derive likely natural obstacles from the elevation profile. */
export function identifyObstacles({ terrainType, minElevation, slope }) {
  const obstacles = [];
  if (minElevation <= 0) obstacles.push('Water bodies / inundated ground within the AOO');
  if (slope.maxSlopeDeg >= 30) obstacles.push('Escarpments or cliffs (slopes above 30 degrees)');
  if (terrainType === 'mountainous') obstacles.push('Mountain ridgelines restricting lateral movement');
  if (terrainType === 'hilly') obstacles.push('Ridge and re-entrant pattern creating dead ground');
  if (obstacles.length === 0) {
    obstacles.push('No significant natural obstacles detected from elevation data');
  }
  return obstacles;
}

/**
 * Build the full terrain analysis for an AOO from its elevation samples.
 * @param {object} params
 * @param {number} params.latitude - AOO centre latitude.
 * @param {number} params.longitude - AOO centre longitude.
 * @param {number} params.radiusKm - AOO half-width in kilometres.
 * @param {Array<{ latitude: number, longitude: number, row: number, col: number, elevation: number }>} params.samples
 */
export function analyzeTerrain({ latitude, longitude, radiusKm, samples }) {
  const elevations = samples.map((sample) => sample.elevation).filter(Number.isFinite);
  const rows = Math.max(...samples.map((sample) => sample.row)) + 1;
  const cols = Math.max(...samples.map((sample) => sample.col)) + 1;

  const grid = Array.from({ length: rows }, () => new Array(cols).fill(NaN));
  samples.forEach((sample) => {
    grid[sample.row][sample.col] = sample.elevation;
  });

  const minElevation = elevations.length ? Math.min(...elevations) : 0;
  const maxElevation = elevations.length ? Math.max(...elevations) : 0;
  const meanElevation = elevations.length
    ? elevations.reduce((acc, value) => acc + value, 0) / elevations.length
    : 0;

  const slope = computeSlopeStats(grid, gridSpacingMeters(radiusKm, rows));
  const terrainType = classifyTerrain({
    minElevation,
    maxElevation,
    meanSlopeDeg: slope.meanSlopeDeg,
  });

  return {
    center: { latitude, longitude },
    radiusKm,
    sampleCount: samples.length,
    elevation: {
      min: round(minElevation, 1),
      max: round(maxElevation, 1),
      mean: round(meanElevation, 1),
      relief: round(maxElevation - minElevation, 1),
    },
    slope,
    terrainType,
    mobility: assessMobility(terrainType, slope),
    keyTerrain: identifyKeyTerrain(samples),
    obstacles: identifyObstacles({ terrainType, minElevation, slope }),
  };
}

/** Translate weather values into operational impact statements. */
export function assessWeatherImpact(current, days = []) {
  const impacts = [];
  const totalPrecip = days.reduce((acc, day) => acc + (day.precipitationMm || 0), 0);

  if (Number.isFinite(current.windSpeedKph)) {
    if (current.windSpeedKph >= 40) {
      impacts.push('High winds: rotary-wing and UAS operations degraded; expect obscurant drift.');
    } else if (current.windSpeedKph >= 20) {
      impacts.push('Moderate winds: minor effect on aviation and indirect fire accuracy.');
    }
  }
  if (Number.isFinite(current.precipitationMm) && current.precipitationMm > 0) {
    impacts.push('Active precipitation: reduced visibility and degraded optics/thermals.');
  }
  if (totalPrecip >= 25) {
    impacts.push('Sustained rainfall forecast: soft going, increased risk of bogging off-road.');
  }
  if (Number.isFinite(current.temperatureC)) {
    if (current.temperatureC <= 0) {
      impacts.push('Sub-zero temperatures: cold weather injury risk, battery and lubricant degradation.');
    } else if (current.temperatureC >= 35) {
      impacts.push('High temperatures: heat casualty risk, increased water consumption.');
    }
  }
  if (impacts.length === 0) impacts.push('No significant weather constraints on operations.');
  return impacts;
}

/**
 * Summarise weather for the AOO and its operational impact.
 * @param {object} forecast - Open-Meteo style forecast (hourly/daily arrays).
 */
export function summarizeWeather(forecast) {
  if (!forecast || !forecast.hourly) return null;

  const { hourly, daily } = forecast;
  const current = {
    temperatureC: hourly.temperature_2m?.[0] ?? null,
    precipitationMm: hourly.precipitation?.[0] ?? null,
    windSpeedKph: hourly.windspeed_10m?.[0] ?? null,
    windDirectionDeg: hourly.winddirection_10m?.[0] ?? null,
    time: hourly.time?.[0] ?? null,
  };

  const days = (daily?.time || []).slice(0, 7).map((date, index) => ({
    date,
    temperatureMaxC: daily.temperature_2m_max?.[index] ?? null,
    temperatureMinC: daily.temperature_2m_min?.[index] ?? null,
    precipitationMm: daily.precipitation_sum?.[index] ?? null,
  }));

  return {
    timezone: forecast.timezone || null,
    current,
    forecast: days,
    impacts: assessWeatherImpact(current, days),
  };
}

/** Format a numeric value with a unit, or 'N/A' when unavailable. */
function fmt(value, unit = '') {
  return Number.isFinite(value) ? `${value}${unit}` : 'N/A';
}

/**
 * Render a plain-text terrain & weather report for the AOO.
 * @param {object} params
 * @param {object} params.terrain - Result of analyzeTerrain().
 * @param {object|null} [params.weather] - Result of summarizeWeather().
 * @param {string} [params.name] - Optional AOO name.
 * @param {string} [params.generatedAt] - ISO timestamp.
 */
export function buildTerrainWeatherReport({ terrain, weather, name, generatedAt }) {
  const lines = [
    'APEX TERRAIN & WEATHER ANALYSIS',
    '='.repeat(60),
    `AREA OF OPERATIONS: ${name || 'UNNAMED'}`,
    `Centre: ${terrain.center.latitude}, ${terrain.center.longitude} (radius ${terrain.radiusKm} km)`,
    `Generated: ${generatedAt || new Date().toISOString()}`,
    '',
    '1. TERRAIN',
    `   Classification : ${terrain.terrainType}`,
    `   Elevation      : min ${fmt(terrain.elevation.min, ' m')}, max ${fmt(terrain.elevation.max, ' m')}, mean ${fmt(terrain.elevation.mean, ' m')}`,
    `   Relief         : ${fmt(terrain.elevation.relief, ' m')}`,
    `   Slope          : mean ${fmt(terrain.slope.meanSlopeDeg, ' deg')}, max ${fmt(terrain.slope.maxSlopeDeg, ' deg')}`,
    `   Mobility       : ${terrain.mobility.rating} - ${terrain.mobility.notes}`,
    '',
    '2. KEY TERRAIN',
  ];

  if (terrain.keyTerrain.highGround.length === 0) {
    lines.push('   None identified');
  } else {
    terrain.keyTerrain.highGround.forEach((feature, index) => {
      lines.push(
        `   HG${index + 1} Dominating ground at ${feature.latitude}, ${feature.longitude} (${fmt(feature.elevation, ' m')})`
      );
    });
    terrain.keyTerrain.lowGround.forEach((feature, index) => {
      lines.push(
        `   LG${index + 1} Low ground / likely water course at ${feature.latitude}, ${feature.longitude} (${fmt(feature.elevation, ' m')})`
      );
    });
  }

  lines.push('', '3. OBSTACLES');
  terrain.obstacles.forEach((obstacle) => lines.push(`   - ${obstacle}`));

  lines.push('', '4. WEATHER');
  if (weather) {
    lines.push(
      `   Current        : ${fmt(weather.current.temperatureC, ' C')}, wind ${fmt(weather.current.windSpeedKph, ' km/h')} from ${fmt(weather.current.windDirectionDeg, ' deg')}, precip ${fmt(weather.current.precipitationMm, ' mm')}`,
      '   Forecast       :'
    );
    weather.forecast.forEach((day) => {
      lines.push(
        `     ${day.date}: ${fmt(day.temperatureMinC, ' C')} to ${fmt(day.temperatureMaxC, ' C')}, precip ${fmt(day.precipitationMm, ' mm')}`
      );
    });
    lines.push('', '5. OPERATIONAL IMPACT');
    weather.impacts.forEach((impact) => lines.push(`   - ${impact}`));
  } else {
    lines.push('   Weather data unavailable for this area of operations.');
    lines.push('', '5. OPERATIONAL IMPACT');
  }

  lines.push(`   - ${terrain.mobility.notes}`, '');
  return lines.join('\n');
}
