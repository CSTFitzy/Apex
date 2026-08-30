import { useEffect, useRef, useState } from 'react';
import type { CounterPlanResult, LatLon, TacticalUnit, UnitPrediction } from '../types';
import { predictUnit } from '../utils/prediction';

/** How often the prediction pipeline re-runs while units are moving (ms). */
const REFRESH_INTERVAL_MS = 2000;

/**
 * Runs the TensorFlow.js prediction pipeline for every active hostile unit on
 * a fixed cadence (rather than on every simulation tick, which would
 * perpetually cancel in-flight inference before it could complete). Shared by
 * the AI Predictions panel and the map/globe views so predicted positions and
 * confidence halos stay in sync with the panel's forecasts.
 */
export function usePredictions(
  units: TacticalUnit[],
  history: Record<string, LatLon[]>,
  counterPlan: CounterPlanResult | null
) {
  const [predictions, setPredictions] = useState<UnitPrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hostiles = units.filter((u) => u.affiliation === 'hostile' && u.status !== 'destroyed');
  const hostileIds = hostiles.map((u) => u.id).join(',');

  // Mirror the latest props into a ref so the interval loop always reads
  // current data without needing to be recreated on every position update.
  const latestRef = useRef({ hostiles, history, units, counterPlan });
  latestRef.current = { hostiles, history, units, counterPlan };

  useEffect(() => {
    if (hostileIds === '') {
      setPredictions([]);
      return;
    }
    let cancelled = false;
    let running = false;

    const runInference = async () => {
      if (running || cancelled) return;
      running = true;
      setLoading(true);
      setError(null);
      try {
        const { hostiles: currentHostiles, history: currentHistory, units: currentUnits, counterPlan: currentPlan } =
          latestRef.current;
        const results = await Promise.all(
          currentHostiles.map((unit) =>
            predictUnit(unit, currentHistory[unit.id] ?? [unit.position], currentUnits, currentPlan)
          )
        );
        if (!cancelled) setPredictions(results);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Prediction inference failed.');
      } finally {
        running = false;
        if (!cancelled) setLoading(false);
      }
    };

    runInference();
    const interval = setInterval(runInference, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // Only restart the loop when the set of hostile units changes; position
    // updates are picked up via latestRef on each interval tick instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostileIds]);

  return { predictions, loading, error };
}
