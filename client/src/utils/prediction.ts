/**
 * Browser-based (TensorFlow.js) enemy AI prediction engine. Everything here runs
 * client-side - no server round-trip is required, so predictions can be
 * recomputed on every simulation tick as new intelligence (unit positions)
 * arrives.
 *
 * Two small neural networks are trained on synthetic data the first time they
 * are needed (a few hundred milliseconds) and then reused for the life of the
 * session:
 *  - a movement LSTM that extrapolates a unit's recent displacement vectors to
 *    forecast future positions (5 / 10 / 30 minutes ahead) with a confidence
 *    score derived from recent movement volatility and forecast horizon.
 *  - a threat-escalation dense network that maps recent strength/closing-rate
 *    trends to a probability that a unit's threat level will rise, fall, or
 *    hold steady over the next 1 / 2 / 4 hours.
 */
import * as tf from '@tensorflow/tfjs';
import type {
  CounterPlanResult,
  LatLon,
  TacticalUnit,
  ThreatForecast,
  ThreatTrend,
  TrajectoryPrediction,
  UnitPrediction,
} from '../types';

/** Ring buffer of recent positions kept per unit so the models have movement history. */
export const HISTORY_LENGTH = 12;

export function pushHistory(history: LatLon[], position: LatLon): LatLon[] {
  const next = [...history, position];
  return next.length > HISTORY_LENGTH ? next.slice(next.length - HISTORY_LENGTH) : next;
}

const SEQ_LEN = 5;
const FEATURES = 2; // [delta lat, delta lon]
const PREDICTION_HORIZONS_MIN = [5, 10, 30];
const THREAT_HORIZONS_HR = [1, 2, 4];

let movementModel: tf.LayersModel | null = null;
let movementTrained = false;
let threatModel: tf.LayersModel | null = null;
let threatTrained = false;

function buildMovementModel(): tf.LayersModel {
  const model = tf.sequential();
  model.add(tf.layers.lstm({ units: 16, inputShape: [SEQ_LEN, FEATURES], returnSequences: false }));
  model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
  model.add(tf.layers.dense({ units: FEATURES }));
  model.compile({ optimizer: tf.train.adam(0.02), loss: 'meanSquaredError' });
  return model;
}

/**
 * Synthetic training set: constant-velocity trajectories with gentle turning
 * (curve) and noise, so the network learns to extrapolate momentum and
 * gradual heading changes rather than memorising a single track.
 */
function movementTrainingData(samples = 120) {
  const xs: number[][][] = [];
  const ys: number[][] = [];
  for (let i = 0; i < samples; i++) {
    const speed = 0.0004 + Math.random() * 0.0025;
    const curve = (Math.random() - 0.5) * 0.2;
    const noise = 0.00005;
    let heading = Math.random() * Math.PI * 2;
    const deltas: number[][] = [];
    for (let s = 0; s < SEQ_LEN + 1; s++) {
      heading += curve;
      deltas.push([
        Math.cos(heading) * speed + (Math.random() - 0.5) * noise,
        Math.sin(heading) * speed + (Math.random() - 0.5) * noise,
      ]);
    }
    xs.push(deltas.slice(0, SEQ_LEN));
    ys.push(deltas[SEQ_LEN]);
  }
  return { xs, ys };
}

async function getMovementModel(): Promise<tf.LayersModel> {
  if (!movementModel) movementModel = buildMovementModel();
  if (!movementTrained) {
    const { xs, ys } = movementTrainingData();
    const xsT = tf.tensor3d(xs);
    const ysT = tf.tensor2d(ys);
    await movementModel.fit(xsT, ysT, { epochs: 10, batchSize: 32, shuffle: true, verbose: 0 });
    xsT.dispose();
    ysT.dispose();
    movementTrained = true;
  }
  return movementModel;
}

function deltasFromHistory(history: LatLon[]): LatLon[] {
  const deltas: LatLon[] = [];
  for (let i = 1; i < history.length; i++) {
    deltas.push({ lat: history[i].lat - history[i - 1].lat, lon: history[i].lon - history[i - 1].lon });
  }
  return deltas;
}

function varianceOf(deltas: LatLon[]): number {
  if (deltas.length === 0) return 0;
  const mean = deltas.reduce(
    (acc, d) => ({ lat: acc.lat + d.lat / deltas.length, lon: acc.lon + d.lon / deltas.length }),
    { lat: 0, lon: 0 }
  );
  return (
    deltas.reduce((acc, d) => acc + (d.lat - mean.lat) ** 2 + (d.lon - mean.lon) ** 2, 0) / deltas.length
  );
}

/**
 * Multi-step-ahead movement prediction for one unit using its recent position
 * history. Returns predicted positions at 5/10/30 minutes ahead, each with a
 * 0-100% confidence score that decays with forecast horizon and increases
 * with the volatility of the unit's recent track (erratic movement = lower
 * confidence).
 */
