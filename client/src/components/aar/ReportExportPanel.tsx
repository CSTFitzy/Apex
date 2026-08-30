import { useState } from 'react';
import { getNarrativeReport, reportUrl } from '../../api/aar';

interface Props {
  operationId: string;
}

/** Multi-format AAR report export/download links (JSON, CSV, HTML) plus an on-demand Claude narrative preview. */
export default function ReportExportPanel({ operationId }: Props) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generateNarrative = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getNarrativeReport(operationId);
      setNarrative(result.narrative);
    } catch {
      setError(
        'Claude narrative generation is unavailable (is CLAUDE_API_KEY configured?). Downloaded reports still include a templated summary.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="aar-report-export">
      <h3>Export After-Action Report</h3>
      <p className="hint-text">
        Reports include the operation summary, per-unit performance analytics, commander effectiveness scores,
        lessons learned, and an executive-summary narrative (Claude-generated when configured).
      </p>
      <div className="terrain-actions">
        <a className="action-btn" href={reportUrl(operationId, 'json')} target="_blank" rel="noreferrer">
          ⬇ JSON
        </a>
        <a className="action-btn" href={reportUrl(operationId, 'csv')} target="_blank" rel="noreferrer">
          ⬇ CSV
        </a>
        <a className="action-btn" href={reportUrl(operationId, 'html')} target="_blank" rel="noreferrer">
          ⬇ HTML
        </a>
        <button className="action-btn" onClick={generateNarrative} disabled={loading}>
          {loading ? 'Generating...' : '🤖 Preview AI Narrative'}
        </button>
      </div>
      {error && <p className="hint-text">{error}</p>}
      {narrative && (
        <div className="aar-narrative-preview">
          <h4>Executive Summary (Claude)</h4>
          <p>{narrative}</p>
        </div>
      )}
    </div>
  );
}
