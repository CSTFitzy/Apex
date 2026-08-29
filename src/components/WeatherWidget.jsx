import React, { useEffect, useState } from 'react';
import api from '../utils/api.js';

/**
 * Displays current & forecast weather data for a given location.
 */
export default function WeatherWidget({ latitude, longitude }) {
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (latitude == null || longitude == null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getWeatherForecast(latitude, longitude)
      .then((data) => {
        if (!cancelled) setForecast(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [latitude, longitude]);

  if (loading) return <div className="weather-widget">Loading weather...</div>;
  if (error) return <div className="weather-widget weather-widget-error">{error}</div>;
  if (!forecast) return <div className="weather-widget">No location selected</div>;

  const currentIndex = 0;
  const temperature = forecast.hourly?.temperature_2m?.[currentIndex];
  const windSpeed = forecast.hourly?.windspeed_10m?.[currentIndex];
  const precipitation = forecast.hourly?.precipitation?.[currentIndex];

  return (
    <div className="weather-widget">
      <h3>Weather</h3>
      <ul>
        <li>Temperature: {temperature != null ? `${temperature}°C` : 'N/A'}</li>
        <li>Wind Speed: {windSpeed != null ? `${windSpeed} km/h` : 'N/A'}</li>
        <li>Precipitation: {precipitation != null ? `${precipitation} mm` : 'N/A'}</li>
      </ul>
    </div>
  );
}
