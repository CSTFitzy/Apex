import React, { useEffect, useState } from 'react';
import api from '../utils/api.js';

/**
 * Displays a list of intelligence reports (sourced from ODIN and other
 * OSINT integrations).
 */
export default function IntelligencePanel() {
  const [reports, setReports] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    api
      .getIntelligenceReports()
      .then((data) => {
        if (!cancelled) setReports(data.reports || []);
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
  }, []);

  return (
    <div className="intelligence-panel">
      <h3>Intelligence Reports</h3>
      {loading && <p>Loading reports...</p>}
      {error && <p className="intelligence-panel-error">{error}</p>}
      {!loading && !error && reports.length === 0 && <p>No reports available.</p>}
      <ul>
        {reports.map((report) => (
          <li key={report.id}>
            <strong>{report.title}</strong>
            {report.source && <span className="report-source"> ({report.source})</span>}
            {report.summary && <p>{report.summary}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
