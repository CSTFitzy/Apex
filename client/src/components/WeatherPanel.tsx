import { useState } from 'react';
import api from '../api/client';
import type { LatLon, WeatherData } from '../types';

interface Props {
  aoCenter: LatLon | null;
}

const impactColor: Record<string, string> = {
  LOW: '#2ecc71',
  MODERATE: '#f1c40f',
  HIGH: '#e67e22',
  SEVERE: '#e74c3c',
};

export default function WeatherPanel({ aoCenter }: Props) {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchWeather = async () => {
    if (!aoCenter) {
      setError('Define an operational area on the map first (draw an AO polygon/rectangle).');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<WeatherData>('/weather', {
        params: { lat: aoCenter.lat, lon: aoCenter.lon },
      });
      setWeather(data);
    } catch (err) {
      console.error(err);
      setError('Failed to fetch weather data. The Open-Meteo API may be unreachable.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="weather-panel">
      <h2>Weather Analysis Engine</h2>
      <p className="panel-subtitle">Live data via Open-Meteo (free, no API key required)</p>
      <button className="action-btn" onClick={fetchWeather} disabled={loading}>
        {loading ? 'Fetching...' : 'Analyze AO Weather'}
      </button>
      {error && <p className="error-text">{error}</p>}

      {weather && (
        <>
          <div className="weather-grid">
            <div className="weather-card">
              <h3>Current Conditions</h3>
              <div className="weather-data">
                <div>Temperature: {weather.current.temperature_2m}°C</div>
                <div>
                  Wind: {weather.current.wind_speed_10m} km/h @ {weather.current.wind_direction_10m}°
                  {weather.current.wind_gusts_10m ? ` (gusts ${weather.current.wind_gusts_10m} km/h)` : ''}
                </div>
                <div>Visibility: {weather.current.visibility} m</div>
                <div>Cloud Cover: {weather.current.cloud_cover}%</div>
                <div>Precipitation: {weather.current.precipitation} mm</div>
                <div>Pressure: {weather.current.pressure_msl} hPa</div>
              </div>
            </div>
            <div className="weather-card">
              <h3>7-Day Forecast</h3>
              <div className="weather-data forecast-list">
                {weather.daily.time?.map((day, idx) => (
                  <div key={String(day)}>
                    {day}: {weather.daily.temperature_2m_min?.[idx]}° / {weather.daily.temperature_2m_max?.[idx]}°C,
                    {' '}
                    {weather.daily.precipitation_sum?.[idx]}mm precip
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div
            className="weather-alerts"
            style={{ borderLeftColor: impactColor[weather.operationalImpact.level] }}
          >
            <h3>Operational Impact: {weather.operationalImpact.level}</h3>
            <ul>
              {weather.operationalImpact.factors.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