export async function predictTrajectory(
  unit: Pick<TacticalUnit, 'id' | 'name'>,
  history: LatLon[]
): Promise<TrajectoryPrediction> {
  if (history.length < 2) {
    return { unitId: unit.id, unitName: unit.name, points: [] };
  }

  const model = await getMovementModel();
  const deltas = deltasFromHistory(history);
  const recentDeltas = deltas.slice(-SEQ_LEN);
  const padded = recentDeltas.length
    ? Array.from({ length: SEQ_LEN }, (_, i) => recentDeltas[Math.max(0, i - (SEQ_LEN - recentDeltas.length))])
    : Array.from({ length: SEQ_LEN }, () => ({ lat: 0, lon: 0 }));

  const variance = varianceOf(recentDeltas);
  let workingSeq = padded.map((d) => [d.lat, d.lon]);
  let cursor = { ...history[history.length - 1] };

  const points: TrajectoryPrediction['points'] = [];
  const maxHorizon = Math.max(...PREDICTION_HORIZONS_MIN);

  for (let step = 1; step <= maxHorizon; step++) {
    const input = tf.tensor3d([workingSeq]);
    const predT = model.predict(input) as tf.Tensor;
    const [dLat, dLon] = Array.from(await predT.data());
    input.dispose();
    predT.dispose();

    cursor = { lat: cursor.lat + dLat, lon: cursor.lon + dLon };
    workingSeq = [...workingSeq.slice(1), [dLat, dLon]];

    if (PREDICTION_HORIZONS_MIN.includes(step)) {
      // Confidence falls off with horizon and with recent movement volatility.
      const horizonPenalty = step * 1.4;
      const volatilityPenalty = Math.min(40, variance * 3_000_000);
      const confidencePct = Math.max(10, Math.min(95, Math.round(96 - horizonPenalty - volatilityPenalty)));
      points.push({ position: { ...cursor }, minutesAhead: step, confidencePct });
    }
  }

  return { unitId: unit.id, unitName: unit.name, points };
}

function buildThreatModel(): tf.LayersModel {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 12, activation: 'relu', inputShape: [3] }));
  model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
  // Output: [p(increasing), p(stable), p(decreasing)]
  model.add(tf.layers.dense({ units: 3, activation: 'softmax' }));
  model.compile({ optimizer: tf.train.adam(0.03), loss: 'categoricalCrossentropy' });
  return model;
}

/**
 * Synthetic training set mapping [strengthTrend, closingRate, horizonHours] to
 * an escalation label, so the network learns that units closing distance
 * rapidly while maintaining strength escalate, while retreating/weakened
 * units de-escalate.
 */
function threatTrainingData(samples = 150) {
  const xs: number[][] = [];
  const ys: number[][] = [];
  for (let i = 0; i < samples; i++) {
    const strengthTrend = Math.random() * 2 - 1; // -1 (losing strength) .. 1 (reinforcing)
    const closingRate = Math.random() * 2 - 1; // -1 (retreating) .. 1 (advancing fast)
    const horizon = [1, 2, 4][Math.floor(Math.random() * 3)] / 4;
    const score = closingRate * 0.7 + strengthTrend * 0.3 + (Math.random() - 0.5) * 0.15;
    let label: [number, number, number];
    if (score > 0.2) label = [1, 0, 0];
    else if (score < -0.2) label = [0, 0, 1];
    else label = [0, 1, 0];
    xs.push([strengthTrend, closingRate, horizon]);
    ys.push(label);
  }
  return { xs, ys };
}

async function getThreatModel(): Promise<tf.LayersModel> {
  if (!threatModel) threatModel = buildThreatModel();
  if (!threatTrained) {
    const { xs, ys } = threatTrainingData();
    const xsT = tf.tensor2d(xs);
    const ysT = tf.tensor2d(ys);
    await threatModel.fit(xsT, ysT, { epochs: 15, batchSize: 32, shuffle: true, verbose: 0 });
    xsT.dispose();
    ysT.dispose();
    threatTrained = true;
  }
  return threatModel;
}

const TREND_LEVELS: Record<ThreatTrend, ThreatForecast['predictedLevel'][]> = {
  INCREASING: ['MODERATE', 'HIGH', 'CRITICAL'],
  STABLE: ['MODERATE', 'MODERATE', 'MODERATE'],
  DECREASING: ['LOW', 'LOW', 'MODERATE'],
};

/**
 * Forecasts whether a unit's threat level will rise, fall, or hold over the
 * next 1/2/4 hours, based on its recent strength trend and how quickly it is
 * closing distance on the nearest opposing-affiliation unit.
 */
