import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../utils/api.js';
import SharknetSocket from '../utils/websocket.js';

const POLL_INTERVAL_MS = 30000;
const REFRESH_DEBOUNCE_MS = 400;

/**
 * Loads supply status, depletion forecasts, depot locations and recent
 * consumption events, keeping them current via SUPPLY_UPDATE WebSocket
 * messages (with a slow poll as a fallback when the socket is unavailable).
 *
 * @param {object} [options]
 * @param {number} [options.windowHours] - Consumption observation window.
 */
export default function useSupplyData({ windowHours } = {}) {
  const [status, setStatus] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [depots, setDepots] = useState([]);
  const [consumption, setConsumption] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [statusData, forecastData, depotData, consumptionData] = await Promise.all([
        api.getSupplyStatus(windowHours),
        api.getSupplyForecast(windowHours),
        api.getSupplyDepots(),
        api.getSupplyConsumption(200),
      ]);
      if (cancelledRef.current) return;
      setStatus(statusData);
      setForecast(forecastData);
      setDepots(depotData.depots || []);
      setConsumption(consumptionData.events || []);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (!cancelledRef.current) setError(err.message);
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [windowHours]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      cancelledRef.current = true;
      clearInterval(interval);
    };
  }, [refresh]);

  // Real-time updates: coalesce bursts of supply events into a single refresh.
  useEffect(() => {
    const socket = new SharknetSocket();
    socket.connect(localStorage.getItem('sharknet_token'));
    socket.subscribe(['supply']);

    let timer = null;
    const unsubscribe = socket.on('SUPPLY_UPDATE', () => {
      clearTimeout(timer);
      timer = setTimeout(refresh, REFRESH_DEBOUNCE_MS);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
      socket.disconnect();
    };
  }, [refresh]);

  return { status, forecast, depots, consumption, loading, error, lastUpdated, refresh };
}