export async function forecastThreatEscalation(
  unit: Pick<TacticalUnit, 'id' | 'name'>,
  strengthTrend: number,
  closingRate: number
): Promise<ThreatForecast[]> {
  const model = await getThreatModel();
  const results: ThreatForecast[] = [];

  for (const hours of THREAT_HORIZONS_HR) {
    const input = tf.tensor2d([[strengthTrend, closingRate, hours / 4]]);
    const predT = model.predict(input) as tf.Tensor;
    const [pIncrease, pStable, pDecrease] = Array.from(await predT.data());
    input.dispose();
    predT.dispose();

    const probs: Array<[ThreatTrend, number]> = [
      ['INCREASING', pIncrease],
      ['STABLE', pStable],
      ['DECREASING', pDecrease],
    ];
    probs.sort((a, b) => b[1] - a[1]);
    const [trend, prob] = probs[0];
    const horizonIdx = THREAT_HORIZONS_HR.indexOf(hours);
    results.push({
      unitId: unit.id,
      unitName: unit.name,
      hoursAhead: hours,
      trend,
      confidencePct: Math.round(prob * 100),
      predictedLevel: TREND_LEVELS[trend][horizonIdx],
    });
  }

  return results;
}

function nearestOpposing(unit: TacticalUnit, allUnits: TacticalUnit[]): TacticalUnit | null {
  const opposing = allUnits.filter(
    (u) => u.affiliation !== unit.affiliation && u.affiliation !== 'neutral' && u.status !== 'destroyed'
  );
  if (opposing.length === 0) return null;
  return opposing.reduce((closest, candidate) => {
    const d = Math.hypot(candidate.position.lat - unit.position.lat, candidate.position.lon - unit.position.lon);
    const dClosest = Math.hypot(closest.position.lat - unit.position.lat, closest.position.lon - unit.position.lon);
    return d < dClosest ? candidate : closest;
  });
}

/**
 * Runs the full AI prediction pipeline for one hostile unit: movement
 * trajectory, threat escalation forecast, casualty/engagement estimates, and
 * rule-based tactical recommendations informed by matched doctrine.
 */
export async function predictUnit(
  unit: TacticalUnit,
  history: LatLon[],
  allUnits: TacticalUnit[],
  counterPlan: CounterPlanResult | null
): Promise<UnitPrediction> {
  const trajectory = await predictTrajectory(unit, history);

  const deltas = deltasFromHistory(history);
  const recentSpeed = deltas.length ? Math.hypot(deltas[deltas.length - 1].lat, deltas[deltas.length - 1].lon) : 0;
  const strengthTrend = Math.max(-1, Math.min(1, (unit.strength - 100) / 100));

  const nearest = nearestOpposing(unit, allUnits);
  let closingRate = 0;
  let engagementProbabilityPct = 10;
  if (nearest) {
    const distance = Math.hypot(nearest.position.lat - unit.position.lat, nearest.position.lon - unit.position.lon);
    // A unit closing fast on a nearby opposing force scores near +1; standing still or far away scores near -1.
    closingRate = Math.max(-1, Math.min(1, recentSpeed * 400 - distance * 8));
    engagementProbabilityPct = Math.max(
      5,
      Math.min(95, Math.round(90 - distance * 900 + recentSpeed * 500))
    );
  }

  const threatForecasts = await forecastThreatEscalation(unit, strengthTrend, closingRate);

  const casualtyForecastPct = Math.max(
    0,
    Math.min(95, Math.round(20 + engagementProbabilityPct * 0.5 - strengthTrend * 15))
  );

  const doctrine = counterPlan?.matchedDoctrine[0];
  const recommendations: string[] = [];
  if (engagementProbabilityPct > 60) {
    recommendations.push(`High contact probability with ${unit.name} - consider pre-positioning a reserve.`);
  }
  if (threatForecasts.some((f) => f.trend === 'INCREASING')) {
    recommendations.push(`${unit.name} threat is forecast to escalate - prioritise ISR coverage on this axis.`);
  }
  if (doctrine?.counterTactics.length) {
    recommendations.push(`Apply counter-tactic: ${doctrine.counterTactics[0]}`);
  }
  if (trajectory.points.length > 0) {
    const last = trajectory.points[trajectory.points.length - 1];
    recommendations.push(
      `Predicted position in ${last.minutesAhead} min (${last.confidencePct}% confidence) - adjust blocking positions accordingly.`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(`${unit.name} shows no significant predicted change - maintain current posture.`);
  }

  return {
    unitId: unit.id,
    unitName: unit.name,
    trajectory,
    threatForecasts,
    casualtyForecastPct,
    engagementProbabilityPct,
    recommendations,
  };
}

/** Releases the tfjs models. Mainly useful for tests / hot-reload cleanup. */
export function disposePredictionModels(): void {
  movementModel?.dispose();
  movementModel = null;
  movementTrained = false;
  threatModel?.dispose();
  threatModel = null;
  threatTrained = false;
}
